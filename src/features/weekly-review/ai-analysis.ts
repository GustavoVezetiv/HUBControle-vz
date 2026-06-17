import type { AppSupabaseClient } from "@/features/shared/types";
import type {
  Json,
  RoutineAiSummary,
  RoutineCategory,
  RoutineTask,
  RoutineTaskEvent,
  RoutineTaskList,
} from "@/lib/supabase/types";

export const GEMINI_WEEKLY_REVIEW_MODEL = "gemini-1.5-flash";
export const GEMINI_PROVIDER = "gemini";

export type WeeklyAiListCount = {
  nome: string;
  total: number;
  fila_prioridade: boolean;
};

export type WeeklyAiCategoryCount = {
  nome: string;
  total: number;
};

export type WeeklyAiTaskItem = {
  titulo: string;
  lista: string;
  categoria: string;
  data_prevista: string | null;
  concluida_em?: string | null;
  atualizada_em?: string | null;
};

export type WeeklyAiEventItem = {
  tipo: string;
  tarefa: string;
  data: string;
  lista_destino?: string | null;
};

export type WeeklyAiInputSummary = {
  periodo: string;
  total_concluidas: number;
  total_abertas: number;
  total_movidas_para_prioridade: number;
  listas: WeeklyAiListCount[];
  categorias: WeeklyAiCategoryCount[];
  tarefas_concluidas_relevantes: WeeklyAiTaskItem[];
  tarefas_abertas_relevantes: WeeklyAiTaskItem[];
  eventos_relevantes: WeeklyAiEventItem[];
  observacoes_do_sistema: string[];
};

type WeeklyAiSourceData = {
  tasks: RoutineTask[];
  events: RoutineTaskEvent[];
  taskLists: RoutineTaskList[];
  categories: RoutineCategory[];
};

export async function generateWeeklyAiAnalysis(
  client: AppSupabaseClient,
  userId: string,
  weekStart: string,
  weekEnd: string,
): Promise<{ data: RoutineAiSummary | null; error: { message: string; technical?: string } | null }> {
  const sourceResult = await loadWeeklyAiSourceData(client, userId, weekStart, weekEnd);
  if (sourceResult.error || !sourceResult.data) {
    return { data: null, error: sourceResult.error ?? { message: "Não foi possível carregar dados da semana." } };
  }

  const inputSummary = buildWeeklyAiInputSummary(sourceResult.data, weekStart, weekEnd);
  const geminiResult = await requestGeminiWeeklyAnalysis(inputSummary);

  const summaryRow = {
    user_id: userId,
    week_start: weekStart,
    week_end: weekEnd,
    provider: GEMINI_PROVIDER,
    model: GEMINI_WEEKLY_REVIEW_MODEL,
    input_summary_json: inputSummary as unknown as Json,
    summary_text: geminiResult.data ?? null,
    error_message: geminiResult.error?.technical ?? null,
  };

  const saveResult = await client
    .from("routine_ai_summaries")
    .upsert(summaryRow, { onConflict: "user_id,week_start,provider" })
    .select("*")
    .single();

  if (saveResult.error) {
    console.error("Erro técnico ao salvar análise Gemini da semana:", saveResult.error);
    return {
      data: null,
      error: {
        message: "Não foi possível salvar a análise da semana.",
        technical: saveResult.error.message,
      },
    };
  }

  if (geminiResult.error) {
    return {
      data: saveResult.data as RoutineAiSummary,
      error: geminiResult.error,
    };
  }

  return { data: saveResult.data as RoutineAiSummary, error: null };
}

export async function loadWeeklyAiSourceData(
  client: AppSupabaseClient,
  userId: string,
  weekStart: string,
  weekEnd: string,
): Promise<{ data: WeeklyAiSourceData | null; error: { message: string; technical?: string } | null }> {
  const [tasksResult, eventsResult, listsResult, categoriesResult] = await Promise.all([
    client.from("routine_tasks").select("*").eq("user_id", userId),
    client
      .from("routine_task_events")
      .select("*")
      .eq("user_id", userId)
      .gte("event_at", `${weekStart}T00:00:00.000Z`)
      .lte("event_at", `${weekEnd}T23:59:59.999Z`)
      .order("event_at", { ascending: false }),
    client.from("routine_task_lists").select("*").eq("user_id", userId),
    client.from("routine_categories").select("*").eq("user_id", userId),
  ]);

  const error = tasksResult.error || eventsResult.error || listsResult.error || categoriesResult.error;
  if (error) {
    console.error("Erro técnico ao montar dados para análise semanal:", error);
    return {
      data: null,
      error: {
        message: "Não foi possível preparar os dados da semana.",
        technical: error.message,
      },
    };
  }

  return {
    data: {
      tasks: (tasksResult.data ?? []) as RoutineTask[],
      events: (eventsResult.data ?? []) as RoutineTaskEvent[],
      taskLists: (listsResult.data ?? []) as RoutineTaskList[],
      categories: (categoriesResult.data ?? []) as RoutineCategory[],
    },
    error: null,
  };
}

export function buildWeeklyAiInputSummary(data: WeeklyAiSourceData, weekStart: string, weekEnd: string): WeeklyAiInputSummary {
  const listByGoogleId = new Map(data.taskLists.map((list) => [list.google_task_list_id, list]));
  const categoryById = new Map(data.categories.map((category) => [category.id, category.name]));
  const taskByGoogleId = new Map(data.tasks.map((task) => [task.google_task_id, task]));
  const completed = data.tasks.filter((task) => task.completed_at && inDateRange(task.completed_at.slice(0, 10), weekStart, weekEnd));
  const open = data.tasks.filter((task) => task.status !== "completed");
  const prioritizedEvents = data.events.filter(isPriorityEvent);

  const observations: string[] = [];
  if (data.tasks.length === 0) observations.push("Nenhuma tarefa sincronizada foi encontrada no Hub.");
  if (completed.length === 0) observations.push("Nenhuma tarefa concluída foi registrada no período selecionado.");
  if (data.events.length === 0) observations.push("Nenhum evento de mudança foi registrado no período selecionado.");
  if (prioritizedEvents.length > 0) observations.push("Geral/Hoje foi tratado como fila de prioridade, não como categoria real.");

  return {
    periodo: `${formatDateForPrompt(weekStart)} até ${formatDateForPrompt(weekEnd)}`,
    total_concluidas: completed.length,
    total_abertas: open.length,
    total_movidas_para_prioridade: prioritizedEvents.length,
    listas: countRows(data.tasks, (task) => {
      const list = listByGoogleId.get(task.google_task_list_id);
      return {
        key: list?.title ?? "Lista desconhecida",
        fila_prioridade: Boolean(list?.is_priority_queue),
      };
    }).map((row) => ({ nome: row.key, total: row.count, fila_prioridade: row.fila_prioridade })),
    categorias: countRows(data.tasks, (task) => ({
      key: categoryById.get(task.confirmed_category_id ?? task.detected_category_id ?? "") ?? "Sem categoria",
    })).map((row) => ({ nome: row.key, total: row.count })),
    tarefas_concluidas_relevantes: completed.slice(0, 25).map((task) => toAiTaskItem(task, listByGoogleId, categoryById, true)),
    tarefas_abertas_relevantes: open.slice(0, 25).map((task) => toAiTaskItem(task, listByGoogleId, categoryById, false)),
    eventos_relevantes: data.events.slice(0, 40).map((event) => toAiEventItem(event, taskByGoogleId, listByGoogleId)),
    observacoes_do_sistema: observations,
  };
}

async function requestGeminiWeeklyAnalysis(
  inputSummary: WeeklyAiInputSummary,
): Promise<{ data: string | null; error: { message: string; technical?: string } | null }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      data: null,
      error: {
        message: "GEMINI_API_KEY não configurada.",
        technical: "Missing GEMINI_API_KEY",
      },
    };
  }

  const prompt = [
    "Você é um assistente de revisão semanal.",
    "Analise os dados de tarefas do usuário e gere um resumo objetivo, útil e direto.",
    "Não invente tarefas. Não assuma dados que não estão no JSON.",
    "Foque em execução, prioridade, áreas trabalhadas, áreas negligenciadas e sugestões práticas para a próxima semana.",
    "",
    "Categorias principais do usuário:",
    "Trabalho; Profissional; Projetos e conhecimentos; Pessoal; Cursos; Sem previsão; Lugares e coisas para fazer; Jogos; Coisas para assistir.",
    "",
    "Regra especial: Geral/Hoje deve ser tratada como fila de prioridade, não como categoria real.",
    "",
    "Responda exatamente com estas seções:",
    "Resumo da semana",
    "Principais avanços",
    "Áreas mais trabalhadas",
    "Áreas negligenciadas",
    "Tarefas que viraram prioridade",
    "Pendências que ficaram paradas",
    "Sugestões para a próxima semana",
    "",
    "JSON organizado pelo Hub:",
    JSON.stringify(inputSummary, null, 2),
  ].join("\n");

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_WEEKLY_REVIEW_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1200,
          },
        }),
      },
    );

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      console.error("Erro técnico da API Gemini:", payload);
      return {
        data: null,
        error: {
          message: "Não foi possível gerar a análise com Gemini.",
          technical: extractGeminiError(payload) ?? `HTTP ${response.status}`,
        },
      };
    }

    const text = extractGeminiText(payload);
    if (!text) {
      console.error("Resposta Gemini sem texto:", payload);
      return {
        data: null,
        error: {
          message: "Gemini respondeu sem texto de análise.",
          technical: "Empty Gemini response",
        },
      };
    }

    return { data: text, error: null };
  } catch (error) {
    console.error("Erro técnico ao chamar Gemini:", error);
    return {
      data: null,
      error: {
        message: "Não foi possível chamar o Gemini.",
        technical: error instanceof Error ? error.message : "Unknown Gemini request error",
      },
    };
  }
}

function toAiTaskItem(
  task: RoutineTask,
  listByGoogleId: Map<string, RoutineTaskList>,
  categoryById: Map<string, string>,
  includeCompletedAt: boolean,
): WeeklyAiTaskItem {
  return {
    titulo: task.title,
    lista: listByGoogleId.get(task.google_task_list_id)?.title ?? "Lista desconhecida",
    categoria: categoryById.get(task.confirmed_category_id ?? task.detected_category_id ?? "") ?? "Sem categoria",
    data_prevista: task.due_date,
    concluida_em: includeCompletedAt ? task.completed_at : undefined,
    atualizada_em: task.updated_at_google,
  };
}

function toAiEventItem(
  event: RoutineTaskEvent,
  taskByGoogleId: Map<string, RoutineTask>,
  listByGoogleId: Map<string, RoutineTaskList>,
): WeeklyAiEventItem {
  const destinationListId = typeof event.new_value === "object" && event.new_value && !Array.isArray(event.new_value)
    ? event.new_value.google_task_list_id
    : null;

  return {
    tipo: event.event_type,
    tarefa: taskByGoogleId.get(event.google_task_id)?.title ?? "Tarefa não encontrada no snapshot atual",
    data: event.event_at,
    lista_destino: typeof destinationListId === "string" ? listByGoogleId.get(destinationListId)?.title ?? destinationListId : null,
  };
}

function isPriorityEvent(event: RoutineTaskEvent) {
  return event.event_type === "PRIORITIZED" || (event.event_type === "MOVED_LIST" && JSON.stringify(event.metadata).includes("prioritized"));
}

function countRows<T>(
  items: T[],
  getMeta: (item: T) => { key: string; fila_prioridade?: boolean },
): Array<{ key: string; count: number; fila_prioridade: boolean }> {
  const counts = items.reduce<Map<string, { count: number; fila_prioridade: boolean }>>((acc, item) => {
    const meta = getMeta(item);
    const current = acc.get(meta.key) ?? { count: 0, fila_prioridade: false };
    acc.set(meta.key, {
      count: current.count + 1,
      fila_prioridade: current.fila_prioridade || Boolean(meta.fila_prioridade),
    });
    return acc;
  }, new Map());

  return Array.from(counts.entries())
    .map(([key, row]) => ({ key, count: row.count, fila_prioridade: row.fila_prioridade }))
    .sort((left, right) => right.count - left.count);
}

function extractGeminiText(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("candidates" in payload) || !Array.isArray(payload.candidates)) return null;
  const candidate = payload.candidates[0];
  if (!candidate || typeof candidate !== "object" || !("content" in candidate)) return null;
  const content = candidate.content;
  if (!content || typeof content !== "object" || !("parts" in content) || !Array.isArray(content.parts)) return null;
  return content.parts
    .map((part: unknown) => (part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : ""))
    .join("\n")
    .trim();
}

function extractGeminiError(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return null;
  const error = payload.error;
  if (!error || typeof error !== "object" || !("message" in error) || typeof error.message !== "string") return null;
  return error.message;
}

function inDateRange(date: string, start: string, end: string) {
  return date >= start && date <= end;
}

function formatDateForPrompt(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}
