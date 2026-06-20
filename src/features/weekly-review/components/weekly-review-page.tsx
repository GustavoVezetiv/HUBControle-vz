"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { loadSystemPreferences } from "@/features/settings/system-preferences";
import { ActionButton, CrudFeedback, FieldShell, inputClassName, TextBadge } from "@/features/shared/crud-ui";
import { formatDate } from "@/features/shared/format";
import type { FeedbackState } from "@/features/shared/types";
import { buildWeeklyDerivedData, resolveRoutineTaskContext } from "@/features/weekly-review/derived";
import { loadWeeklyReviewData, updateTaskConfirmedCategory } from "@/features/weekly-review/queries";
import type { WeeklyReviewData, WeeklyReviewSummary } from "@/features/weekly-review/types";
import type { RoutineAiSummary, RoutineCategory, RoutineTask, RoutineTaskEvent, RoutineTaskList } from "@/lib/supabase/types";
import { createClient } from "@/lib/supabase/client";

type SyncResult = {
  syncedAt: string;
  syncRunId: string | null;
  listsRead: number;
  tasksRead: number;
  createdTasks: number;
  updatedTasks: number;
  eventsCreated: number;
  reportsUpdated: number;
};

type ReviewTab = "summary" | "completed" | "priorities" | "pending" | "kanban" | "month" | "technical";

const reviewTabs: Array<{ id: ReviewTab; label: string }> = [
  { id: "summary", label: "Resumo" },
  { id: "completed", label: "Concluídas" },
  { id: "priorities", label: "Prioridades" },
  { id: "pending", label: "Pendências" },
  { id: "kanban", label: "Kanban" },
  { id: "month", label: "Mês" },
  { id: "technical", label: "Dados técnicos" },
];

export function WeeklyReviewPage() {
  const searchParams = useSearchParams();
  const actionHandledRef = useRef<string | null>(null);
  const defaultTabAppliedForUserRef = useRef<string | null>(null);
  const [data, setData] = useState<WeeklyReviewData | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [savingCategoryId, setSavingCategoryId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);
  const [monthFilter, setMonthFilter] = useState(() => new Date().toISOString().slice(0, 7));
  const [selectedWeekStart, setSelectedWeekStart] = useState(() => toDateInputValue(startOfWeek(new Date())));
  const [activeTab, setActiveTab] = useState<ReviewTab>("summary");

  const loadData = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const client = createClient();
      const authResult = await client.auth.getUser();
      if (authResult.error || !authResult.data.user) {
        setFeedback({ type: "error", message: "Sessão não encontrada. Entre novamente." });
        return;
      }

      setUserId(authResult.data.user.id);
      if (defaultTabAppliedForUserRef.current !== authResult.data.user.id) {
        setActiveTab(loadSystemPreferences(authResult.data.user.id).weeklyReviewDefaultTab);
        defaultTabAppliedForUserRef.current = authResult.data.user.id;
      }
      const result = await loadWeeklyReviewData(client, authResult.data.user.id);

      if (result.error || !result.data) {
        setFeedback({ type: "error", message: result.error?.message ?? "Não foi possível carregar a revisão semanal." });
        return;
      }

      setData(result.data);
    } catch (error) {
      console.error("Erro técnico ao carregar revisão semanal:", error);
      setFeedback({ type: "error", message: "Não foi possível carregar a revisão semanal." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const googleError = params.get("google_error");
    const googleStatus = params.get("google");

    if (googleError) {
      setFeedback({ type: "error", message: googleError });
    } else if (googleStatus === "connected") {
      setFeedback({ type: "success", message: "Google Tasks conectado. Clique em Sincronizar agora para importar o histórico." });
    } else if (googleStatus === "missing_refresh_token") {
      setFeedback({ type: "error", message: "Google conectou sem refresh token. Reconecte autorizando acesso offline." });
    }
  }, []);

  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    if (!requestedTab) return;
    if (reviewTabs.some((tab) => tab.id === requestedTab)) {
      setActiveTab(requestedTab as ReviewTab);
    }
  }, [searchParams]);

  const selectedWeekEnd = useMemo(() => addDays(selectedWeekStart, 6), [selectedWeekStart]);
  const summary = useMemo(() => buildWeeklySummary(data, selectedWeekStart, selectedWeekEnd), [data, selectedWeekStart, selectedWeekEnd]);
  const taskByGoogleId = useMemo(() => new Map((data?.tasks ?? []).map((task) => [task.google_task_id, task])), [data?.tasks]);
  const listByGoogleId = useMemo(() => new Map((data?.taskLists ?? []).map((list) => [list.google_task_list_id, list])), [data?.taskLists]);
  const aiSummary = useMemo(
    () => data?.aiSummaries.find((item) => item.week_start === selectedWeekStart) ?? null,
    [data?.aiSummaries, selectedWeekStart],
  );
  const latestSyncRun = data?.syncRuns[0] ?? null;
  const monthlyWeeks = useMemo(() => buildMonthlyWeeks(data, monthFilter), [data, monthFilter]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setFeedback(null);
    setLastSyncResult(null);

    try {
      const response = await fetch("/api/routine/google-tasks/sync", { method: "POST" });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setFeedback({ type: "error", message: payload?.error ?? "Não foi possível sincronizar o Google Tasks." });
        return;
      }

      setLastSyncResult(payload as SyncResult);
      setFeedback({ type: "success", message: "Sincronização concluída." });
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao sincronizar Google Tasks:", error);
      setFeedback({ type: "error", message: "Não foi possível sincronizar o Google Tasks." });
    } finally {
      setSyncing(false);
    }
  }, [loadData]);

  async function handleConfirmCategory(task: RoutineTask, categoryId: string) {
    if (!userId) return;
    setSavingCategoryId(task.id);
    setFeedback(null);
    try {
      const result = await updateTaskConfirmedCategory(createClient(), userId, task.id, categoryId || null);
      if (result.error) {
        setFeedback({ type: "error", message: result.error.message });
        return;
      }
      setFeedback({ type: "success", message: "Categoria confirmada no Hub. A tarefa original não foi alterada no Google Tasks." });
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao confirmar categoria:", error);
      setFeedback({ type: "error", message: "Não foi possível confirmar a categoria." });
    } finally {
      setSavingCategoryId(null);
    }
  }

  const handleGenerateAnalysis = useCallback(async () => {
    setAnalyzing(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/routine/weekly-review/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart: selectedWeekStart, weekEnd: selectedWeekEnd }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || payload?.error) {
        if (payload?.technical) console.error("Erro técnico ao gerar análise Gemini:", payload.technical);
        setFeedback({ type: "error", message: payload?.error ?? "Não foi possível gerar a análise da semana." });
        await loadData();
        return;
      }

      setFeedback({ type: "success", message: "Análise da semana gerada e salva." });
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao gerar análise da semana:", error);
      setFeedback({ type: "error", message: "Não foi possível gerar a análise da semana." });
    } finally {
      setAnalyzing(false);
    }
  }, [loadData, selectedWeekEnd, selectedWeekStart]);

  useEffect(() => {
    const requestedAction = searchParams.get("action");
    if (!requestedAction || actionHandledRef.current === requestedAction) return;
    if (requestedAction === "sync" && !syncing && data?.connection?.status === "connected") {
      actionHandledRef.current = requestedAction;
      void handleSync();
      return;
    }
    if (requestedAction === "analyze" && !analyzing) {
      actionHandledRef.current = requestedAction;
      void handleGenerateAnalysis();
    }
  }, [analyzing, data?.connection?.status, handleGenerateAnalysis, handleSync, searchParams, syncing]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Rotina"
        title="Revisão semanal"
        description="Revisão prática do Google Tasks para acompanhar execução, prioridade e pendências da semana."
        action={
          <div className="flex flex-wrap gap-2">
            <a href="/api/routine/google-tasks/connect">
              <ActionButton type="button" variant="secondary">
                Conectar Google Tasks
              </ActionButton>
            </a>
            <ActionButton type="button" onClick={() => void handleSync()} disabled={syncing || data?.connection?.status !== "connected"}>
              {syncing ? "Sincronizando..." : "Sincronizar agora"}
            </ActionButton>
          </div>
        }
      />

      <CrudFeedback feedback={feedback} />

      {loading ? (
        <SectionCard title="Carregando revisão">
          <p className="text-sm text-ink-600 dark:text-slate-300">Lendo dados sincronizados do Hub.</p>
        </SectionCard>
      ) : !data?.connection ? (
        <SectionCard title="Conectar Google Tasks">
          <EmptyState
            title="Google Tasks ainda não conectado"
            description="Conecte sua conta para iniciar a primeira sincronização manual. O Hub usa acesso somente leitura."
          />
        </SectionCard>
      ) : (
        <>
          <SummarySection
            summary={summary}
            selectedWeekStart={selectedWeekStart}
            selectedWeekEnd={selectedWeekEnd}
            onWeekChange={setSelectedWeekStart}
          />

          <WeeklyAiAnalysisSection
            aiSummary={aiSummary}
            hasEnoughData={summary.completedThisWeek.length + summary.openTasks.length + summary.eventsThisWeek.length > 0}
            hasInflatedInitialEvents={summary.hasInflatedInitialEvents}
            analyzing={analyzing}
            onGenerate={() => void handleGenerateAnalysis()}
            syncRun={latestSyncRun}
          />

          <div className="hub-card flex flex-wrap gap-2 rounded-xl border border-ink-950/10 p-2 shadow-sm dark:border-white/10">
            {reviewTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  activeTab === tab.id
                    ? "border-mint-500 bg-mint-50 text-ink-950 dark:bg-slate-100 dark:text-slate-950"
                    : "text-ink-700 hover:bg-ink-950/5 dark:text-slate-200 dark:hover:bg-white/10"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "completed" ? (
            <CompletedByCategorySection
              tasks={summary.completedThisWeek}
              categories={data.categories}
              taskLists={data.taskLists}
              onConfirmCategory={(task, categoryId) => void handleConfirmCategory(task, categoryId)}
              savingCategoryId={savingCategoryId}
            />
          ) : null}

          {activeTab === "summary" ? (
            <WeeklySummaryDetailSection
              completedThisWeek={summary.completedThisWeek}
              prioritizedEvents={summary.prioritizedEvents}
              overdueTasks={summary.overdueTasks}
              staleTasks={summary.staleTasks}
              tasksWithoutDate={summary.tasksWithoutDate}
              taskByGoogleId={taskByGoogleId}
            />
          ) : null}

          {activeTab === "priorities" ? (
            <PrioritiesSection events={summary.prioritizedEvents} taskByGoogleId={taskByGoogleId} listByGoogleId={listByGoogleId} />
          ) : null}

          {activeTab === "pending" ? (
            <OpenAndStaleSection
              overdueTasks={summary.overdueTasks}
              openRecentTasks={summary.openRecentTasks}
              staleTasks={summary.staleTasks}
              tasksWithoutDate={summary.tasksWithoutDate}
              tasksDueThisWeek={summary.tasksDueThisWeek}
              categories={data.categories}
              taskLists={data.taskLists}
              onConfirmCategory={(task, categoryId) => void handleConfirmCategory(task, categoryId)}
              savingCategoryId={savingCategoryId}
            />
          ) : null}

          {activeTab === "kanban" ? (
            <WeeklyKanbanSection tasks={summary.openTasks} taskLists={data.taskLists} categories={data.categories} />
          ) : null}

          {activeTab === "month" ? (
            <MonthSection
              monthFilter={monthFilter}
              monthlyWeeks={monthlyWeeks}
              selectedWeekStart={selectedWeekStart}
              onMonthChange={setMonthFilter}
              onSelectWeek={(weekStart) => {
                setSelectedWeekStart(weekStart);
                setActiveTab("completed");
              }}
            />
          ) : null}

          {activeTab === "technical" ? (
            <TechnicalSection
              data={data}
              latestSyncRun={latestSyncRun}
              lastSyncResult={lastSyncResult}
              summary={summary}
              taskByGoogleId={taskByGoogleId}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function WeeklySummaryDetailSection({
  completedThisWeek,
  prioritizedEvents,
  overdueTasks,
  staleTasks,
  tasksWithoutDate,
  taskByGoogleId,
}: {
  completedThisWeek: RoutineTask[];
  prioritizedEvents: RoutineTaskEvent[];
  overdueTasks: RoutineTask[];
  staleTasks: RoutineTask[];
  tasksWithoutDate: RoutineTask[];
  taskByGoogleId: Map<string, RoutineTask>;
}) {
  const priorityTasks = prioritizedEvents
    .map((event) => taskByGoogleId.get(event.google_task_id) ?? null)
    .filter((task): task is RoutineTask => Boolean(task))
    .slice(0, 5);

  return (
    <section className="grid gap-4 xl:grid-cols-3">
      <SectionCard title="Concluídas recentes" description="Amostra rápida do que saiu do papel na semana.">
        {completedThisWeek.length === 0 ? (
          <EmptyState title="Nada concluído" description="Quando houver entregas concluídas, elas aparecem aqui." />
        ) : (
          <div className="space-y-2">
            {completedThisWeek.slice(0, 5).map((task) => (
              <div key={task.id} className="hub-card rounded-md border border-ink-950/10 px-3 py-2 text-sm dark:border-white/10">
                <p className="font-medium text-ink-950 dark:text-slate-100">{task.title}</p>
                <p className="mt-1 text-xs text-ink-600 dark:text-slate-300">
                  {task.completed_at ? formatDate(task.completed_at.slice(0, 10)) : "Sem data de conclusão"}
                </p>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Prioridades reais" description="Itens realmente movidos para a fila Geral/Hoje após o baseline.">
        {priorityTasks.length === 0 ? (
          <EmptyState title="Sem prioridades reais" description="Nenhuma tarefa foi movida para a fila Geral/Hoje nesta semana." />
        ) : (
          <div className="space-y-2">
            {priorityTasks.map((task) => (
              <div key={task.id} className="hub-card rounded-md border border-ink-950/10 px-3 py-2 text-sm dark:border-white/10">
                <p className="font-medium text-ink-950 dark:text-slate-100">{task.title}</p>
                <p className="mt-1 text-xs text-ink-600 dark:text-slate-300">
                  {task.due_date ? `Prazo ${formatDate(task.due_date)}` : "Sem prazo"}
                </p>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="O que está parado" description="Vencidas, antigas ou sem data para você decidir o próximo passo.">
        <div className="space-y-2 text-sm text-ink-700 dark:text-slate-200">
          <SummaryCountRow label="Vencidas" value={overdueTasks.length} />
          <SummaryCountRow label="Paradas há mais de 14 dias" value={staleTasks.length} />
          <SummaryCountRow label="Sem data" value={tasksWithoutDate.length} />
        </div>
      </SectionCard>
    </section>
  );
}

function SummaryCountRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="hub-card flex items-center justify-between rounded-md border border-ink-950/10 px-3 py-2 dark:border-white/10">
      <span>{label}</span>
      <span className="font-semibold text-ink-950 dark:text-slate-100">{value}</span>
    </div>
  );
}

function WeeklyKanbanSection({
  tasks,
  taskLists,
  categories,
}: {
  tasks: RoutineTask[];
  taskLists: RoutineTaskList[];
  categories: RoutineCategory[];
}) {
  const listByGoogleId = new Map(taskLists.map((list) => [list.google_task_list_id, list]));
  const categoryById = new Map(categories.map((category) => [category.id, category.name]));
  const columns = taskLists
    .map((list) => ({
      id: list.google_task_list_id,
      title: list.title,
      tasks: tasks.filter((task) => task.google_task_list_id === list.google_task_list_id),
    }))
    .filter((column) => column.tasks.length > 0);

  return (
    <SectionCard title="Kanban da semana" description="Visão das tarefas abertas por lista atual do Google Tasks.">
      {columns.length === 0 ? (
        <EmptyState title="Sem tarefas abertas" description="Quando houver tarefas abertas sincronizadas, o kanban aparece aqui." />
      ) : (
        <div className="overflow-x-auto">
          <div className="flex min-w-max gap-4 pb-2">
            {columns.map((column) => (
              <div
                key={column.id}
                className="hub-kanban-column w-[280px] shrink-0 rounded-xl border p-4"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-ink-950 dark:text-slate-100">{column.title}</h3>
                  <TextBadge tone="neutral">{column.tasks.length}</TextBadge>
                </div>
                <div className="space-y-3">
                  {column.tasks.map((task) => {
                    const categoryLabel = resolveRoutineTaskContext(task, listByGoogleId, categoryById).categoryLabel;

                    return (
                      <article
                        key={task.id}
                        className="hub-card rounded-lg border border-ink-950/10 p-3 shadow-sm"
                      >
                        <p className="text-sm font-semibold text-ink-950 dark:text-slate-100">{task.title}</p>
                        <p className="mt-2 text-xs text-ink-600 dark:text-slate-300">{categoryLabel}</p>
                        <p className="mt-1 text-xs text-ink-600 dark:text-slate-300">
                          {task.due_date ? `Prazo ${formatDate(task.due_date)}` : "Sem data"}
                        </p>
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function SummarySection({
  summary,
  selectedWeekStart,
  selectedWeekEnd,
  onWeekChange,
}: {
  summary: WeeklyReviewSummary;
  selectedWeekStart: string;
  selectedWeekEnd: string;
  onWeekChange: (weekStart: string) => void;
}) {
  const overdueOrUndatedCount = summary.overdueTasks.length + summary.tasksWithoutDate.length;

  return (
    <SectionCard title="Resumo" description="Leitura rápida da semana: o que você fez, priorizou, deixou parado e o que merece atenção agora.">
      <div className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,240px)_1fr]">
        <FieldShell label="Início da semana">
          <input
            type="date"
            className={inputClassName}
            value={selectedWeekStart}
            onChange={(event) => onWeekChange(toDateInputValue(startOfWeek(new Date(`${event.target.value}T00:00:00`))))}
          />
        </FieldShell>
        <div className="hub-card rounded-lg border border-ink-950/10 p-4 dark:border-white/10">
          <p className="text-sm font-semibold text-ink-950 dark:text-slate-100">
            Período: {formatDate(selectedWeekStart)} a {formatDate(selectedWeekEnd)}
          </p>
          <p className="mt-1 text-sm text-ink-600 dark:text-slate-300">Use as abas abaixo para revisar entregas da semana, fila de prioridade, pendências e detalhes técnicos quando precisar.</p>
        </div>
      </div>

      {summary.hasInflatedInitialEvents ? (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100">
          Primeira sincronização usada como carga inicial. Alguns eventos podem estar inflados.
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Concluídas na semana" value={String(summary.completedThisWeek.length)} helper="Tarefas finalizadas no período." tone="success" />
        <StatCard label="Priorizadas reais" value={String(summary.prioritizedEvents.length)} helper="Mudanças reais para Geral/Hoje após o baseline." tone="warning" />
        <StatCard label="Pendências paradas" value={String(summary.staleTasks.length)} helper="Sem atualização há 14 dias ou mais." tone="danger" />
        <StatCard label="Vencidas ou sem data" value={String(overdueOrUndatedCount)} helper={`${summary.overdueTasks.length} vencida(s) e ${summary.tasksWithoutDate.length} sem data.`} tone="warning" />
        <StatCard label="Área mais ativa" value={summary.areaMostWorked?.label ?? "-"} helper={summary.areaMostWorked ? `${summary.areaMostWorked.count} concluída(s) na semana.` : "Sem conclusão no período."} tone="success" />
        <StatCard label="Área negligenciada" value={summary.areaLeastAttention?.label ?? "-"} helper={summary.areaLeastAttention ? `${summary.areaLeastAttention.count} item(ns) ainda em aberto.` : "Sem sinal suficiente."} tone="warning" />
      </section>
    </SectionCard>
  );
}

function WeeklyAiAnalysisSection({
  aiSummary,
  hasEnoughData,
  hasInflatedInitialEvents,
  analyzing,
  onGenerate,
  syncRun,
}: {
  aiSummary: RoutineAiSummary | null;
  hasEnoughData: boolean;
  hasInflatedInitialEvents: boolean;
  analyzing: boolean;
  onGenerate: () => void;
  syncRun: WeeklyReviewData["syncRuns"][number] | null;
}) {
  const status = aiSummary?.summary_text ? "Pronta" : aiSummary?.error_message ? "Erro" : "Não gerada";
  const analysisBase = readAiSyncBase(aiSummary);
  const suggestions = readAiSuggestionSections(aiSummary?.summary_text ?? "");

  return (
    <SectionCard title="Análise da IA" description="Resumo interpretativo gerado com Gemini somente quando você solicita.">
      <div className="mb-4 flex justify-end">
        <ActionButton type="button" onClick={onGenerate} disabled={analyzing}>
          {analyzing ? "Gerando..." : aiSummary ? "Gerar novamente" : "Gerar análise da semana"}
        </ActionButton>
      </div>
      <div className="mb-4 grid gap-4 md:grid-cols-3">
        <StatCard label="Status da análise" value={status} helper="A IA não executa em sincronizações." tone={aiSummary?.summary_text ? "success" : aiSummary?.error_message ? "danger" : "neutral"} />
        <StatCard label="Última análise" value={aiSummary?.updated_at ? formatDate(aiSummary.updated_at.slice(0, 10)) : "-"} helper={aiSummary?.model ?? "Modelo configurado no servidor."} tone="info" />
        <StatCard
          label="Dados suficientes"
          value={hasEnoughData ? "Sim" : "Poucos"}
          helper={hasEnoughData ? "Dados sincronizados disponíveis para análise." : "Poucos dados sincronizados. A análise pode ficar limitada."}
          tone={hasEnoughData ? "success" : "warning"}
        />
      </div>

      <div className="mb-4 rounded-lg border border-ink-950/10 bg-slate-50 p-4 text-sm text-ink-700 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-200">
        <p className="font-semibold text-ink-950 dark:text-slate-100">
          Base da análise: {analysisBase?.syncText ?? "Sem sincronização identificada."}
        </p>
        <p className="mt-1 text-xs text-ink-600 dark:text-slate-300">
          {analysisBase?.origin ?? (syncRun ? "Usando a sincronização mais recente registrada no Hub." : "Gere uma sincronização antes de pedir análise.")}
        </p>
      </div>

      {!hasEnoughData ? (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100">
          Não há muitos dados sincronizados para essa semana. Você ainda pode gerar a análise, mas ela ficará limitada ao que existe no Hub.
        </div>
      ) : null}

      {hasInflatedInitialEvents ? (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100">
          A fila Geral/Hoje ainda contém muitos itens herdados da primeira sincronização. Use a análise como referência inicial.
        </div>
      ) : null}

      {aiSummary?.summary_text ? (
        <AiSummaryReport text={aiSummary.summary_text} suggestions={suggestions} />
      ) : aiSummary?.error_message ? (
        <EmptyState title="A última análise falhou" description={formatAiError(aiSummary.error_message)} />
      ) : (
        <EmptyState title="Análise ainda não gerada" description="Clique em Gerar análise da semana para enviar o resumo estruturado ao Gemini." />
      )}
    </SectionCard>
  );
}

function AiSummaryReport({
  text,
  suggestions,
}: {
  text: string;
  suggestions: ReturnType<typeof readAiSuggestionSections>;
}) {
  const sections = parseAiReportSections(text);
  const mainSections = sections.filter(
    (section) => !["Sugestões práticas", "Ideias opcionais", "Coisas para revisar"].includes(section.title),
  );

  return (
    <div className="space-y-4">
      {suggestions.some((group) => group.items.length > 0) ? (
        <article className="rounded-xl border border-emerald-500/20 bg-emerald-50/80 p-5 shadow-sm dark:border-emerald-400/20 dark:bg-emerald-500/10">
          <h3 className="text-base font-semibold text-emerald-950 dark:text-emerald-100">Sugestões da IA</h3>
          <div className="mt-3 grid gap-4 md:grid-cols-3">
            {suggestions.map((group) => (
              <div key={group.title} className="hub-card rounded-lg border border-emerald-500/20 bg-white/70 p-4 dark:bg-slate-950/30">
                <h4 className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">{group.title}</h4>
                {group.items.length > 0 ? (
                  <ul className="mt-2 space-y-2 text-sm leading-6 text-emerald-900 dark:text-emerald-100">
                    {group.items.map((item) => (
                      <li key={item} className="flex gap-2">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600 dark:bg-emerald-300" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-emerald-800/80 dark:text-emerald-100/80">Sem itens nesta parte.</p>
                )}
              </div>
            ))}
          </div>
        </article>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
      {mainSections.map((section, index) => (
        <article
          key={`${section.title}-${index}`}
          className={`hub-card rounded-xl border border-ink-950/10 p-5 shadow-sm dark:border-white/10 ${
            index === 0 ? "md:col-span-2" : ""
          }`}
        >
          <h3 className="text-base font-semibold text-ink-950 dark:text-slate-100">{section.title}</h3>
          <div className="mt-3 space-y-2 text-sm leading-7 text-ink-700 dark:text-slate-200">
            {section.items.length > 0 ? (
              <ul className="space-y-2">
                {section.items.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)
            )}
          </div>
        </article>
      ))}
      </div>
    </div>
  );
}

function CompletedByCategorySection({
  tasks,
  categories,
  taskLists,
  savingCategoryId,
  onConfirmCategory,
}: {
  tasks: RoutineTask[];
  categories: RoutineCategory[];
  taskLists: RoutineTaskList[];
  savingCategoryId: string | null;
  onConfirmCategory: (task: RoutineTask, categoryId: string) => void;
}) {
  const groups = groupTasksByCategory(tasks, categories, taskLists);

  return (
    <SectionCard title="Concluídas" description="Tarefas finalizadas na semana, agrupadas por categoria do Hub.">
      {groups.length === 0 ? (
        <EmptyState title="Nenhuma tarefa concluída" description="Quando houver tarefas concluídas na semana, elas aparecerão por categoria." />
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.label} className="hub-card rounded-xl border border-ink-950/10 p-4 dark:border-white/10">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-ink-950 dark:text-slate-100">{group.label}</h3>
                <TextBadge tone="success">{group.tasks.length} concluída(s)</TextBadge>
              </div>
              <div className="space-y-3">
                {group.tasks.map((task) => (
                  <TaskReviewCard
                    key={task.id}
                    task={task}
                    categories={categories}
                    taskLists={taskLists}
                    savingCategoryId={savingCategoryId}
                    onConfirmCategory={onConfirmCategory}
                    mode="completed"
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function PrioritiesSection({
  events,
  taskByGoogleId,
  listByGoogleId,
}: {
  events: RoutineTaskEvent[];
  taskByGoogleId: Map<string, RoutineTask>;
  listByGoogleId: Map<string, RoutineTaskList>;
}) {
  const visibleEvents = events.filter((event) => taskByGoogleId.has(event.google_task_id));

  return (
    <SectionCard title="Prioridades" description="Tarefas movidas para Geral/Hoje nesta semana. A lista é tratada como fila de prioridade.">
      {visibleEvents.length === 0 ? (
        <EmptyState title="Nenhuma tarefa foi movida para a fila Geral/Hoje nesta semana." description="Somente mudanças reais para Geral/Hoje depois do baseline entram nesta lista." />
      ) : (
        <div className="space-y-3">
          {visibleEvents.map((event) => {
            const task = taskByGoogleId.get(event.google_task_id);
            const previousList = extractPreviousListLabel(event.previous_value, listByGoogleId);
            return (
              <div key={event.id} className="hub-card rounded-lg border border-ink-950/10 p-4 dark:border-white/10">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink-950 dark:text-slate-100">{task?.title}</p>
                    <p className="mt-1 text-xs text-ink-600 dark:text-slate-300">
                      {formatDate(event.event_at.slice(0, 10))}
                      {previousList ? ` · veio de ${previousList}` : ""}
                    </p>
                  </div>
                  <TextBadge tone="warning">Geral/Hoje</TextBadge>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

function OpenAndStaleSection({
  overdueTasks,
  openRecentTasks,
  staleTasks,
  tasksWithoutDate,
  tasksDueThisWeek,
  categories,
  taskLists,
  savingCategoryId,
  onConfirmCategory,
}: {
  overdueTasks: RoutineTask[];
  openRecentTasks: RoutineTask[];
  staleTasks: RoutineTask[];
  tasksWithoutDate: RoutineTask[];
  tasksDueThisWeek: RoutineTask[];
  categories: RoutineCategory[];
  taskLists: RoutineTaskList[];
  savingCategoryId: string | null;
  onConfirmCategory: (task: RoutineTask, categoryId: string) => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <TaskMiniSection title="Vencidas" empty="Nenhuma tarefa aberta vencida." tasks={overdueTasks.slice(0, 15)} categories={categories} taskLists={taskLists} savingCategoryId={savingCategoryId} onConfirmCategory={onConfirmCategory} />
      <TaskMiniSection title="Sem data" empty="Nenhuma tarefa aberta sem data." tasks={tasksWithoutDate.slice(0, 15)} categories={categories} taskLists={taskLists} savingCategoryId={savingCategoryId} onConfirmCategory={onConfirmCategory} />
      <TaskMiniSection title="Paradas há mais de 14 dias" empty="Nenhuma tarefa parada há mais de 14 dias." tasks={staleTasks.slice(0, 15)} categories={categories} taskLists={taskLists} savingCategoryId={savingCategoryId} onConfirmCategory={onConfirmCategory} />
      <TaskMiniSection title="Abertas recentes" empty="Nenhuma tarefa aberta recente." tasks={openRecentTasks.slice(0, 15)} categories={categories} taskLists={taskLists} savingCategoryId={savingCategoryId} onConfirmCategory={onConfirmCategory} />
      <TaskMiniSection title="Vencendo nesta semana" empty="Nenhuma tarefa aberta vencendo nesta semana." tasks={tasksDueThisWeek.slice(0, 15)} categories={categories} taskLists={taskLists} savingCategoryId={savingCategoryId} onConfirmCategory={onConfirmCategory} />
    </div>
  );
}

function TaskMiniSection({
  title,
  empty,
  tasks,
  categories,
  taskLists,
  savingCategoryId,
  onConfirmCategory,
}: {
  title: string;
  empty: string;
  tasks: RoutineTask[];
  categories: RoutineCategory[];
  taskLists: RoutineTaskList[];
  savingCategoryId: string | null;
  onConfirmCategory: (task: RoutineTask, categoryId: string) => void;
}) {
  return (
    <SectionCard title={title}>
      {tasks.length === 0 ? (
        <EmptyState title={empty} description="A lista será atualizada após a próxima sincronização." />
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <TaskReviewCard key={task.id} task={task} categories={categories} taskLists={taskLists} savingCategoryId={savingCategoryId} onConfirmCategory={onConfirmCategory} mode="open" />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function TaskReviewCard({
  task,
  categories,
  taskLists,
  savingCategoryId,
  onConfirmCategory,
  mode,
}: {
  task: RoutineTask;
  categories: RoutineCategory[];
  taskLists: RoutineTaskList[];
  savingCategoryId: string | null;
  onConfirmCategory: (task: RoutineTask, categoryId: string) => void;
  mode: "completed" | "open";
}) {
  const currentCategoryId = task.confirmed_category_id ?? task.detected_category_id ?? "";
  const currentCategory = categories.find((category) => category.id === currentCategoryId);
  const categoryById = new Map(categories.map((category) => [category.id, category.name]));
  const taskContext = resolveRoutineTaskContext(task, new Map(taskLists.map((list) => [list.google_task_list_id, list])), categoryById);

  return (
    <div className="hub-card rounded-lg border border-ink-950/10 p-4 dark:border-white/10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink-950 dark:text-slate-100">{task.title}</p>
          <p className="mt-1 text-xs text-ink-600 dark:text-slate-300">
            {mode === "completed" && task.completed_at ? `Concluída em ${formatDate(task.completed_at.slice(0, 10))}` : task.due_date ? `Vence em ${formatDate(task.due_date)}` : "Sem data"}
            {currentCategory ? ` · ${currentCategory.name}` : ` · ${taskContext.categoryLabel}`}
          </p>
        </div>
        <TextBadge tone={task.status === "completed" ? "success" : "info"}>{task.status === "completed" ? "Concluída" : "Aberta"}</TextBadge>
      </div>
      {task.notes ? <p className="mt-2 text-sm leading-6 text-ink-600 dark:text-slate-300">{task.notes}</p> : null}
      <div className="mt-3 max-w-sm">
        <FieldShell label="Categoria confirmada no Hub">
          <select
            className={inputClassName}
            value={currentCategoryId}
            disabled={savingCategoryId === task.id}
            onChange={(event) => onConfirmCategory(task, event.target.value)}
          >
            <option value="">Sem categoria</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </FieldShell>
      </div>
    </div>
  );
}

function MonthSection({
  monthFilter,
  monthlyWeeks,
  selectedWeekStart,
  onMonthChange,
  onSelectWeek,
}: {
  monthFilter: string;
  monthlyWeeks: ReturnType<typeof buildMonthlyWeeks>;
  selectedWeekStart: string;
  onMonthChange: (month: string) => void;
  onSelectWeek: (weekStart: string) => void;
}) {
  return (
    <SectionCard title="Mês" description="Semanas compactas do mês selecionado, focadas em concluídas, prioridades reais e pendências.">
      <div className="mb-4 max-w-xs">
        <FieldShell label="Mês">
          <input type="month" className={inputClassName} value={monthFilter} onChange={(event) => onMonthChange(event.target.value)} />
        </FieldShell>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {monthlyWeeks.map((week) => {
          const active = selectedWeekStart === week.weekStart;
          return (
            <button
              key={week.weekStart}
              type="button"
              onClick={() => onSelectWeek(week.weekStart)}
              className={`rounded-lg border p-4 text-left transition ${
                active
                  ? "border-emerald-500 bg-emerald-50 text-emerald-950 dark:border-emerald-400 dark:bg-emerald-500/10 dark:text-emerald-100"
                  : "hub-card border-ink-950/10 bg-white text-ink-950 hover:border-ink-950/30 dark:border-white/10 dark:text-slate-100 dark:hover:border-white/30"
              }`}
            >
              <p className="text-sm font-semibold">{week.label}</p>
              <p className="mt-1 text-xs opacity-75">{week.range}</p>
              <div className="mt-3 space-y-1 text-sm">
                <p>Concluídas: {week.completed}</p>
                <p>Priorizadas reais: {week.prioritized}</p>
                <p>Pendências: {week.open}</p>
              </div>
            </button>
          );
        })}
      </div>
    </SectionCard>
  );
}

function TechnicalSection({
  data,
  latestSyncRun,
  lastSyncResult,
  summary,
  taskByGoogleId,
}: {
  data: WeeklyReviewData;
  latestSyncRun: WeeklyReviewData["syncRuns"][number] | null;
  lastSyncResult: SyncResult | null;
  summary: WeeklyReviewSummary;
  taskByGoogleId: Map<string, RoutineTask>;
}) {
  return (
    <SectionCard title="Dados técnicos" description="Informações de sincronização, eventos e IDs ficam recolhidas para não poluir a revisão.">
      <details className="hub-card rounded-lg border border-ink-950/10 p-4 dark:border-white/10">
        <summary className="cursor-pointer text-sm font-semibold text-ink-950 dark:text-slate-100">Abrir dados técnicos</summary>
        <div className="mt-4 space-y-4">
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Eventos reais na semana" value={String(summary.realEventsThisWeek.length)} helper="Usados nos cards, no mês e na IA." tone="success" />
            <StatCard label="Criadas após baseline" value={String(summary.createdAfterBaselineEvents.length)} helper="Novas tarefas detectadas depois da carga inicial." tone="info" />
            <StatCard label="Priorizadas herdadas" value={String(summary.eventsThisWeek.filter((event) => event.event_type === 'PRIORITIZED' && event.previous_value === null).length)} helper="Ignoradas nos cálculos principais." tone="warning" />
            <StatCard label="Em Geral/Hoje agora" value={String(summary.priorityQueueTasks.length)} helper="Estado atual da fila de prioridade." tone="neutral" />
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Status Google" value={data.connection?.status === "connected" ? "Conectado" : "Desconectado"} helper="Escopo somente leitura do Google Tasks." tone={data.connection?.status === "connected" ? "success" : "warning"} />
            <StatCard label="Última tentativa" value={data.connection?.last_sync_attempt_at ? formatDate(data.connection.last_sync_attempt_at.slice(0, 10)) : "-"} helper="Manual ou automática." tone="info" />
            <StatCard label="Status automático" value={data.connection?.auto_sync_enabled ? "Ativa" : "Desativada"} helper={latestSyncRun ? `Último run: ${latestSyncRun.status}` : "Sem execução registrada."} tone={data.connection?.auto_sync_enabled ? "success" : "warning"} />
            <StatCard label="Último erro" value={latestSyncRun?.error_message || data.connection?.last_sync_error ? "Sim" : "Não"} helper={latestSyncRun?.error_message ?? data.connection?.last_sync_error ?? "Sem erro registrado."} tone={latestSyncRun?.error_message || data.connection?.last_sync_error ? "danger" : "success"} />
          </section>

          {lastSyncResult ? (
            <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
              <StatCard label="Listas" value={String(lastSyncResult.listsRead)} helper="Lidas do Google." tone="info" />
              <StatCard label="Tarefas" value={String(lastSyncResult.tasksRead)} helper="Abertas e concluídas." tone="info" />
              <StatCard label="Criadas" value={String(lastSyncResult.createdTasks)} helper="Novas no histórico." tone="success" />
              <StatCard label="Atualizadas" value={String(lastSyncResult.updatedTasks)} helper="Já conhecidas." tone="neutral" />
              <StatCard label="Eventos" value={String(lastSyncResult.eventsCreated)} helper="Mudanças detectadas." tone="warning" />
              <StatCard label="Relatórios" value={String(lastSyncResult.reportsUpdated)} helper="Semana atual." tone="success" />
            </section>
          ) : null}

          <section className="grid gap-4 xl:grid-cols-2">
            <CountSection title="Contagem por lista" rows={summary.countByList} />
            <CountSection title="Contagem por categoria" rows={summary.countByCategory} />
          </section>

          <TechnicalEventsList events={summary.eventsThisWeek} taskByGoogleId={taskByGoogleId} />
        </div>
      </details>
    </SectionCard>
  );
}

function TechnicalEventsList({ events, taskByGoogleId }: { events: RoutineTaskEvent[]; taskByGoogleId: Map<string, RoutineTask> }) {
  return (
    <SectionCard title="Eventos técnicos da semana">
      {events.length === 0 ? (
        <EmptyState title="Nenhum evento técnico" description="Eventos aparecem quando o Hub compara uma sincronização com a anterior." />
      ) : (
        <div className="space-y-3">
          {events.slice(0, 40).map((event) => {
            const task = taskByGoogleId.get(event.google_task_id);
            return (
              <div key={event.id} className="hub-card rounded-lg border border-ink-950/10 p-4 dark:border-white/10">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink-950 dark:text-slate-100">{event.event_type}</p>
                    <p className="mt-1 text-xs text-ink-600 dark:text-slate-300">{task?.title ?? "Tarefa não encontrada"}</p>
                  </div>
                  <p className="text-xs text-ink-600 dark:text-slate-300">{formatDate(event.event_at.slice(0, 10))}</p>
                </div>
                <p className="mt-2 break-all text-xs text-ink-600 dark:text-slate-300">Google task ID: {event.google_task_id}</p>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

function CountSection({ title, rows }: { title: string; rows: Array<{ label: string; count: number }> }) {
  return (
    <SectionCard title={title}>
      {rows.length === 0 ? (
        <EmptyState title="Sem dados" description="Sincronize o Google Tasks para gerar contagens." />
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.label} className="hub-card flex items-center justify-between rounded-md border border-ink-950/10 px-3 py-2 text-sm dark:border-white/10">
              <span className="font-medium text-ink-950 dark:text-slate-100">{row.label}</span>
              <span className="text-ink-600 dark:text-slate-300">{row.count}</span>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function buildWeeklySummary(data: WeeklyReviewData | null, weekStartDate: string, weekEndDate: string): WeeklyReviewSummary {
  if (!data) {
    return {
      completedThisWeek: [],
      createdAfterBaselineEvents: [],
      prioritizedEvents: [],
      reopenedEvents: [],
      dueDateChangedEvents: [],
      realEventsThisWeek: [],
      openTasks: [],
      priorityQueueTasks: [],
      openRecentTasks: [],
      staleTasks: [],
      overdueTasks: [],
      tasksWithoutDate: [],
      tasksDueThisWeek: [],
      eventsThisWeek: [],
      areaMostWorked: null,
      areaLeastAttention: null,
      hasInflatedInitialEvents: false,
      countByList: [],
      countByCategory: [],
    };
  }

  const derived = buildWeeklyDerivedData(data.tasks, data.events, data.taskLists, data.categories, weekStartDate, weekEndDate);

  return {
    completedThisWeek: derived.completedThisWeek,
    createdAfterBaselineEvents: derived.createdAfterBaselineEvents,
    prioritizedEvents: derived.prioritizedEvents,
    reopenedEvents: derived.reopenedEvents,
    dueDateChangedEvents: derived.dueDateChangedEvents,
    realEventsThisWeek: derived.realEventsThisWeek,
    openTasks: derived.openTasks,
    priorityQueueTasks: derived.priorityQueueTasks,
    openRecentTasks: derived.openRecentTasks,
    staleTasks: derived.staleTasks,
    overdueTasks: derived.overdueTasks,
    tasksWithoutDate: derived.tasksWithoutDate,
    tasksDueThisWeek: derived.tasksDueThisWeek,
    eventsThisWeek: derived.technicalEventsThisWeek,
    areaMostWorked: derived.areaMostWorked,
    areaLeastAttention: derived.areaLeastAttention,
    hasInflatedInitialEvents: derived.hasInflatedInitialEvents,
    countByList: derived.countByList,
    countByCategory: derived.countByCategory,
  };
}

function buildMonthlyWeeks(data: WeeklyReviewData | null, month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const monthStart = new Date(year, monthNumber - 1, 1);
  const weeks: Array<{ weekStart: string; label: string; range: string; completed: number; prioritized: number; open: number; events: number }> = [];
  const cursor = new Date(monthStart);
  let index = 1;

  while (cursor.getMonth() === monthNumber - 1) {
    const end = new Date(cursor);
    end.setDate(cursor.getDate() + 6);
    const weekStart = toDateInputValue(cursor);
    const weekEnd = toDateInputValue(end);
    const derived = data ? buildWeeklyDerivedData(data.tasks, data.events, data.taskLists, data.categories, weekStart, weekEnd) : null;
    weeks.push({
      weekStart,
      label: `Semana ${index}`,
      range: `${formatDate(weekStart)} a ${formatDate(weekEnd)}`,
      completed: derived?.completedThisWeek.length ?? 0,
      prioritized: derived?.prioritizedEvents.length ?? 0,
      open: (derived?.overdueTasks.length ?? 0) + (derived?.tasksWithoutDate.length ?? 0) + (derived?.staleTasks.length ?? 0),
      events: derived?.realEventsThisWeek.length ?? 0,
    });
    cursor.setDate(cursor.getDate() + 7);
    index += 1;
  }

  return weeks;
}

function groupTasksByCategory(tasks: RoutineTask[], categories: RoutineCategory[], taskLists: RoutineTaskList[]) {
  const categoryById = new Map(categories.map((category) => [category.id, category.name]));
  const listByGoogleId = new Map(taskLists.map((list) => [list.google_task_list_id, list]));
  const groups = tasks.reduce<Map<string, RoutineTask[]>>((acc, task) => {
    const label = resolveRoutineTaskContext(task, listByGoogleId, categoryById).categoryLabel;
    acc.set(label, [...(acc.get(label) ?? []), task]);
    return acc;
  }, new Map());

  return Array.from(groups.entries())
    .map(([label, groupedTasks]) => ({ label, tasks: groupedTasks }))
    .sort((left, right) => right.tasks.length - left.tasks.length || left.label.localeCompare(right.label));
}

type AiReportSection = {
  title: string;
  paragraphs: string[];
  items: string[];
};

function splitAiParagraph(paragraph: string) {
  return paragraph
    .split(/(?:\.\s+|;\s+|\n+)/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => item.endsWith(".") ? item : `${item}.`);
}

function readAiSyncBase(aiSummary: RoutineAiSummary | null) {
  const record = isRecord(aiSummary?.input_summary_json) ? aiSummary?.input_summary_json : null;
  const syncBase = record && isRecord(record.sincronizacao_base) ? record.sincronizacao_base : null;
  const syncAt = syncBase && typeof syncBase.sincronizado_em === "string" ? syncBase.sincronizado_em : null;
  const syncText = syncAt ? `Análise baseada na sincronização de ${formatDateTime(syncAt)}.` : null;
  const origin = syncBase && typeof syncBase.origem === "string" ? syncBase.origem : null;

  return { syncText, origin };
}

function readAiSuggestionSections(text: string) {
  const sections = parseAiReportSections(text);
  return ["Sugestões práticas", "Ideias opcionais", "Coisas para revisar"].map((title) => {
    const section = sections.find((item) => item.title === title);
    return {
      title,
      items: section
        ? [...section.items, ...section.paragraphs.flatMap((paragraph) => splitAiParagraph(paragraph))].filter(Boolean).slice(0, 5)
        : [],
    };
  });
}

const aiReportTitles = [
  "Resumo da semana",
  "O que foi feito",
  "O que está pendente",
  "Listas de referência",
  "Sugestões práticas",
  "Ideias opcionais",
  "Coisas para revisar",
];

const aiReportTitleAliases: Record<string, string> = {
  "Avanços": "O que foi feito",
  "Principais avanços": "O que foi feito",
  "Focos da semana": "O que foi feito",
  "Pendências": "O que está pendente",
  "Pendencias": "O que está pendente",
  "Pontos negligenciados": "O que está pendente",
  "Áreas negligenciadas": "O que está pendente",
  "Tarefas que viraram prioridade": "O que foi feito",
  "Listas de referencia": "Listas de referência",
  "Sugestões da IA": "Sugestões práticas",
  "Sugestoes da IA": "Sugestões práticas",
  "Próxima semana": "Sugestões práticas",
  "Sugestões para a próxima semana": "Sugestões práticas",
  "Sugestão para a próxima semana": "Sugestões práticas",
};

function parseAiReportSections(text: string): AiReportSection[] {
  const stripped = stripAiCodeFence(text);
  const parsed = tryParseAiJson(stripped);
  if (parsed) {
    const record = extractAiReviewRecord(parsed);
    if (record) return sectionsFromRecord(record);
  }

  const sections = sectionsFromText(stripped);
  if (sections.length > 0) return sections;

  return [{
    title: "Resumo da semana",
    paragraphs: [cleanAiLine(stripped)],
    items: [],
  }];
}

function sectionsFromRecord(record: Record<string, unknown>) {
  return aiReportTitles
    .map((title) => {
      const value = record[title] ?? Object.entries(aiReportTitleAliases).find(([alias, target]) => target === title && record[alias] !== undefined)?.[0];
      const rawValue = typeof value === "string" && record[value] !== undefined ? record[value] : record[title] ?? Object.entries(aiReportTitleAliases).find(([alias, target]) => target === title && record[alias] !== undefined)?.[0];
      const finalValue = typeof rawValue === "string" && record[rawValue] !== undefined ? record[rawValue] : rawValue;
      if (finalValue === undefined || finalValue === null) return null;
      return sectionFromValue(title, finalValue);
    })
    .filter((section): section is AiReportSection => Boolean(section));
}

function sectionsFromText(text: string) {
  const lines = text.split("\n").map((line) => cleanAiLine(line)).filter(Boolean);
  const sections: AiReportSection[] = [];
  let current: AiReportSection | null = null;

  for (const line of lines) {
    const title = normalizeAiTitle(line);
    if (title) {
      current = { title, paragraphs: [], items: [] };
      sections.push(current);
      continue;
    }

    if (!current) {
      current = { title: "Resumo da semana", paragraphs: [], items: [] };
      sections.push(current);
    }

    if (/^[•*-]\s+/.test(line) || /^\d+[.)]\s+/.test(line)) {
      current.items.push(line.replace(/^[•*-]\s+/, "").replace(/^\d+[.)]\s+/, "").trim());
    } else {
      current.paragraphs.push(line);
    }
  }

  return sections;
}

function sectionFromValue(title: string, value: unknown): AiReportSection {
  if (Array.isArray(value)) {
    return { title, paragraphs: [], items: value.map((item) => cleanAiLine(formatAiValue(item))).filter(Boolean).slice(0, 8) };
  }

  const lines = formatAiValue(value).split("\n").map((line) => cleanAiLine(line)).filter(Boolean);
  const items = lines.filter((line) => /^[•*-]\s+/.test(line) || /^\d+[.)]\s+/.test(line)).map((line) => line.replace(/^[•*-]\s+/, "").replace(/^\d+[.)]\s+/, "").trim());
  const paragraphs = lines.filter((line) => !/^[•*-]\s+/.test(line) && !/^\d+[.)]\s+/.test(line));
  return { title, paragraphs, items };
}

function normalizeAiTitle(line: string) {
  const normalized = normalizeAiText(line.replace(/:$/, ""));
  const directTitle = aiReportTitles.find((title) => normalizeAiText(title) === normalized);
  if (directTitle) return directTitle;
  const alias = Object.entries(aiReportTitleAliases).find(([source]) => normalizeAiText(source) === normalized);
  return alias?.[1] ?? null;
}

function stripAiCodeFence(value: string) {
  return value
    .trim()
    .replace(/^```(?:json|markdown|md|text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function tryParseAiJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractAiReviewRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const nested = record.revisao_semanal ?? record.revisão_semanal ?? record.weekly_review ?? record.review;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested as Record<string, unknown>;
  if (aiReportTitles.some((title) => record[title] !== undefined)) return record;
  return null;
}

function formatAiValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function cleanAiLine(line: string) {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/\*\*/g, "")
    .trim();
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeAiText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\*\*/g, "")
    .replace(/#+/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

function formatAiError(message: string) {
  const lower = message.toLocaleLowerCase("pt-BR");
  if (lower.includes("model") || lower.includes("modelo") || lower.includes("not found") || lower.includes("not supported")) {
    return "Modelo Gemini indisponível. Verifique GEMINI_WEEKLY_REVIEW_MODEL nas variáveis de ambiente.";
  }
  if (lower.includes("api key") || lower.includes("gemini_api_key")) {
    return "Chave do Gemini não configurada. Verifique GEMINI_API_KEY no ambiente do servidor.";
  }
  return message || "Não foi possível gerar a análise da semana.";
}

function extractPreviousListLabel(value: unknown, listByGoogleId: Map<string, RoutineTaskList>) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const listId = typeof record.list === "string" ? record.list : typeof record.google_task_list_id === "string" ? record.google_task_list_id : null;
  if (!listId) return null;
  return listByGoogleId.get(listId)?.title ?? listId;
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

function addDays(date: string, days: number) {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + days);
  return toDateInputValue(next);
}
