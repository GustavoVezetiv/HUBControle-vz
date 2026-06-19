import type { AppSupabaseClient } from "@/features/shared/types";
import { buildWeeklyDerivedData, resolveRoutineTaskContext } from "@/features/weekly-review/derived";
import type {
  Json,
  RoutineAiSummary,
  RoutineCategory,
  RoutineTask,
  RoutineTaskEvent,
  RoutineTaskList,
  RoutineGoogleConnection,
  RoutineSyncRun,
} from "@/lib/supabase/types";

export const GEMINI_WEEKLY_REVIEW_MODEL = process.env.GEMINI_WEEKLY_REVIEW_MODEL ?? "gemini-2.5-flash";
export const GEMINI_WEEKLY_REVIEW_MAX_OUTPUT_TOKENS = Number.parseInt(process.env.GEMINI_WEEKLY_REVIEW_MAX_OUTPUT_TOKENS ?? "3000", 10);
export const GEMINI_WEEKLY_REVIEW_THINKING_BUDGET = Number.parseInt(process.env.GEMINI_WEEKLY_REVIEW_THINKING_BUDGET ?? "0", 10);
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
  contexto_lista?: string;
  tipo_lista?: string;
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
  sincronizacao_base: {
    sincronizado_em: string | null;
    tipo: "manual" | "automatico" | "indisponivel";
    origem: string;
  };
  listas: Array<{
    nome: string;
    tipo: string;
    contexto: string;
    abertas: number;
    concluidas_semana: number;
  }>;
  movimento_semana: {
    concluidas_reais: number;
    criadas_apos_baseline: number;
    priorizadas_reais: number;
    reabertas: number;
    prazos_alterados: number;
  };
  estado_atual: {
    total_em_aberto: number;
    total_em_geral_hoje: number;
    tarefas_sem_data: number;
    tarefas_vencidas: number;
    tarefas_paradas: number;
  };
  categorias: {
    mais_trabalhadas: WeeklyAiCategoryCount[];
    negligenciadas: WeeklyAiCategoryCount[];
  };
  tarefas_concluidas_relevantes: WeeklyAiTaskItem[];
  tarefas_abertas_relevantes: WeeklyAiTaskItem[];
  tarefas_paradas: WeeklyAiTaskItem[];
  tarefas_em_listas_execucao: WeeklyAiTaskItem[];
  tarefas_em_listas_referencia: WeeklyAiTaskItem[];
  eventos_relevantes: WeeklyAiEventItem[];
  observacoes_do_sistema: string[];
};

type GeminiResponseMetadata = {
  finishReason: string | null;
  promptTokenCount: number | null;
  candidatesTokenCount: number | null;
  thoughtsTokenCount: number | null;
  totalTokenCount: number | null;
  safetyRatings: unknown;
  promptFeedback: unknown;
  rawError: string | null;
  model: string;
  maxOutputTokens: number;
  thinkingBudget: number;
  textLength: number | null;
};

type WeeklyAiInputLimits = {
  completed: number;
  open: number;
  events: number;
};

type WeeklyAiSourceData = {
  tasks: RoutineTask[];
  events: RoutineTaskEvent[];
  taskLists: RoutineTaskList[];
  categories: RoutineCategory[];
  connection: RoutineGoogleConnection | null;
  syncRuns: RoutineSyncRun[];
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

  let inputSummary = buildWeeklyAiInputSummary(sourceResult.data, weekStart, weekEnd);
  let geminiResult = await requestGeminiWeeklyAnalysis(inputSummary);
  const firstAttemptMetadata = geminiResult.metadata;

  if (isGeminiMaxTokens(firstAttemptMetadata)) {
    inputSummary = buildWeeklyAiInputSummary(sourceResult.data, weekStart, weekEnd, { completed: 8, open: 8, events: 5 });
    geminiResult = await requestGeminiWeeklyAnalysis(inputSummary);
  }

  const normalizedAnalysis = geminiResult.data ? normalizeGeminiAnalysisText(geminiResult.data) : null;
  const finishError = getGeminiFinishError(geminiResult.metadata);
  const validationResult = normalizedAnalysis && !finishError ? validateGeminiAnalysisText(normalizedAnalysis.text) : null;
  const analysisError = geminiResult.error ?? finishError ?? validationResult?.error ?? null;
  const summaryText = analysisError ? null : normalizedAnalysis?.text ?? null;
  const inputSummaryWithMetadata = {
    ...inputSummary,
    metadata: {
      gemini: geminiResult.metadata,
      firstAttempt: firstAttemptMetadata !== geminiResult.metadata ? firstAttemptMetadata : null,
      responseNormalization: normalizedAnalysis?.metadata ?? null,
      validation: validationResult?.metadata ?? null,
    },
  };

  const summaryRow = {
    user_id: userId,
    week_start: weekStart,
    week_end: weekEnd,
    provider: GEMINI_PROVIDER,
    model: GEMINI_WEEKLY_REVIEW_MODEL,
    input_summary_json: inputSummaryWithMetadata as unknown as Json,
    summary_text: summaryText,
    error_message: analysisError?.technical ?? null,
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

  if (analysisError) {
    return {
      data: saveResult.data as RoutineAiSummary,
      error: analysisError,
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
  const [tasksResult, eventsResult, listsResult, categoriesResult, connectionResult, syncRunsResult] = await Promise.all([
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
    client.from("routine_google_connections").select("*").eq("user_id", userId).eq("provider", "google_tasks").maybeSingle(),
    client.from("routine_sync_runs").select("*").eq("user_id", userId).eq("provider", "google_tasks").order("started_at", { ascending: false }).limit(3),
  ]);

  const error =
    tasksResult.error ||
    eventsResult.error ||
    listsResult.error ||
    categoriesResult.error ||
    connectionResult.error ||
    syncRunsResult.error;
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
      connection: (connectionResult.data ?? null) as RoutineGoogleConnection | null,
      syncRuns: (syncRunsResult.data ?? []) as RoutineSyncRun[],
    },
    error: null,
  };
}

function resolveWeeklyAiSyncBase(
  connection: RoutineGoogleConnection | null,
  syncRuns: RoutineSyncRun[],
): WeeklyAiInputSummary["sincronizacao_base"] {
  const latestRun = syncRuns[0] ?? null;
  const syncedAt = connection?.last_successful_sync_at ?? connection?.last_sync_at ?? latestRun?.finished_at ?? latestRun?.started_at ?? null;

  return {
    sincronizado_em: syncedAt,
    tipo: "indisponivel",
    origem: latestRun ? "Última sincronização registrada no Hub." : "Sem sync run detalhado disponível.",
  };
}

export function buildWeeklyAiInputSummary(
  data: WeeklyAiSourceData,
  weekStart: string,
  weekEnd: string,
  limits: WeeklyAiInputLimits = { completed: 12, open: 12, events: 10 },
): WeeklyAiInputSummary {
  const listByGoogleId = new Map(data.taskLists.map((list) => [list.google_task_list_id, list]));
  const taskByGoogleId = new Map(data.tasks.map((task) => [task.google_task_id, task]));
  const derived = buildWeeklyDerivedData(data.tasks, data.events, data.taskLists, data.categories, weekStart, weekEnd);
  const syncBase = resolveWeeklyAiSyncBase(data.connection, data.syncRuns);
  const neglectedCategories = derived.countByCategory
    .filter((row) => row.label !== (derived.areaMostWorked?.label ?? ""))
    .slice(0, 3)
    .map((row) => ({ nome: row.label, total: row.count }));
  const staleOrRiskyTasks = uniqueTasks([
    ...derived.staleTasks,
    ...derived.overdueTasks,
    ...derived.tasksWithoutDate,
  ]).slice(0, limits.open);

  const observations: string[] = [];
  if (data.tasks.length === 0) observations.push("Nenhuma tarefa sincronizada foi encontrada no Hub.");
  if (derived.completedThisWeek.length === 0) observations.push("Nenhuma tarefa concluída foi registrada no período selecionado.");
  if (derived.realEventsThisWeek.length === 0) observations.push("Nenhum evento real de mudança foi registrado no período selecionado.");
  if (derived.prioritizedEvents.length > 0) observations.push("Geral/Hoje foi tratado como fila de prioridade, não como categoria real.");
  if (derived.inheritedPriorityEventsThisWeek.length >= 5) observations.push("A fila Geral/Hoje ainda contém muitos itens herdados da primeira sincronização. Use a análise como referência inicial.");

  const executionTasks = derived.openTasks
    .filter((task) => {
      const context = resolveRoutineTaskContext(task, listByGoogleId, new Map(data.categories.map((category) => [category.id, category.name])));
      return context.listContext?.listType === "execution" || context.listContext?.listType === "priority_queue";
    })
    .slice(0, limits.open);
  const referenceTasks = derived.openTasks
    .filter((task) => {
      const context = resolveRoutineTaskContext(task, listByGoogleId, new Map(data.categories.map((category) => [category.id, category.name])));
      return ["backlog", "reference", "leisure", "content", "places"].includes(context.listContext?.listType ?? "");
    })
    .slice(0, limits.open);

  return {
    periodo: `${formatDateForPrompt(weekStart)} até ${formatDateForPrompt(weekEnd)}`,
    sincronizacao_base: syncBase,
    listas: data.taskLists.map((list) => {
      const openInList = derived.openTasks.filter((task) => task.google_task_list_id === list.google_task_list_id);
      const completedInList = derived.completedThisWeek.filter((task) => task.google_task_list_id === list.google_task_list_id);
      const context = openInList[0]
        ? resolveRoutineTaskContext(openInList[0], listByGoogleId, new Map(data.categories.map((category) => [category.id, category.name]))).listContext
        : null;
      return {
        nome: list.title,
        tipo: context?.listType ?? (list.is_priority_queue ? "priority_queue" : "reference"),
        contexto: context?.label ?? "Lista sem contexto confirmado",
        abertas: openInList.length,
        concluidas_semana: completedInList.length,
      };
    }),
    movimento_semana: {
      concluidas_reais: derived.completedThisWeek.length,
      criadas_apos_baseline: derived.createdAfterBaselineEvents.length,
      priorizadas_reais: derived.prioritizedEvents.length,
      reabertas: derived.reopenedEvents.length,
      prazos_alterados: derived.dueDateChangedEvents.length,
    },
    estado_atual: {
      total_em_aberto: derived.openTasks.length,
      total_em_geral_hoje: derived.priorityQueueTasks.length,
      tarefas_sem_data: derived.tasksWithoutDate.length,
      tarefas_vencidas: derived.overdueTasks.length,
      tarefas_paradas: derived.staleTasks.length,
    },
    categorias: {
      mais_trabalhadas: derived.areaMostWorked ? [{ nome: derived.areaMostWorked.label, total: derived.areaMostWorked.count }] : [],
      negligenciadas: neglectedCategories,
    },
    tarefas_concluidas_relevantes: derived.completedThisWeek.slice(0, limits.completed).map((task) => toAiTaskItem(task, listByGoogleId, data.categories, true)),
    tarefas_abertas_relevantes: staleOrRiskyTasks.map((task) => toAiTaskItem(task, listByGoogleId, data.categories, false)),
    tarefas_paradas: derived.staleTasks.slice(0, limits.open).map((task) => toAiTaskItem(task, listByGoogleId, data.categories, false)),
    tarefas_em_listas_execucao: executionTasks.map((task) => toAiTaskItem(task, listByGoogleId, data.categories, false)),
    tarefas_em_listas_referencia: referenceTasks.map((task) => toAiTaskItem(task, listByGoogleId, data.categories, false)),
    eventos_relevantes: [
      ...derived.prioritizedEvents,
      ...derived.reopenedEvents,
      ...derived.dueDateChangedEvents,
      ...derived.createdAfterBaselineEvents,
    ].slice(0, limits.events).map((event) => toAiEventItem(event, taskByGoogleId, listByGoogleId)),
    observacoes_do_sistema: observations,
  };
}

async function requestGeminiWeeklyAnalysis(
  inputSummary: WeeklyAiInputSummary,
): Promise<{ data: string | null; error: { message: string; technical?: string } | null; metadata: GeminiResponseMetadata }> {
  const maxOutputTokens = Number.isFinite(GEMINI_WEEKLY_REVIEW_MAX_OUTPUT_TOKENS) ? GEMINI_WEEKLY_REVIEW_MAX_OUTPUT_TOKENS : 3000;
  const thinkingBudget = Number.isFinite(GEMINI_WEEKLY_REVIEW_THINKING_BUDGET) ? GEMINI_WEEKLY_REVIEW_THINKING_BUDGET : 0;
  const baseMetadata = createGeminiMetadata(null, null, maxOutputTokens, thinkingBudget, null);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      data: null,
      error: {
        message: "GEMINI_API_KEY não configurada.",
        technical: "Missing GEMINI_API_KEY",
      },
      metadata: { ...baseMetadata, rawError: "Missing GEMINI_API_KEY" },
    };
  }

  const prompt = [
    "Você é um assistente de revisão semanal.",
    "Use somente o JSON e gere uma revisão objetiva entre 900 e 1400 caracteres.",
    "Responda em Markdown simples ou texto estruturado. Não retorne JSON. Não use bloco de código. Não use ```json.",
    "Não invente tarefas, não cite IDs e não encerre frase pela metade.",
    "Geral/Hoje é fila de prioridade, não categoria. Não deixe Geral/Hoje dominar a análise.",
    "Considere o nome da lista do Google Tasks como forte sinal de contexto quando a categoria não estiver confirmada no Hub.",
    "Listas de referencia, lazer, backlog, jogos, coisas para assistir e lugares para fazer nao devem ser tratadas como urgencia so por terem itens abertos.",
    "Se citar tarefas concluídas, destaque no máximo 5 exemplos relevantes.",
    "Use estes títulos nesta ordem:",
    "",
    "Resumo da semana",
    "O que foi feito",
    "O que está pendente",
    "Listas de referência",
    "Sugestões práticas",
    "Ideias opcionais",
    "Coisas para revisar",
    "",
    "Dados compactos do Hub:",
    JSON.stringify(inputSummary),
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
            maxOutputTokens,
            thinkingConfig: {
              thinkingBudget,
            },
          },
        }),
      },
    );

    const payload = await response.json().catch(() => null);
    const metadata = createGeminiMetadata(payload, null, maxOutputTokens, thinkingBudget, null);

    if (!response.ok) {
      console.error("Erro técnico da API Gemini:", payload);
      const technicalError = extractGeminiError(payload) ?? `HTTP ${response.status}`;
      return {
        data: null,
        error: {
          message: isGeminiModelUnavailableError(technicalError)
            ? "Modelo Gemini indisponível. Verifique GEMINI_WEEKLY_REVIEW_MODEL nas variáveis de ambiente."
            : "Não foi possível gerar a análise com Gemini.",
          technical: technicalError,
        },
        metadata: { ...metadata, rawError: summarizeRawError(technicalError) },
      };
    }

    const text = extractGeminiText(payload);
    const metadataWithText = createGeminiMetadata(payload, null, maxOutputTokens, thinkingBudget, text?.length ?? null);
    if (!text) {
      console.error("Resposta Gemini sem texto:", payload);
      const finishError = getGeminiFinishError(metadataWithText);
      return {
        data: null,
        error: finishError ?? {
          message: "Gemini respondeu sem texto de análise.",
          technical: "Empty Gemini response",
        },
        metadata: metadataWithText,
      };
    }

    return { data: text, error: null, metadata: metadataWithText };
  } catch (error) {
    console.error("Erro técnico ao chamar Gemini:", error);
    const technical = error instanceof Error ? error.message : "Unknown Gemini request error";
    return {
      data: null,
      error: {
        message: "Não foi possível chamar o Gemini.",
        technical,
      },
      metadata: { ...baseMetadata, rawError: summarizeRawError(technical) },
    };
  }
}

function validateGeminiAnalysisText(text: string): { error: { message: string; technical: string }; metadata: { characterCount: number; matchedSections: string[] } } | { error: null; metadata: { characterCount: number; matchedSections: string[] } } {
  const normalized = text.trim();
  const matchedSections = expectedAiSections.filter((section) => hasSection(normalized, section));
  const metadata = { characterCount: normalized.length, matchedSections };

  if (normalized.length <= 700) {
    return {
      error: {
        message: "Resposta da IA incompleta. Gere novamente.",
        technical: `Resposta da IA incompleta. Tamanho recebido: ${normalized.length} caracteres.`,
      },
      metadata,
    };
  }

  if (matchedSections.length < 4) {
    return {
      error: {
        message: "Resposta da IA incompleta. Gere novamente.",
        technical: `Resposta da IA sem estrutura mínima. Seções encontradas: ${matchedSections.join(", ") || "nenhuma"}.`,
      },
      metadata,
    };
  }

  const lower = normalized.toLocaleLowerCase("pt-BR");
  const truncatedEndings = [
    " de",
    " e",
    " para",
    " com",
    " em",
    " a",
    " a abertura de",
  ];

  if (truncatedEndings.some((ending) => lower.endsWith(ending))) {
    return {
      error: {
        message: "Resposta da IA incompleta. Gere novamente.",
        technical: "Resposta da IA parece ter sido truncada no final.",
      },
      metadata,
    };
  }

  return { error: null, metadata };
}

function normalizeGeminiAnalysisText(text: string): { text: string; metadata: { source: "json" | "code_fence" | "text"; extractedSections: string[] } } {
  const stripped = stripCodeFence(text.trim());
  const source = stripped !== text.trim() ? "code_fence" : "text";
  const parsed = tryParseJson(stripped);

  if (parsed) {
    const sectionRecord = extractWeeklyReviewRecord(parsed);
    if (sectionRecord) {
      const extractedSections = expectedAiSections.filter((section) => getAiSectionValue(sectionRecord, section) !== undefined);
      return {
        text: formatSectionRecord(sectionRecord),
        metadata: { source: "json", extractedSections },
      };
    }
  }

  return {
    text: stripped,
    metadata: { source, extractedSections: [] },
  };
}

function stripCodeFence(value: string) {
  return value
    .replace(/^```(?:json|markdown|md|text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function tryParseJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractWeeklyReviewRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const nested = record.revisao_semanal ?? record.revisão_semanal ?? record.weekly_review ?? record.review;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested as Record<string, unknown>;
  if (expectedAiSections.some((section) => getAiSectionValue(record, section) !== undefined)) return record;
  return null;
}

function formatSectionRecord(record: Record<string, unknown>) {
  return expectedAiSections
    .map((section) => {
      const value = getAiSectionValue(record, section);
      if (value === undefined || value === null) return null;
      return `${section}\n${formatSectionValue(value)}`;
    })
    .filter((section): section is string => Boolean(section))
    .join("\n\n");
}

function getAiSectionValue(record: Record<string, unknown>, section: string) {
  if (record[section] !== undefined) return record[section];

  const alias = Object.entries(aiSectionAliases).find(([, target]) => target === section)?.[0];

  return alias ? record[alias] : undefined;
}

function formatSectionValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => `- ${formatPrimitiveValue(item)}`).join("\n");
  }
  return formatPrimitiveValue(value);
}

function formatPrimitiveValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function toAiTaskItem(
  task: RoutineTask,
  listByGoogleId: Map<string, RoutineTaskList>,
  categories: RoutineCategory[],
  includeCompletedAt: boolean,
): WeeklyAiTaskItem {
  const context = resolveRoutineTaskContext(task, listByGoogleId, new Map(categories.map((category) => [category.id, category.name])));
  return {
    titulo: task.title,
    lista: context.listTitle,
    categoria: context.categoryLabel,
    contexto_lista: context.listContext?.label ?? "Sem contexto claro",
    tipo_lista: context.listContext?.listType ?? "indefinido",
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

function uniqueTasks(tasks: RoutineTask[]) {
  return Array.from(new Map(tasks.map((task) => [task.id, task])).values());
}

const expectedAiSections = [
  "Resumo da semana",
  "O que foi feito",
  "O que está pendente",
  "Listas de referência",
  "Sugestões práticas",
  "Ideias opcionais",
  "Coisas para revisar",
];

const aiSectionAliases: Record<string, string> = {
  "Avanços": "O que foi feito",
  "Principais avanços": "O que foi feito",
  "Focos da semana": "O que foi feito",
  "Pendências": "O que está pendente",
  "Pendencias": "O que está pendente",
  "Pontos negligenciados": "O que está pendente",
  "Áreas negligenciadas": "O que está pendente",
  "Listas de referencia": "Listas de referência",
  "Sugestões da IA": "Sugestões práticas",
  "Sugestoes da IA": "Sugestões práticas",
  "Próxima semana": "Sugestões práticas",
  "Sugestões para a próxima semana": "Sugestões práticas",
  "Sugestão para a próxima semana": "Sugestões práticas",
};

function getGeminiFinishError(metadata: GeminiResponseMetadata): { message: string; technical: string } | null {
  const finishReason = metadata.finishReason?.toUpperCase() ?? null;
  const blockReason = extractBlockReason(metadata.promptFeedback)?.toUpperCase() ?? null;

  if (finishReason === "MAX_TOKENS") {
    return {
      message: "Resposta cortada por limite de tokens. O Hub vai reduzir os dados enviados e tentar novamente.",
      technical: `Gemini finishReason=MAX_TOKENS; usage=${JSON.stringify({
        promptTokenCount: metadata.promptTokenCount,
        candidatesTokenCount: metadata.candidatesTokenCount,
        totalTokenCount: metadata.totalTokenCount,
        maxOutputTokens: metadata.maxOutputTokens,
        thinkingBudget: metadata.thinkingBudget,
      })}`,
    };
  }

  if (finishReason && ["SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"].includes(finishReason)) {
    return {
      message: "Resposta bloqueada pelo provedor. Revise os dados enviados.",
      technical: `Gemini finishReason=${finishReason}; safetyRatings=${JSON.stringify(metadata.safetyRatings ?? null)}`,
    };
  }

  if (blockReason) {
    return {
      message: "Resposta bloqueada pelo provedor. Revise os dados enviados.",
      technical: `Gemini promptFeedback.blockReason=${blockReason}`,
    };
  }

  return null;
}

function createGeminiMetadata(payload: unknown, rawError: string | null, maxOutputTokens: number, thinkingBudget: number, textLength: number | null): GeminiResponseMetadata {
  const candidate = extractFirstCandidate(payload);
  const usageMetadata = extractRecord(payload, "usageMetadata");
  return {
    finishReason: extractString(candidate, "finishReason"),
    promptTokenCount: extractNumber(usageMetadata, "promptTokenCount"),
    candidatesTokenCount: extractNumber(usageMetadata, "candidatesTokenCount"),
    totalTokenCount: extractNumber(usageMetadata, "totalTokenCount"),
    thoughtsTokenCount: extractNumber(usageMetadata, "thoughtsTokenCount"),
    safetyRatings: candidate && "safetyRatings" in candidate ? candidate.safetyRatings : null,
    promptFeedback: extractRecord(payload, "promptFeedback"),
    rawError: rawError ? summarizeRawError(rawError) : null,
    model: GEMINI_WEEKLY_REVIEW_MODEL,
    maxOutputTokens,
    thinkingBudget,
    textLength,
  };
}

function isGeminiMaxTokens(metadata: GeminiResponseMetadata) {
  return metadata.finishReason?.toUpperCase() === "MAX_TOKENS";
}

function extractFirstCandidate(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || !("candidates" in payload) || !Array.isArray(payload.candidates)) return null;
  const candidate = payload.candidates[0];
  return candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate as Record<string, unknown> : null;
}

function extractRecord(payload: unknown, key: string): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || !(key in payload)) return null;
  const value = (payload as Record<string, unknown>)[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function extractString(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

function extractNumber(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "number" ? value : null;
}

function extractBlockReason(promptFeedback: unknown) {
  if (!promptFeedback || typeof promptFeedback !== "object" || Array.isArray(promptFeedback)) return null;
  const value = (promptFeedback as Record<string, unknown>).blockReason;
  return typeof value === "string" ? value : null;
}

function summarizeRawError(value: string) {
  return value.length > 500 ? `${value.slice(0, 500)}...` : value;
}

function hasSection(text: string, section: string) {
  const normalizedText = normalizeSectionText(text);
  const normalizedSection = normalizeSectionText(section);
  return normalizedText.includes(normalizedSection);
}

function normalizeSectionText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\*\*/g, "")
    .replace(/#+/g, "")
    .toLowerCase()
    .trim();
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

function isGeminiModelUnavailableError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("model") && (normalized.includes("not found") || normalized.includes("not supported"));
}

function formatDateForPrompt(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}
