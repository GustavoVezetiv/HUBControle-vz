import type { AppSupabaseClient } from "@/features/shared/types";
import type { WeeklyReviewData } from "@/features/weekly-review/types";

export async function loadWeeklyReviewData(
  client: AppSupabaseClient,
  userId: string,
): Promise<{ data: WeeklyReviewData | null; error: { message: string } | null }> {
  const [
    connectionResult,
    categoriesResult,
    listsResult,
    tasksResult,
    eventsResult,
    reportsResult,
    aiSummariesResult,
    syncRunsResult,
  ] = await Promise.all([
    client
      .from("routine_google_connections")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "google_tasks")
      .maybeSingle(),
    client.from("routine_categories").select("*").eq("user_id", userId).order("name", { ascending: true }),
    client.from("routine_task_lists").select("*").eq("user_id", userId).order("title", { ascending: true }),
    client.from("routine_tasks").select("*").eq("user_id", userId).order("updated_at_google", { ascending: false }),
    client.from("routine_task_events").select("*").eq("user_id", userId).order("event_at", { ascending: false }).limit(500),
    client.from("routine_weekly_reports").select("*").eq("user_id", userId).order("week_start_date", { ascending: false }).limit(20),
    client.from("routine_ai_summaries").select("*").eq("user_id", userId).order("week_start", { ascending: false }).limit(20),
    client.from("routine_sync_runs").select("*").eq("user_id", userId).order("started_at", { ascending: false }).limit(10),
  ]);

  const error =
    connectionResult.error ||
    categoriesResult.error ||
    listsResult.error ||
    tasksResult.error ||
    eventsResult.error ||
    reportsResult.error ||
    aiSummariesResult.error ||
    syncRunsResult.error;

  if (error) {
    console.error("Erro técnico ao carregar revisão semanal:", error);
    return { data: null, error: { message: "Não foi possível carregar a revisão semanal." } };
  }

  return {
    data: {
      connection: connectionResult.data ?? null,
      categories: categoriesResult.data ?? [],
      taskLists: listsResult.data ?? [],
      tasks: tasksResult.data ?? [],
      events: eventsResult.data ?? [],
      weeklyReports: reportsResult.data ?? [],
      aiSummaries: aiSummariesResult.data ?? [],
      syncRuns: syncRunsResult.data ?? [],
    },
    error: null,
  };
}

export async function updateTaskConfirmedCategory(
  client: AppSupabaseClient,
  userId: string,
  taskId: string,
  categoryId: string | null,
) {
  const result = await client
    .from("routine_tasks")
    .update({ confirmed_category_id: categoryId })
    .eq("user_id", userId)
    .eq("id", taskId);

  if (result.error) {
    console.error("Erro técnico ao confirmar categoria da tarefa:", result.error);
    return { error: { message: "Não foi possível confirmar a categoria." } };
  }

  return { error: null };
}
