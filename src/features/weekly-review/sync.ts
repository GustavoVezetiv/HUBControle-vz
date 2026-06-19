import { fetchGoogleTaskLists, fetchGoogleTasks, type GoogleTaskPayload } from "@/features/weekly-review/google-tasks-api";
import {
  decryptToken,
  encryptToken,
  refreshGoogleTasksAccessToken,
  tokenExpiresAt,
} from "@/features/weekly-review/google-tasks-auth";
import { detectRoutineCategoryId, initialRoutineCategories, isPriorityQueueTitle } from "@/features/weekly-review/categories";
import { buildWeeklyDerivedData } from "@/features/weekly-review/derived";
import type { AppSupabaseClient } from "@/features/shared/types";
import type { Json, RoutineCategory, RoutineGoogleConnection, RoutineSyncRun, RoutineTask, RoutineTaskList } from "@/lib/supabase/types";

export type RoutineSyncResult = {
  syncedAt: string;
  syncRunId: string | null;
  listsRead: number;
  tasksRead: number;
  createdTasks: number;
  updatedTasks: number;
  eventsCreated: number;
  reportsUpdated: number;
};

export type RoutineAutoSyncResult = {
  startedAt: string;
  finishedAt: string;
  usersFound: number;
  success: number;
  failed: number;
  skipped: number;
  results: Array<{
    userId: string;
    status: "success" | "failed" | "skipped";
    message?: string;
    syncRunId?: string | null;
  }>;
};

type SyncMode = "manual" | "auto";

type SyncOptions = {
  mode?: SyncMode;
  syncRunId?: string | null;
};

type RoutineTaskListRow = {
  id: string;
  google_task_list_id: string;
  title: string;
  is_priority_queue: boolean;
};

type SyncedGoogleTask = {
  list: RoutineTaskListRow;
  payload: GoogleTaskPayload;
};

type TaskEventDraft = {
  user_id: string;
  routine_task_id: string | null;
  google_task_id: string;
  event_type: string;
  previous_value: Json | null;
  new_value: Json | null;
  event_at: string;
  metadata: Json;
  event_signature: string;
  sync_run_id?: string | null;
};

export async function syncGoogleTasksForUser(
  client: AppSupabaseClient,
  userId: string,
  options: SyncOptions = {},
): Promise<{ data: RoutineSyncResult | null; error: { message: string } | null }> {
  const mode = options.mode ?? "manual";
  let syncRunId = options.syncRunId ?? null;

  try {
    await markSyncAttempt(client, userId);

    if (!syncRunId) {
      const activeRun = await findRecentRunningSync(client, userId);
      if (activeRun.data) {
        return { data: null, error: { message: "Já existe uma sincronização recente em andamento para este usuário." } };
      }

      const runResult = await startSyncRun(client, userId);
      if (runResult.error || !runResult.data) {
        return { data: null, error: runResult.error ?? { message: "Não foi possível registrar a sincronização." } };
      }
      syncRunId = runResult.data.id;
    }

    const connectionResult = await getConnectedGoogleTasksAccount(client, userId);
    if (connectionResult.error || !connectionResult.data) {
      throw new Error(connectionResult.error?.message ?? "Google Tasks não conectado.");
    }

    const accessResult = await getValidAccessToken(client, userId, connectionResult.data);
    if (accessResult.error || !accessResult.data) {
      throw new Error(accessResult.error?.message ?? "Não foi possível acessar o Google Tasks.");
    }

    const categoriesResult = await ensureRoutineCategories(client, userId);
    if (categoriesResult.error || !categoriesResult.data) {
      throw new Error(categoriesResult.error?.message ?? "Não foi possível preparar categorias.");
    }

    const listsResult = await fetchGoogleTaskLists(accessResult.data);
    if (listsResult.error || !listsResult.data) {
      throw new Error(listsResult.error ?? "Não foi possível ler listas do Google Tasks.");
    }

    const taskLists = await upsertTaskLists(client, userId, listsResult.data);
    if (taskLists.error) {
      throw new Error(taskLists.error.message);
    }

    const syncedTasks: SyncedGoogleTask[] = [];
    for (const list of taskLists.data) {
      const tasksResult = await fetchGoogleTasks(accessResult.data, list.google_task_list_id);
      if (tasksResult.error || !tasksResult.data) {
        throw new Error(tasksResult.error ?? "Não foi possível ler tarefas do Google Tasks.");
      }

      for (const task of tasksResult.data.filter((item) => !item.deleted)) {
        syncedTasks.push({ list, payload: task });
      }
    }

    const syncResult = await upsertTasksAndEvents(client, userId, syncedTasks, categoriesResult.data, syncRunId);
    if (syncResult.error || !syncResult.data) {
      throw new Error(syncResult.error?.message ?? "Não foi possível salvar tarefas sincronizadas.");
    }

    const reportResult = await upsertCurrentWeeklyReport(client, userId);
    if (reportResult.error) {
      throw new Error(reportResult.error.message);
    }

    const syncedAt = new Date().toISOString();
    await markSyncSuccess(client, userId, syncedAt);

    if (syncRunId) {
      await finishSyncRun(client, syncRunId, "success", {
        tasks_seen: syncedTasks.length,
        tasks_created: syncResult.data.createdTasks,
        tasks_updated: syncResult.data.updatedTasks,
        events_created: syncResult.data.eventsCreated,
      });
    }

    return {
      data: {
        syncedAt,
        syncRunId,
        listsRead: taskLists.data.length,
        tasksRead: syncedTasks.length,
        createdTasks: syncResult.data.createdTasks,
        updatedTasks: syncResult.data.updatedTasks,
        eventsCreated: syncResult.data.eventsCreated,
        reportsUpdated: reportResult.data?.updated ? 1 : 0,
      },
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível sincronizar Google Tasks.";
    console.error(`Erro técnico na sincronização ${mode} do Google Tasks:`, error);
    await markSyncError(client, userId, message);
    if (syncRunId) {
      await finishSyncRun(client, syncRunId, "failed", { error_message: message });
    }
    return { data: null, error: { message } };
  }
}

export async function syncConnectedGoogleTasksUsers(
  client: AppSupabaseClient,
): Promise<{ data: RoutineAutoSyncResult | null; error: { message: string } | null }> {
  const startedAt = new Date().toISOString();
  const connectionsResult = await client
    .from("routine_google_connections")
    .select("*")
    .eq("provider", "google_tasks")
    .eq("status", "connected")
    .eq("auto_sync_enabled", true);

  if (connectionsResult.error) {
    console.error("Erro técnico ao listar conexões para sync automático:", connectionsResult.error);
    return { data: null, error: { message: "Não foi possível listar conexões Google Tasks." } };
  }

  const results: RoutineAutoSyncResult["results"] = [];

  for (const connection of connectionsResult.data ?? []) {
    const activeRun = await findRecentRunningSync(client, connection.user_id);
    if (activeRun.data) {
      results.push({
        userId: connection.user_id,
        status: "skipped",
        message: "Sincronização recente ainda em andamento.",
        syncRunId: activeRun.data.id,
      });
      continue;
    }

    const runResult = await startSyncRun(client, connection.user_id);
    if (runResult.error || !runResult.data) {
      results.push({
        userId: connection.user_id,
        status: "failed",
        message: runResult.error?.message ?? "Não foi possível criar execução.",
      });
      continue;
    }

    const syncResult = await syncGoogleTasksForUser(client, connection.user_id, {
      mode: "auto",
      syncRunId: runResult.data.id,
    });

    results.push({
      userId: connection.user_id,
      status: syncResult.error ? "failed" : "success",
      message: syncResult.error?.message,
      syncRunId: runResult.data.id,
    });
  }

  return {
    data: {
      startedAt,
      finishedAt: new Date().toISOString(),
      usersFound: connectionsResult.data?.length ?? 0,
      success: results.filter((result) => result.status === "success").length,
      failed: results.filter((result) => result.status === "failed").length,
      skipped: results.filter((result) => result.status === "skipped").length,
      results,
    },
    error: null,
  };
}

export async function getConnectedGoogleTasksAccount(client: AppSupabaseClient, userId: string) {
  const result = await client
    .from("routine_google_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", "google_tasks")
    .maybeSingle();

  if (result.error) {
    console.error("Erro técnico ao buscar conexão Google Tasks:", result.error);
    return { data: null, error: { message: "Não foi possível verificar a conexão com Google Tasks." } };
  }

  if (!result.data || result.data.status !== "connected") {
    return { data: null, error: { message: "Google Tasks ainda não está conectado." } };
  }

  return { data: result.data as RoutineGoogleConnection, error: null };
}

async function getValidAccessToken(
  client: AppSupabaseClient,
  userId: string,
  connection: RoutineGoogleConnection,
) {
  try {
    const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
    const shouldRefresh = !connection.encrypted_access_token || expiresAt < Date.now() + 60_000;

    if (!shouldRefresh && connection.encrypted_access_token) {
      return { data: decryptToken(connection.encrypted_access_token), error: null };
    }

    if (!connection.encrypted_refresh_token) {
      return { data: null, error: { message: "Conexão sem refresh token. Reconecte o Google Tasks." } };
    }

    const refreshToken = decryptToken(connection.encrypted_refresh_token);
    const tokenResult = await refreshGoogleTasksAccessToken(refreshToken);

    if (tokenResult.error || !tokenResult.data) {
      return { data: null, error: { message: tokenResult.error ?? "Não foi possível renovar o token." } };
    }

    const encryptedAccessToken = encryptToken(tokenResult.data.access_token);
    const updateResult = await client
      .from("routine_google_connections")
      .update({
        encrypted_access_token: encryptedAccessToken,
        token_expires_at: tokenExpiresAt(tokenResult.data.expires_in),
      })
      .eq("user_id", userId)
      .eq("provider", "google_tasks");

    if (updateResult.error) {
      console.error("Erro técnico ao salvar token renovado:", updateResult.error);
      return { data: null, error: { message: "Token renovado, mas não foi possível salvar a conexão." } };
    }

    return { data: tokenResult.data.access_token, error: null };
  } catch (error) {
    console.error("Erro técnico ao preparar token Google Tasks:", error);
    return { data: null, error: { message: "Não foi possível descriptografar a conexão Google Tasks." } };
  }
}

async function ensureRoutineCategories(client: AppSupabaseClient, userId: string) {
  const existingResult = await client
    .from("routine_categories")
    .select("*")
    .eq("user_id", userId)
    .order("name", { ascending: true });

  if (existingResult.error) {
    console.error("Erro técnico ao buscar categorias de rotina:", existingResult.error);
    return { data: null, error: { message: "Não foi possível carregar categorias da revisão semanal." } };
  }

  const existingNames = new Set((existingResult.data ?? []).map((category) => category.name));
  const missing = initialRoutineCategories.filter((category) => !existingNames.has(category.name));

  if (missing.length > 0) {
    const insertResult = await client.from("routine_categories").insert(
      missing.map((category) => ({
        user_id: userId,
        name: category.name,
        color: category.color,
        is_default: true,
      })),
    );

    if (insertResult.error) {
      console.error("Erro técnico ao criar categorias iniciais de rotina:", insertResult.error);
      return { data: null, error: { message: "Não foi possível criar categorias iniciais da revisão semanal." } };
    }
  }

  const categoriesResult = await client
    .from("routine_categories")
    .select("*")
    .eq("user_id", userId)
    .order("name", { ascending: true });

  if (categoriesResult.error) {
    console.error("Erro técnico ao recarregar categorias de rotina:", categoriesResult.error);
    return { data: null, error: { message: "Não foi possível carregar categorias da revisão semanal." } };
  }

  return { data: (categoriesResult.data ?? []) as RoutineCategory[], error: null };
}

async function upsertTaskLists(
  client: AppSupabaseClient,
  userId: string,
  lists: Array<{ id: string; title: string; updated?: string }>,
) {
  const now = new Date().toISOString();
  const rows = lists.map((list) => ({
    user_id: userId,
    google_task_list_id: list.id,
    title: list.title,
    is_priority_queue: isPriorityQueueTitle(list.title),
    updated_at_google: list.updated ?? null,
    last_seen_at: now,
    raw_json: list as unknown as Json,
  }));

  if (rows.length === 0) return { data: [] as RoutineTaskListRow[], error: null };

  const result = await client
    .from("routine_task_lists")
    .upsert(rows, { onConflict: "user_id,google_task_list_id" })
    .select("id,google_task_list_id,title,is_priority_queue");

  if (result.error) {
    console.error("Erro técnico ao salvar listas do Google Tasks:", result.error);
    return { data: [] as RoutineTaskListRow[], error: { message: "Não foi possível salvar listas do Google Tasks." } };
  }

  return { data: (result.data ?? []) as RoutineTaskListRow[], error: null };
}

async function upsertTasksAndEvents(
  client: AppSupabaseClient,
  userId: string,
  syncedTasks: SyncedGoogleTask[],
  categories: RoutineCategory[],
  syncRunId: string | null,
) {
  const existingResult = await client
    .from("routine_tasks")
    .select("*")
    .eq("user_id", userId);

  if (existingResult.error) {
    console.error("Erro técnico ao buscar tarefas locais:", existingResult.error);
    return { data: null, error: { message: "Não foi possível comparar tarefas existentes." } };
  }

  const existingByGoogleId = new Map((existingResult.data ?? []).map((task) => [task.google_task_id, task as RoutineTask]));
  const now = new Date().toISOString();
  const rows = syncedTasks.map(({ list, payload }) => {
    const title = payload.title?.trim() || "Tarefa sem título";
    const existing = existingByGoogleId.get(payload.id);
    return {
      user_id: userId,
      google_task_id: payload.id,
      google_task_list_id: list.google_task_list_id,
      routine_task_list_id: list.id,
      title,
      notes: payload.notes ?? null,
      status: payload.status ?? "needsAction",
      due_date: normalizeDate(payload.due),
      completed_at: payload.completed ?? null,
      updated_at_google: payload.updated ?? null,
      last_seen_at: now,
      detected_category_id: detectRoutineCategoryId({ title, notes: payload.notes, listTitle: list.title }, categories),
      confirmed_category_id: existing?.confirmed_category_id ?? null,
      parent_google_task_id: payload.parent ?? null,
      position: payload.position ?? null,
      is_hidden: Boolean(payload.hidden),
      raw_json: payload as unknown as Json,
    };
  });

  if (rows.length === 0) {
    return { data: { createdTasks: 0, updatedTasks: 0, eventsCreated: 0 }, error: null };
  }

  const isInitialLoad = existingByGoogleId.size === 0;
  const events = buildEvents(userId, syncedTasks, existingByGoogleId, syncRunId, isInitialLoad);

  const upsertResult = await client
    .from("routine_tasks")
    .upsert(rows, { onConflict: "user_id,google_task_id" })
    .select("id,google_task_id");

  if (upsertResult.error) {
    console.error("Erro técnico ao salvar tarefas sincronizadas:", upsertResult.error);
    return { data: null, error: { message: "Não foi possível salvar tarefas sincronizadas." } };
  }

  const taskIdByGoogleId = new Map((upsertResult.data ?? []).map((task) => [task.google_task_id, task.id]));
  const snapshots = rows
    .map((row) => ({
      user_id: userId,
      routine_task_id: taskIdByGoogleId.get(row.google_task_id),
      google_task_id: row.google_task_id,
      google_task_list_id: row.google_task_list_id,
      title: row.title,
      notes: row.notes,
      status: row.status,
      due_date: row.due_date,
      completed_at: row.completed_at,
      detected_category_id: row.detected_category_id,
      confirmed_category_id: row.confirmed_category_id,
      raw_json: row.raw_json,
    }))
    .filter((row): row is NonNullable<typeof row> & { routine_task_id: string } => Boolean(row.routine_task_id));

  if (snapshots.length > 0) {
    const snapshotResult = await client.from("routine_task_snapshots").insert(snapshots);
    if (snapshotResult.error) {
      console.error("Erro técnico ao salvar snapshots de tarefas:", snapshotResult.error);
      return { data: null, error: { message: "Tarefas salvas, mas não foi possível salvar snapshots." } };
    }
  }

  const eventsWithIds = events.map((event) => ({
    ...event,
    routine_task_id: event.routine_task_id ?? taskIdByGoogleId.get(event.google_task_id) ?? null,
  }));

  const uniqueEvents = dedupeEvents(eventsWithIds);

  if (uniqueEvents.length > 0) {
    const eventResult = await client
      .from("routine_task_events")
      .upsert(uniqueEvents, { onConflict: "user_id,event_signature", ignoreDuplicates: true })
      .select("id");
    if (eventResult.error) {
      console.error("Erro técnico ao salvar eventos de tarefas:", eventResult.error);
      return { data: null, error: { message: "Tarefas salvas, mas não foi possível registrar eventos." } };
    }
    eventsWithIds.length = eventResult.data?.length ?? 0;
  }

  const createdTasks = syncedTasks.filter(({ payload }) => !existingByGoogleId.has(payload.id)).length;

  return {
    data: {
      createdTasks,
      updatedTasks: syncedTasks.length - createdTasks,
      eventsCreated: eventsWithIds.length,
    },
    error: null,
  };
}

function buildEvents(
  userId: string,
  syncedTasks: SyncedGoogleTask[],
  existingByGoogleId: Map<string, RoutineTask>,
  syncRunId: string | null,
  isInitialLoad: boolean,
): TaskEventDraft[] {
  const events: TaskEventDraft[] = [];
  const eventAt = new Date().toISOString();

  for (const { list, payload } of syncedTasks) {
    const existing = existingByGoogleId.get(payload.id);
    const title = payload.title?.trim() || "Tarefa sem título";
    const status = payload.status ?? "needsAction";
    const dueDate = normalizeDate(payload.due);

    if (!existing) {
      if (isInitialLoad) continue;

      events.push(buildEvent(userId, null, payload.id, "CREATED", null, { title, list: list.title, status }, eventAt, {}, syncRunId));
      if (list.is_priority_queue) {
        events.push(buildEvent(userId, null, payload.id, "PRIORITIZED", null, { list: list.title }, eventAt, {}, syncRunId));
      }
      continue;
    }

    if (existing.google_task_list_id !== list.google_task_list_id) {
      events.push(buildEvent(
        userId,
        existing.id,
        payload.id,
        "MOVED_LIST",
        { google_task_list_id: existing.google_task_list_id },
        { google_task_list_id: list.google_task_list_id, title: list.title },
        eventAt,
        { prioritized: list.is_priority_queue },
        syncRunId,
      ));
      if (list.is_priority_queue) {
        events.push(buildEvent(userId, existing.id, payload.id, "PRIORITIZED", { list: existing.google_task_list_id }, { list: list.title }, eventAt, {}, syncRunId));
      }
    }

    if (existing.status !== "completed" && status === "completed") {
      events.push(buildEvent(userId, existing.id, payload.id, "COMPLETED", { status: existing.status }, { status }, eventAt, {}, syncRunId));
    }

    if (existing.status === "completed" && status !== "completed") {
      events.push(buildEvent(userId, existing.id, payload.id, "REOPENED", { status: existing.status }, { status }, eventAt, {}, syncRunId));
    }

    if (existing.title !== title) {
      events.push(buildEvent(userId, existing.id, payload.id, "TITLE_CHANGED", existing.title, title, eventAt, {}, syncRunId));
    }

    if ((existing.notes ?? "") !== (payload.notes ?? "")) {
      events.push(buildEvent(userId, existing.id, payload.id, "NOTES_CHANGED", existing.notes, payload.notes ?? null, eventAt, {}, syncRunId));
    }

    if ((existing.due_date ?? null) !== dueDate) {
      events.push(buildEvent(userId, existing.id, payload.id, "DUE_DATE_CHANGED", existing.due_date, dueDate, eventAt, {}, syncRunId));
    }
  }

  return events;
}

async function upsertCurrentWeeklyReport(client: AppSupabaseClient, userId: string) {
  const today = new Date();
  const weekStart = startOfWeek(today);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekStartDate = toDateInputValue(weekStart);
  const weekEndDate = toDateInputValue(weekEnd);

  const [tasksResult, eventsResult, taskListsResult, categoriesResult] = await Promise.all([
    client.from("routine_tasks").select("*").eq("user_id", userId),
    client
      .from("routine_task_events")
      .select("*")
      .eq("user_id", userId)
      .gte("event_at", `${weekStartDate}T00:00:00.000Z`)
      .lte("event_at", `${weekEndDate}T23:59:59.999Z`),
    client.from("routine_task_lists").select("*").eq("user_id", userId),
    client.from("routine_categories").select("*").eq("user_id", userId),
  ]);

  if (tasksResult.error || eventsResult.error || taskListsResult.error || categoriesResult.error) {
    console.error("Erro técnico ao gerar relatório semanal:", {
      tasksError: tasksResult.error,
      eventsError: eventsResult.error,
      taskListsError: taskListsResult.error,
      categoriesError: categoriesResult.error,
    });
    return { data: null, error: { message: "Não foi possível gerar relatório semanal." } };
  }

  const tasks = (tasksResult.data ?? []) as RoutineTask[];
  const events = eventsResult.data ?? [];
  const taskLists = (taskListsResult.data ?? []) as RoutineTaskList[];
  const categories = (categoriesResult.data ?? []) as RoutineCategory[];
  const derived = buildWeeklyDerivedData(tasks, events, taskLists, categories, weekStartDate, weekEndDate);

  const result = await client.from("routine_weekly_reports").upsert(
    {
      user_id: userId,
      week_start_date: weekStartDate,
      week_end_date: weekEndDate,
      completed_count: derived.completedThisWeek.length,
      prioritized_count: derived.prioritizedEvents.length,
      open_count: derived.openTasks.length,
      stale_count: derived.staleTasks.length,
      events_count: derived.realEventsThisWeek.length,
      summary_json: {
        by_event_type: countBy(derived.realEventsThisWeek, (event) => event.event_type),
        baseline_ignored: {
          created: events.filter((event) => event.event_type === "CREATED" && event.previous_value === null).length,
          prioritized: derived.inheritedPriorityEventsThisWeek.length,
        },
        movement: {
          created_after_baseline: derived.createdAfterBaselineEvents.length,
          prioritized_real: derived.prioritizedEvents.length,
          reopened: derived.reopenedEvents.length,
          due_date_changed: derived.dueDateChangedEvents.length,
        },
        current_state: {
          open: derived.openTasks.length,
          priority_queue: derived.priorityQueueTasks.length,
          overdue: derived.overdueTasks.length,
          without_date: derived.tasksWithoutDate.length,
          stale: derived.staleTasks.length,
        },
      },
      future_ai_summary: null,
      generated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,week_start_date" },
  );

  if (result.error) {
    console.error("Erro técnico ao salvar relatório semanal:", result.error);
    return { data: null, error: { message: "Não foi possível salvar relatório semanal." } };
  }

  return { data: { updated: true }, error: null };
}

async function markSyncError(client: AppSupabaseClient, userId: string, message: string) {
  await client
    .from("routine_google_connections")
    .update({
      status: "error",
      last_sync_attempt_at: new Date().toISOString(),
      last_sync_error: message,
    })
    .eq("user_id", userId)
    .eq("provider", "google_tasks");
}

async function markSyncAttempt(client: AppSupabaseClient, userId: string) {
  await client
    .from("routine_google_connections")
    .update({ last_sync_attempt_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("provider", "google_tasks");
}

async function markSyncSuccess(client: AppSupabaseClient, userId: string, syncedAt: string) {
  await client
    .from("routine_google_connections")
    .update({
      status: "connected",
      last_sync_at: syncedAt,
      last_successful_sync_at: syncedAt,
      last_sync_attempt_at: syncedAt,
      last_sync_error: null,
    })
    .eq("user_id", userId)
    .eq("provider", "google_tasks");
}

async function startSyncRun(client: AppSupabaseClient, userId: string) {
  const result = await client
    .from("routine_sync_runs")
    .insert({ user_id: userId, provider: "google_tasks", status: "running" })
    .select("*")
    .single();

  if (result.error) {
    console.error("Erro técnico ao criar sync run:", result.error);
    return { data: null, error: { message: "Não foi possível iniciar registro da sincronização." } };
  }

  return { data: result.data as RoutineSyncRun, error: null };
}

async function finishSyncRun(
  client: AppSupabaseClient,
  syncRunId: string,
  status: "success" | "partial_error" | "failed" | "skipped",
  patch: Partial<Pick<RoutineSyncRun, "tasks_seen" | "tasks_created" | "tasks_updated" | "events_created" | "error_message">>,
) {
  const result = await client
    .from("routine_sync_runs")
    .update({
      ...patch,
      status,
      finished_at: new Date().toISOString(),
    })
    .eq("id", syncRunId);

  if (result.error) {
    console.error("Erro técnico ao finalizar sync run:", result.error);
  }
}

async function findRecentRunningSync(client: AppSupabaseClient, userId: string) {
  const threshold = new Date(Date.now() - 30 * 60_000).toISOString();
  const result = await client
    .from("routine_sync_runs")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", "google_tasks")
    .eq("status", "running")
    .gte("started_at", threshold)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error) {
    console.error("Erro técnico ao verificar sync em andamento:", result.error);
    return { data: null };
  }

  return { data: result.data as RoutineSyncRun | null };
}

function buildEvent(
  userId: string,
  routineTaskId: string | null,
  googleTaskId: string,
  eventType: string,
  previousValue: Json | null,
  newValue: Json | null,
  eventAt: string,
  metadata: Json = {},
  syncRunId: string | null = null,
): TaskEventDraft {
  const eventSignature = buildEventSignature(userId, googleTaskId, eventType, previousValue, newValue);
  return {
    user_id: userId,
    routine_task_id: routineTaskId,
    google_task_id: googleTaskId,
    event_type: eventType,
    previous_value: previousValue,
    new_value: newValue,
    event_at: eventAt,
    metadata,
    event_signature: eventSignature,
    sync_run_id: syncRunId,
  };
}

function buildEventSignature(userId: string, googleTaskId: string, eventType: string, previousValue: Json | null, newValue: Json | null) {
  return [
    userId,
    googleTaskId,
    eventType,
    stableStringify(previousValue),
    stableStringify(newValue),
  ].join("|");
}

function stableStringify(value: Json | null): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key] ?? null)}`)
    .join(",")}}`;
}

function dedupeEvents<T extends { event_signature: string }>(events: T[]) {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.event_signature)) return false;
    seen.add(event.event_signature);
    return true;
  });
}


function normalizeDate(value: string | undefined) {
  return value ? value.slice(0, 10) : null;
}

function startOfWeek(date: Date) {
  const next = new Date(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  next.setHours(0, 0, 0, 0);
  return next;
}

function toDateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function countBy<T>(items: T[], getKey: (item: T) => string) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = getKey(item);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}
