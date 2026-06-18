"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { ActionButton, CrudFeedback, FieldShell, inputClassName, TextBadge } from "@/features/shared/crud-ui";
import { formatDate } from "@/features/shared/format";
import type { FeedbackState } from "@/features/shared/types";
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

type ReviewTab = "completed" | "priorities" | "open" | "month" | "technical";

const reviewTabs: Array<{ id: ReviewTab; label: string }> = [
  { id: "completed", label: "Concluídas" },
  { id: "priorities", label: "Prioridades" },
  { id: "open", label: "Abertas e paradas" },
  { id: "month", label: "Mês" },
  { id: "technical", label: "Dados técnicos" },
];

export function WeeklyReviewPage() {
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
  const [activeTab, setActiveTab] = useState<ReviewTab>("completed");

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

  async function handleSync() {
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
  }

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

  async function handleGenerateAnalysis() {
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
  }

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
            latestSyncLabel={data.connection.last_successful_sync_at || data.connection.last_sync_at ? formatDate((data.connection.last_successful_sync_at ?? data.connection.last_sync_at ?? "").slice(0, 10)) : "-"}
            onWeekChange={setSelectedWeekStart}
          />

          <WeeklyAiAnalysisSection
            aiSummary={aiSummary}
            hasEnoughData={summary.completedThisWeek.length + summary.openTasks.length + summary.eventsThisWeek.length > 0}
            analyzing={analyzing}
            onGenerate={() => void handleGenerateAnalysis()}
          />

          <div className="flex flex-wrap gap-2 rounded-xl border border-ink-950/10 bg-white p-2 shadow-sm dark:border-white/10 dark:bg-slate-950/70">
            {reviewTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  activeTab === tab.id
                    ? "bg-ink-950 text-white dark:bg-slate-100 dark:text-slate-950"
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
              onConfirmCategory={(task, categoryId) => void handleConfirmCategory(task, categoryId)}
              savingCategoryId={savingCategoryId}
            />
          ) : null}

          {activeTab === "priorities" ? (
            <PrioritiesSection events={summary.prioritizedEvents} taskByGoogleId={taskByGoogleId} listByGoogleId={listByGoogleId} />
          ) : null}

          {activeTab === "open" ? (
            <OpenAndStaleSection
              openRecentTasks={summary.openRecentTasks}
              staleTasks={summary.staleTasks}
              tasksWithoutDate={summary.tasksWithoutDate}
              tasksDueThisWeek={summary.tasksDueThisWeek}
              categories={data.categories}
              onConfirmCategory={(task, categoryId) => void handleConfirmCategory(task, categoryId)}
              savingCategoryId={savingCategoryId}
            />
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

function SummarySection({
  summary,
  selectedWeekStart,
  selectedWeekEnd,
  latestSyncLabel,
  onWeekChange,
}: {
  summary: WeeklyReviewSummary;
  selectedWeekStart: string;
  selectedWeekEnd: string;
  latestSyncLabel: string;
  onWeekChange: (weekStart: string) => void;
}) {
  return (
    <SectionCard title="Resumo" description="Visão curta do que aconteceu na semana selecionada. Geral/Hoje é fila de prioridade, não categoria principal.">
      <div className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,240px)_1fr]">
        <FieldShell label="Início da semana">
          <input
            type="date"
            className={inputClassName}
            value={selectedWeekStart}
            onChange={(event) => onWeekChange(toDateInputValue(startOfWeek(new Date(`${event.target.value}T00:00:00`))))}
          />
        </FieldShell>
        <div className="rounded-lg border border-ink-950/10 bg-white p-4 dark:border-white/10 dark:bg-slate-950/50">
          <p className="text-sm font-semibold text-ink-950 dark:text-slate-100">
            Período: {formatDate(selectedWeekStart)} a {formatDate(selectedWeekEnd)}
          </p>
          <p className="mt-1 text-sm text-ink-600 dark:text-slate-300">Use as abas abaixo para revisar tarefas concluídas, prioridades, pendências e dados técnicos.</p>
        </div>
      </div>

      {summary.hasInflatedInitialEvents ? (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100">
          Primeira sincronização usada como carga inicial. Alguns eventos podem estar inflados.
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Concluídas na semana" value={String(summary.completedThisWeek.length)} helper="Tarefas finalizadas no período." tone="success" />
        <StatCard label="Movidas para prioridade" value={String(summary.prioritizedEvents.length)} helper="Mudanças reais para Geral/Hoje." tone="warning" />
        <StatCard label="Abertas" value={String(summary.openTasks.length)} helper="Ainda não concluídas." tone="info" />
        <StatCard label="Paradas" value={String(summary.staleTasks.length)} helper="Sem atualização há 14 dias ou mais." tone="danger" />
        <StatCard label="Área mais trabalhada" value={summary.areaMostWorked?.label ?? "-"} helper={summary.areaMostWorked ? `${summary.areaMostWorked.count} concluídas` : "Sem conclusão no período."} tone="success" />
        <StatCard label="Área com menos atenção" value={summary.areaLeastAttention?.label ?? "-"} helper={summary.areaLeastAttention ? `${summary.areaLeastAttention.count} item(ns)` : "Sem sinal suficiente."} tone="warning" />
        <StatCard label="Última sincronização" value={latestSyncLabel} helper="Manual ou automática." tone="neutral" />
      </section>
    </SectionCard>
  );
}

function WeeklyAiAnalysisSection({
  aiSummary,
  hasEnoughData,
  analyzing,
  onGenerate,
}: {
  aiSummary: RoutineAiSummary | null;
  hasEnoughData: boolean;
  analyzing: boolean;
  onGenerate: () => void;
}) {
  const status = aiSummary?.summary_text ? "Pronta" : aiSummary?.error_message ? "Erro" : "Não gerada";

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
        <StatCard label="Dados suficientes" value={hasEnoughData ? "Sim" : "Poucos"} helper="Sem dados, o resumo será limitado." tone={hasEnoughData ? "success" : "warning"} />
      </div>

      {!hasEnoughData ? (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100">
          Não há muitos dados sincronizados para essa semana. Você ainda pode gerar a análise, mas ela ficará limitada ao que existe no Hub.
        </div>
      ) : null}

      {aiSummary?.summary_text ? (
        <AiSummaryText text={aiSummary.summary_text} />
      ) : aiSummary?.error_message ? (
        <EmptyState title="A última análise falhou" description={formatAiError(aiSummary.error_message)} />
      ) : (
        <EmptyState title="Análise ainda não gerada" description="Clique em Gerar análise da semana para enviar o resumo estruturado ao Gemini." />
      )}
    </SectionCard>
  );
}

function AiSummaryText({ text }: { text: string }) {
  const blocks = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <div className="rounded-lg border border-ink-950/10 bg-white p-5 text-sm leading-7 text-ink-800 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-100">
      <div className="space-y-4">
        {blocks.map((block) =>
          isAiHeading(block) ? (
            <h3 key={block} className="text-base font-semibold text-ink-950 dark:text-slate-100">
              {block.replace(/:$/, "")}
            </h3>
          ) : (
            <p key={block} className="whitespace-pre-wrap text-ink-700 dark:text-slate-200">
              {block}
            </p>
          ),
        )}
      </div>
    </div>
  );
}

function CompletedByCategorySection({
  tasks,
  categories,
  savingCategoryId,
  onConfirmCategory,
}: {
  tasks: RoutineTask[];
  categories: RoutineCategory[];
  savingCategoryId: string | null;
  onConfirmCategory: (task: RoutineTask, categoryId: string) => void;
}) {
  const groups = groupTasksByCategory(tasks, categories);

  return (
    <SectionCard title="Concluídas" description="Tarefas finalizadas na semana, agrupadas por categoria do Hub.">
      {groups.length === 0 ? (
        <EmptyState title="Nenhuma tarefa concluída" description="Quando houver tarefas concluídas na semana, elas aparecerão por categoria." />
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.label} className="rounded-xl border border-ink-950/10 bg-white p-4 dark:border-white/10 dark:bg-slate-950/50">
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
        <EmptyState title="Nenhuma tarefa movida para prioridade" description="Somente mudanças reais para Geral/Hoje entram nesta lista." />
      ) : (
        <div className="space-y-3">
          {visibleEvents.map((event) => {
            const task = taskByGoogleId.get(event.google_task_id);
            const previousList = extractPreviousListLabel(event.previous_value, listByGoogleId);
            return (
              <div key={event.id} className="rounded-lg border border-ink-950/10 bg-white p-4 dark:border-white/10 dark:bg-slate-950/50">
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
  openRecentTasks,
  staleTasks,
  tasksWithoutDate,
  tasksDueThisWeek,
  categories,
  savingCategoryId,
  onConfirmCategory,
}: {
  openRecentTasks: RoutineTask[];
  staleTasks: RoutineTask[];
  tasksWithoutDate: RoutineTask[];
  tasksDueThisWeek: RoutineTask[];
  categories: RoutineCategory[];
  savingCategoryId: string | null;
  onConfirmCategory: (task: RoutineTask, categoryId: string) => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <TaskMiniSection title="Abertas recentes" empty="Nenhuma tarefa aberta recente." tasks={openRecentTasks.slice(0, 15)} categories={categories} savingCategoryId={savingCategoryId} onConfirmCategory={onConfirmCategory} />
      <TaskMiniSection title="Paradas há mais de 14 dias" empty="Nenhuma tarefa parada há mais de 14 dias." tasks={staleTasks.slice(0, 15)} categories={categories} savingCategoryId={savingCategoryId} onConfirmCategory={onConfirmCategory} />
      <TaskMiniSection title="Sem data" empty="Nenhuma tarefa aberta sem data." tasks={tasksWithoutDate.slice(0, 15)} categories={categories} savingCategoryId={savingCategoryId} onConfirmCategory={onConfirmCategory} />
      <TaskMiniSection title="Vencendo esta semana" empty="Nenhuma tarefa aberta vencendo nesta semana." tasks={tasksDueThisWeek.slice(0, 15)} categories={categories} savingCategoryId={savingCategoryId} onConfirmCategory={onConfirmCategory} />
    </div>
  );
}

function TaskMiniSection({
  title,
  empty,
  tasks,
  categories,
  savingCategoryId,
  onConfirmCategory,
}: {
  title: string;
  empty: string;
  tasks: RoutineTask[];
  categories: RoutineCategory[];
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
            <TaskReviewCard key={task.id} task={task} categories={categories} savingCategoryId={savingCategoryId} onConfirmCategory={onConfirmCategory} mode="open" />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function TaskReviewCard({
  task,
  categories,
  savingCategoryId,
  onConfirmCategory,
  mode,
}: {
  task: RoutineTask;
  categories: RoutineCategory[];
  savingCategoryId: string | null;
  onConfirmCategory: (task: RoutineTask, categoryId: string) => void;
  mode: "completed" | "open";
}) {
  const currentCategoryId = task.confirmed_category_id ?? task.detected_category_id ?? "";
  const currentCategory = categories.find((category) => category.id === currentCategoryId);

  return (
    <div className="rounded-lg border border-ink-950/10 bg-white p-4 dark:border-white/10 dark:bg-slate-950/50">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink-950 dark:text-slate-100">{task.title}</p>
          <p className="mt-1 text-xs text-ink-600 dark:text-slate-300">
            {mode === "completed" && task.completed_at ? `Concluída em ${formatDate(task.completed_at.slice(0, 10))}` : task.due_date ? `Vence em ${formatDate(task.due_date)}` : "Sem data"}
            {currentCategory ? ` · ${currentCategory.name}` : " · Sem categoria"}
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
    <SectionCard title="Mês" description="Semanas compactas do mês selecionado. Clique em uma semana para carregar a revisão correspondente.">
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
                  : "border-ink-950/10 bg-white text-ink-950 hover:border-ink-950/30 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-100 dark:hover:border-white/30"
              }`}
            >
              <p className="text-sm font-semibold">{week.label}</p>
              <p className="mt-1 text-xs opacity-75">{week.range}</p>
              <div className="mt-3 space-y-1 text-sm">
                <p>Concluídas: {week.completed}</p>
                <p>Priorizadas: {week.prioritized}</p>
                <p>Abertas: {week.open}</p>
                <p>Eventos: {week.events}</p>
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
      <details className="rounded-lg border border-ink-950/10 bg-white p-4 dark:border-white/10 dark:bg-slate-950/50">
        <summary className="cursor-pointer text-sm font-semibold text-ink-950 dark:text-slate-100">Abrir dados técnicos</summary>
        <div className="mt-4 space-y-4">
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
              <div key={event.id} className="rounded-lg border border-ink-950/10 bg-white p-4 dark:border-white/10 dark:bg-slate-950/50">
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
            <div key={row.label} className="flex items-center justify-between rounded-md border border-ink-950/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950/50">
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
      prioritizedEvents: [],
      openTasks: [],
      openRecentTasks: [],
      staleTasks: [],
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

  const today = new Date();
  const todayValue = toDateInputValue(today);
  const listByGoogleId = new Map(data.taskLists.map((list) => [list.google_task_list_id, list.title]));
  const categoryById = new Map(data.categories.map((category) => [category.id, category.name]));
  const completedThisWeek = data.tasks.filter((task) => task.completed_at && inDateRange(task.completed_at.slice(0, 10), weekStartDate, weekEndDate));
  const openTasks = data.tasks.filter((task) => task.status !== "completed");
  const eventsThisWeek = data.events.filter((event) => inDateRange(event.event_at.slice(0, 10), weekStartDate, weekEndDate));
  const priorityEvents = eventsThisWeek.filter((event) => event.event_type === "PRIORITIZED" && event.previous_value !== null);
  const staleTasks = openTasks.filter((task) => task.updated_at_google && daysBetween(task.updated_at_google.slice(0, 10), todayValue) >= 14);
  const tasksWithoutDate = openTasks.filter((task) => !task.due_date);
  const tasksDueThisWeek = openTasks.filter((task) => task.due_date && inDateRange(task.due_date, weekStartDate, weekEndDate));
  const openRecentTasks = openTasks.filter((task) => task.updated_at_google && daysBetween(task.updated_at_google.slice(0, 10), todayValue) < 14);
  const completedByCategory = countRows(completedThisWeek, (task) => categoryById.get(task.confirmed_category_id ?? task.detected_category_id ?? "") ?? "Sem categoria");
  const openByCategory = countRows(openTasks, (task) => categoryById.get(task.confirmed_category_id ?? task.detected_category_id ?? "") ?? "Sem categoria");

  return {
    completedThisWeek,
    prioritizedEvents: priorityEvents,
    openTasks,
    openRecentTasks,
    staleTasks,
    tasksWithoutDate,
    tasksDueThisWeek,
    eventsThisWeek,
    areaMostWorked: completedByCategory[0] ?? null,
    areaLeastAttention: findLeastAttentionArea(completedByCategory, openByCategory),
    hasInflatedInitialEvents: eventsThisWeek.some((event) => event.event_type === "PRIORITIZED" && event.previous_value === null),
    countByList: countRows(data.tasks, (task) => listByGoogleId.get(task.google_task_list_id) ?? "Lista desconhecida"),
    countByCategory: countRows(data.tasks, (task) => categoryById.get(task.confirmed_category_id ?? task.detected_category_id ?? "") ?? "Sem categoria"),
  };
}

function buildMonthlyWeeks(data: WeeklyReviewData | null, month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const reportsByWeek = new Map((data?.weeklyReports ?? []).map((report) => [report.week_start_date, report]));
  const monthStart = new Date(year, monthNumber - 1, 1);
  const weeks: Array<{ weekStart: string; label: string; range: string; completed: number; prioritized: number; open: number; events: number }> = [];
  const cursor = new Date(monthStart);
  let index = 1;

  while (cursor.getMonth() === monthNumber - 1) {
    const end = new Date(cursor);
    end.setDate(cursor.getDate() + 6);
    const weekStart = toDateInputValue(cursor);
    const report = reportsByWeek.get(weekStart);
    weeks.push({
      weekStart,
      label: `Semana ${index}`,
      range: `${formatDate(weekStart)} a ${formatDate(toDateInputValue(end))}`,
      completed: report?.completed_count ?? 0,
      prioritized: report?.prioritized_count ?? 0,
      open: report?.open_count ?? 0,
      events: report?.events_count ?? 0,
    });
    cursor.setDate(cursor.getDate() + 7);
    index += 1;
  }

  return weeks;
}

function groupTasksByCategory(tasks: RoutineTask[], categories: RoutineCategory[]) {
  const categoryById = new Map(categories.map((category) => [category.id, category.name]));
  const groups = tasks.reduce<Map<string, RoutineTask[]>>((acc, task) => {
    const label = categoryById.get(task.confirmed_category_id ?? task.detected_category_id ?? "") ?? "Sem categoria";
    acc.set(label, [...(acc.get(label) ?? []), task]);
    return acc;
  }, new Map());

  return Array.from(groups.entries())
    .map(([label, groupedTasks]) => ({ label, tasks: groupedTasks }))
    .sort((left, right) => right.tasks.length - left.tasks.length || left.label.localeCompare(right.label));
}

function findLeastAttentionArea(completedByCategory: Array<{ label: string; count: number }>, openByCategory: Array<{ label: string; count: number }>) {
  const completedLabels = new Set(completedByCategory.map((item) => item.label));
  const openWithoutCompletion = openByCategory.find((item) => !completedLabels.has(item.label));
  if (openWithoutCompletion) return openWithoutCompletion;
  return [...completedByCategory].sort((left, right) => left.count - right.count)[0] ?? null;
}

function isAiHeading(line: string) {
  return [
    "Resumo da semana",
    "Principais avanços",
    "Áreas mais trabalhadas",
    "Áreas negligenciadas",
    "Tarefas que viraram prioridade",
    "Pendências que ficaram paradas",
    "Sugestões para a próxima semana",
  ].some((heading) => line.toLocaleLowerCase("pt-BR").replace(/:$/, "") === heading.toLocaleLowerCase("pt-BR"));
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

function inDateRange(date: string, start: string, end: string) {
  return date >= start && date <= end;
}

function daysBetween(left: string, right: string) {
  const leftDate = new Date(`${left}T00:00:00`);
  const rightDate = new Date(`${right}T00:00:00`);
  return Math.floor((rightDate.getTime() - leftDate.getTime()) / 86_400_000);
}

function countRows<T>(items: T[], getLabel: (item: T) => string) {
  const counts = items.reduce<Map<string, number>>((acc, item) => {
    const label = getLabel(item);
    acc.set(label, (acc.get(label) ?? 0) + 1);
    return acc;
  }, new Map());

  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count);
}
