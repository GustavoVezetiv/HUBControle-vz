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
import type { RoutineAiSummary, RoutineCategory, RoutineTask, RoutineTaskEvent } from "@/lib/supabase/types";
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
        description="Leitura e histórico do Google Tasks para revisar progresso, prioridades e eventos da semana."
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

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Status Google" value={data?.connection?.status === "connected" ? "Conectado" : "Desconectado"} helper="Escopo somente leitura do Google Tasks." tone={data?.connection?.status === "connected" ? "success" : "warning"} />
        <StatCard label="Última sincronização bem-sucedida" value={data?.connection?.last_successful_sync_at || data?.connection?.last_sync_at ? formatDate((data.connection.last_successful_sync_at ?? data.connection.last_sync_at ?? "").slice(0, 10)) : "-"} helper={data?.connection?.last_sync_error ?? "Sem erro registrado."} tone={data?.connection?.last_sync_error ? "danger" : "info"} />
        <StatCard label="Listas lidas" value={String(data?.taskLists.length ?? 0)} helper="Listas atuais do Google Tasks." tone="info" />
        <StatCard label="Tarefas locais" value={String(data?.tasks.length ?? 0)} helper="Abertas e concluídas vistas no sync." tone="neutral" />
      </section>

      <SectionCard title="Sincronização automática" description="Status do job recorrente. A sincronização automática não chama Gemini.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Status automático"
            value={data?.connection?.auto_sync_enabled ? "Ativa" : "Desativada"}
            helper={latestSyncRun ? `Último run: ${latestSyncRun.status}` : "Pendente de configuração ou ainda sem execução."}
            tone={data?.connection?.auto_sync_enabled ? "success" : "warning"}
          />
          <StatCard
            label="Última tentativa"
            value={data?.connection?.last_sync_attempt_at ? formatDate(data.connection.last_sync_attempt_at.slice(0, 10)) : "-"}
            helper="Atualizado por sync manual ou automático."
            tone="info"
          />
          <StatCard
            label="Últimos eventos"
            value={String(latestSyncRun?.events_created ?? 0)}
            helper={latestSyncRun?.started_at ? `Run de ${formatDate(latestSyncRun.started_at.slice(0, 10))}` : "Nenhum run registrado."}
            tone="neutral"
          />
          <StatCard
            label="Último erro"
            value={latestSyncRun?.error_message ? "Sim" : "Não"}
            helper={latestSyncRun?.error_message ?? data?.connection?.last_sync_error ?? "Sem erro no último run."}
            tone={latestSyncRun?.error_message || data?.connection?.last_sync_error ? "danger" : "success"}
          />
        </div>
      </SectionCard>

      {lastSyncResult ? (
        <SectionCard title="Resultado da última sincronização" description="Dados lidos do Google Tasks e salvos no histórico do Hub.">
          <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Listas" value={String(lastSyncResult.listsRead)} helper="Lidas do Google." tone="info" />
            <StatCard label="Tarefas" value={String(lastSyncResult.tasksRead)} helper="Abertas e concluídas." tone="info" />
            <StatCard label="Criadas" value={String(lastSyncResult.createdTasks)} helper="Novas no histórico." tone="success" />
            <StatCard label="Atualizadas" value={String(lastSyncResult.updatedTasks)} helper="Já conhecidas." tone="neutral" />
            <StatCard label="Eventos" value={String(lastSyncResult.eventsCreated)} helper="Mudanças detectadas." tone="warning" />
            <StatCard label="Relatórios" value={String(lastSyncResult.reportsUpdated)} helper="Semana atual." tone="success" />
          </div>
        </SectionCard>
      ) : null}

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
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Concluídas na semana" value={String(summary.completedThisWeek.length)} helper="Tarefas finalizadas entre segunda e domingo." tone="success" />
            <StatCard label="Movidas para Geral/Hoje" value={String(summary.prioritizedEvents.length)} helper="Fila de prioridade, não categoria." tone="warning" />
            <StatCard label="Abertas" value={String(summary.openTasks.length)} helper="Ainda não concluídas." tone="info" />
            <StatCard label="Paradas" value={String(summary.staleTasks.length)} helper="Sem atualização há 14 dias ou mais." tone="danger" />
          </section>

          <SectionCard title="Semana selecionada" description="A análise com Gemini só é gerada quando você clica no botão. A sincronização manual não chama IA.">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,240px)_1fr]">
              <FieldShell label="Início da semana">
                <input
                  type="date"
                  className={inputClassName}
                  value={selectedWeekStart}
                  onChange={(event) => setSelectedWeekStart(toDateInputValue(startOfWeek(new Date(`${event.target.value}T00:00:00`))))}
                />
              </FieldShell>
              <div className="rounded-lg border border-ink-950/10 bg-white p-4 dark:border-white/10 dark:bg-slate-950/50">
                <p className="text-sm font-semibold text-ink-950 dark:text-slate-100">
                  Período: {formatDate(selectedWeekStart)} a {formatDate(selectedWeekEnd)}
                </p>
                <p className="mt-1 text-sm text-ink-600 dark:text-slate-300">
                  Dados enviados à IA: contagens, títulos, datas, listas, categorias e eventos resumidos. O Hub não envia tokens nem JSON bruto do Google.
                </p>
              </div>
            </div>
          </SectionCard>

          <WeeklyAiAnalysisSection
            aiSummary={aiSummary}
            hasEnoughData={summary.completedThisWeek.length + summary.openTasks.length + summary.eventsThisWeek.length > 0}
            analyzing={analyzing}
            onGenerate={() => void handleGenerateAnalysis()}
          />

          <section className="grid gap-4 xl:grid-cols-2">
            <TaskListSection
              title="Tarefas concluídas na semana"
              empty="Nenhuma tarefa concluída nesta semana."
              tasks={summary.completedThisWeek}
              categories={data.categories}
              onConfirmCategory={(task, categoryId) => void handleConfirmCategory(task, categoryId)}
              savingCategoryId={savingCategoryId}
            />
            <EventListSection
              title="Eventos da semana"
              empty="Nenhum evento registrado nesta semana."
              events={summary.eventsThisWeek}
            />
            <TaskListSection
              title="Tarefas abertas"
              empty="Nenhuma tarefa aberta sincronizada."
              tasks={summary.openTasks.slice(0, 20)}
              categories={data.categories}
              onConfirmCategory={(task, categoryId) => void handleConfirmCategory(task, categoryId)}
              savingCategoryId={savingCategoryId}
            />
            <EventListSection
              title="Movidas para Geral/Hoje"
              empty="Nenhuma tarefa priorizada nesta semana."
              events={summary.prioritizedEvents}
            />
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <CountSection title="Contagem por lista" rows={summary.countByList} />
            <CountSection title="Contagem por categoria" rows={summary.countByCategory} />
          </section>

          <SectionCard title="Visualização mensal" description="Semanas salvas no mês selecionado a partir das sincronizações do Google Tasks.">
            <div className="mb-4 max-w-xs">
              <FieldShell label="Mês">
                <input type="month" className={inputClassName} value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)} />
              </FieldShell>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              {monthlyWeeks.map((week) => (
                <div key={week.label} className="rounded-lg border border-ink-950/10 bg-white p-4 dark:border-white/10 dark:bg-slate-950/60">
                  <p className="text-sm font-semibold text-ink-950 dark:text-slate-100">{week.label}</p>
                  <p className="mt-1 text-xs text-ink-600 dark:text-slate-300">{week.range}</p>
                  <div className="mt-3 space-y-1 text-sm text-ink-700 dark:text-slate-200">
                    <p>Concluídas: {week.completed}</p>
                    <p>Priorizadas: {week.prioritized}</p>
                    <p>Abertas: {week.open}</p>
                    <p>Eventos: {week.events}</p>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}

function TaskListSection({
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
        <EmptyState title={empty} description="Aparecerá após a próxima sincronização manual." />
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <div key={task.id} className="rounded-lg border border-ink-950/10 bg-white p-4 dark:border-white/10 dark:bg-slate-950/50">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink-950 dark:text-slate-100">{task.title}</p>
                  <p className="mt-1 text-xs text-ink-600 dark:text-slate-300">
                    {task.status} · {task.due_date ? `vence ${formatDate(task.due_date)}` : "sem data"} · {task.completed_at ? `concluída ${formatDate(task.completed_at.slice(0, 10))}` : "aberta"}
                  </p>
                </div>
                <TextBadge tone={task.status === "completed" ? "success" : "info"}>{task.status === "completed" ? "Concluída" : "Aberta"}</TextBadge>
              </div>
              {task.notes ? <p className="mt-2 text-sm leading-6 text-ink-600 dark:text-slate-300">{task.notes}</p> : null}
              <div className="mt-3 max-w-sm">
                <FieldShell label="Categoria confirmada no Hub">
                  <select
                    className={inputClassName}
                    value={task.confirmed_category_id ?? task.detected_category_id ?? ""}
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
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function EventListSection({ title, empty, events }: { title: string; empty: string; events: RoutineTaskEvent[] }) {
  return (
    <SectionCard title={title}>
      {events.length === 0 ? (
        <EmptyState title={empty} description="Eventos aparecem quando o Hub compara uma sincronização com a anterior." />
      ) : (
        <div className="space-y-3">
          {events.slice(0, 20).map((event) => (
            <div key={event.id} className="rounded-lg border border-ink-950/10 bg-white p-4 dark:border-white/10 dark:bg-slate-950/50">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-semibold text-ink-950 dark:text-slate-100">{event.event_type}</p>
                <p className="text-xs text-ink-600 dark:text-slate-300">{formatDate(event.event_at.slice(0, 10))}</p>
              </div>
              <p className="mt-2 break-all text-xs text-ink-600 dark:text-slate-300">Google task: {event.google_task_id}</p>
            </div>
          ))}
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
    <SectionCard
      title="Análise da semana"
      description="Interpretação textual gerada com Gemini a partir do resumo organizado pelo Hub."
    >
      <div className="mb-4 flex justify-end">
        <ActionButton type="button" onClick={onGenerate} disabled={analyzing}>
          {analyzing ? "Gerando..." : aiSummary ? "Gerar novamente" : "Gerar análise da semana"}
        </ActionButton>
      </div>
      <div className="mb-4 grid gap-4 md:grid-cols-3">
        <StatCard label="Status da análise" value={status} helper={aiSummary?.error_message ?? "A IA não executa sem ação manual."} tone={aiSummary?.summary_text ? "success" : aiSummary?.error_message ? "danger" : "neutral"} />
        <StatCard label="Última análise" value={aiSummary?.updated_at ? formatDate(aiSummary.updated_at.slice(0, 10)) : "-"} helper={aiSummary?.model ?? "Modelo Gemini configurado no servidor."} tone="info" />
        <StatCard label="Dados suficientes" value={hasEnoughData ? "Sim" : "Poucos"} helper="Sem dados, o resumo será limitado." tone={hasEnoughData ? "success" : "warning"} />
      </div>

      {!hasEnoughData ? (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100">
          Não há muitos dados sincronizados para essa semana. Você ainda pode gerar a análise, mas ela ficará limitada ao que existe no Hub.
        </div>
      ) : null}

      {aiSummary?.summary_text ? (
        <div className="whitespace-pre-wrap rounded-lg border border-ink-950/10 bg-white p-4 text-sm leading-7 text-ink-800 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-100">
          {aiSummary.summary_text}
        </div>
      ) : aiSummary?.error_message ? (
        <EmptyState title="A última análise falhou" description={aiSummary.error_message} />
      ) : (
        <EmptyState title="Análise ainda não gerada" description="Clique em Gerar análise da semana para enviar o resumo estruturado ao Gemini." />
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
      staleTasks: [],
      eventsThisWeek: [],
      countByList: [],
      countByCategory: [],
    };
  }

  const today = new Date();
  const listByGoogleId = new Map(data.taskLists.map((list) => [list.google_task_list_id, list.title]));
  const categoryById = new Map(data.categories.map((category) => [category.id, category.name]));
  const eventsThisWeek = data.events.filter((event) => inDateRange(event.event_at.slice(0, 10), weekStartDate, weekEndDate));

  return {
    completedThisWeek: data.tasks.filter((task) => task.completed_at && inDateRange(task.completed_at.slice(0, 10), weekStartDate, weekEndDate)),
    prioritizedEvents: eventsThisWeek.filter((event) => event.event_type === "PRIORITIZED" || (event.event_type === "MOVED_LIST" && event.metadata && JSON.stringify(event.metadata).includes("prioritized"))),
    openTasks: data.tasks.filter((task) => task.status !== "completed"),
    staleTasks: data.tasks.filter((task) => task.status !== "completed" && task.updated_at_google && daysBetween(task.updated_at_google.slice(0, 10), toDateInputValue(today)) >= 14),
    eventsThisWeek,
    countByList: countRows(data.tasks, (task) => listByGoogleId.get(task.google_task_list_id) ?? "Lista desconhecida"),
    countByCategory: countRows(data.tasks, (task) => categoryById.get(task.confirmed_category_id ?? task.detected_category_id ?? "") ?? "Sem categoria"),
  };
}

function buildMonthlyWeeks(data: WeeklyReviewData | null, month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const reportsByWeek = new Map((data?.weeklyReports ?? []).map((report) => [report.week_start_date, report]));
  const monthStart = new Date(year, monthNumber - 1, 1);
  const weeks = Array.from({ length: 4 }, (_, index) => {
    const start = new Date(monthStart);
    start.setDate(1 + index * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const weekStart = toDateInputValue(start);
    const report = reportsByWeek.get(weekStart);
    return {
      label: `Semana ${index + 1}`,
      range: `${formatDate(toDateInputValue(start))} a ${formatDate(toDateInputValue(end))}`,
      completed: report?.completed_count ?? 0,
      prioritized: report?.prioritized_count ?? 0,
      open: report?.open_count ?? 0,
      events: report?.events_count ?? 0,
    };
  });

  const summary = weeks.reduce(
    (acc, week) => ({
      label: "Resumo do mês",
      range: month,
      completed: acc.completed + week.completed,
      prioritized: acc.prioritized + week.prioritized,
      open: Math.max(acc.open, week.open),
      events: acc.events + week.events,
    }),
    { label: "Resumo do mês", range: month, completed: 0, prioritized: 0, open: 0, events: 0 },
  );

  return [...weeks, summary];
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
