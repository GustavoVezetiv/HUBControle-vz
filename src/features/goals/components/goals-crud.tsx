"use client";

import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import {
  ActionButton,
  BulkActionsBar,
  CategoryBadge,
  CrudFeedback,
  FieldShell,
  inputClassName,
  Modal,
  QuickEditInput,
  QuickEditSelect,
  RowSelectionHint,
  shouldToggleRowSelection,
  TextBadge,
  TitleButton,
  ViewPreferenceActions,
} from "@/features/shared/crud-ui";
import { formatCurrency, formatDate } from "@/features/shared/format";
import { getQuickTableEditPreference } from "@/features/shared/quick-edit";
import type { FeedbackState } from "@/features/shared/types";
import { clearViewPreference, loadViewPreference, preferenceString, preferenceText, saveViewPreference } from "@/features/shared/view-preferences";
import {
  archiveGoal,
  createGoal,
  emptyGoalForm,
  goalToFormValues,
  listGoalCategories,
  listGoals,
  updateGoal,
  type GoalFormValues,
} from "@/features/goals/queries";
import { createClient } from "@/lib/supabase/client";
import type { Category, Goal } from "@/lib/supabase/types";

type ModalState = { mode: "create"; goal: null } | { mode: "edit"; goal: Goal } | null;
type ViewMode = "list" | "kanban";
type KanbanGroupMode = "status" | "goal_category" | "category" | "deadline" | "progress";
type DeadlineFilter = "all" | "overdue" | "next_30" | "future" | "no_target";
type UrgencyFilter = "all" | ReturnType<typeof calculateUrgency>;
type KanbanColumn = {
  value: string;
  label: string;
  goals: Goal[];
};

const goalCategoryOptions = [
  { value: "personal", label: "Pessoal" },
  { value: "professional", label: "Profissional" },
  { value: "course", label: "Curso" },
  { value: "education", label: "Formação" },
  { value: "project", label: "Projetos" },
];

const goalKindOptions = [
  { value: "qualitative", label: "Qualitativa" },
  { value: "financial", label: "Financeira" },
  { value: "numeric", label: "Numérica" },
];

const goalStatusOptions = [
  { value: "active", label: "Ativa" },
  { value: "completed", label: "Concluída" },
  { value: "paused", label: "Pausada" },
  { value: "canceled", label: "Cancelada" },
];
const goalViewModeOptions = ["list", "kanban"] as const;
const goalKanbanGroupOptions = ["status", "goal_category", "category", "deadline", "progress"] as const;
const deadlineFilterOptions = ["all", "overdue", "next_30", "future", "no_target"] as const;
const urgencyFilterOptions = ["all", "urgent", "attention", "comfortable", "no_target"] as const;
type GoalsViewPreference = {
  viewMode?: ViewMode;
  kanbanGroup?: KanbanGroupMode;
  search?: string;
  statusFilter?: string;
  kindFilter?: string;
  categoryFilter?: string;
  deadlineFilter?: DeadlineFilter;
  urgencyFilter?: UrgencyFilter;
};

const goalsDefaultViewPreference: Required<GoalsViewPreference> = {
  viewMode: "list",
  kanbanGroup: "status",
  search: "",
  statusFilter: "all",
  kindFilter: "all",
  categoryFilter: "all",
  deadlineFilter: "all",
  urgencyFilter: "all",
};

export function GoalsCrud() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [categories, setCategories] = useState<Pick<Category, "id" | "name" | "type" | "color" | "icon">[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [allowQuickTableEdit, setAllowQuickTableEdit] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [kanbanGroup, setKanbanGroup] = useState<KanbanGroupMode>("status");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [deadlineFilter, setDeadlineFilter] = useState<DeadlineFilter>("all");
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>("all");

  const summary = useMemo(() => {
    const active = goals.filter((goal) => goal.status === "active");
    const financial = active.filter((goal) => isFinancialGoal(goal));
    return {
      activeCount: active.length,
      qualitativeCount: active.filter((goal) => goal.goal_kind === "qualitative").length,
      withTargetDateCount: active.filter((goal) => Boolean(goal.target_date)).length,
      financialCount: financial.length,
      targetTotal: financial.reduce((sum, goal) => sum + Number(goal.target_amount ?? 0), 0),
      currentTotal: financial.reduce((sum, goal) => sum + Number(goal.current_amount ?? 0), 0),
      monthlyTotal: financial.reduce((sum, goal) => sum + Number(goal.monthly_contribution ?? 0), 0),
    };
  }, [goals]);

  const filteredGoals = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return goals.filter((goal) => {
      const category = categories.find((item) => item.id === goal.category_id);
      return (
        (!needle ||
          goal.name.toLowerCase().includes(needle) ||
          (goal.notes ?? "").toLowerCase().includes(needle) ||
          (category?.name ?? "").toLowerCase().includes(needle)) &&
        (statusFilter === "all" || goal.status === statusFilter) &&
        (kindFilter === "all" || goal.goal_kind === kindFilter || goal.goal_category === kindFilter || goal.goal_type === kindFilter) &&
        (categoryFilter === "all" || goal.category_id === categoryFilter) &&
        (deadlineFilter === "all" || getDeadlineBucket(goal) === deadlineFilter) &&
        (urgencyFilter === "all" || calculateUrgency(goal) === urgencyFilter)
      );
    });
  }, [categories, categoryFilter, deadlineFilter, goals, kindFilter, search, statusFilter, urgencyFilter]);

  const kanbanColumns = useMemo(() => buildKanbanColumns(filteredGoals, categories, kanbanGroup), [categories, filteredGoals, kanbanGroup]);

  async function loadData() {
    setLoading(true);
    const client = createClient();
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth.user) {
      setFeedback({ type: "error", message: "Sessão não encontrada." });
      setLoading(false);
      return;
    }

    setUserId(auth.user.id);
    setAllowQuickTableEdit(await getQuickTableEditPreference(client, auth.user.id));

    const [goalsResult, categoriesResult] = await Promise.all([listGoals(client), listGoalCategories(client)]);
    if (goalsResult.error || categoriesResult.error) {
      setFeedback({ type: "error", message: goalsResult.error?.message ?? categoriesResult.error?.message ?? "Erro ao carregar metas." });
    } else {
      setGoals(goalsResult.data ?? []);
      setCategories(categoriesResult.data ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (!userId) return;
    const preference = loadViewPreference<GoalsViewPreference>("goals", userId);
    if (!preference) return;

    setViewMode(preferenceString(preference.viewMode, goalViewModeOptions, "list"));
    setKanbanGroup(preferenceString(preference.kanbanGroup, goalKanbanGroupOptions, "status"));
    setSearch(preferenceText(preference.search));
    setStatusFilter(preferenceText(preference.statusFilter, "all"));
    setKindFilter(preferenceText(preference.kindFilter, "all"));
    setCategoryFilter(preferenceText(preference.categoryFilter, "all"));
    setDeadlineFilter(preferenceString(preference.deadlineFilter, deadlineFilterOptions, "all"));
    setUrgencyFilter(preferenceString(preference.urgencyFilter, urgencyFilterOptions, "all"));
  }, [userId]);

  function handleSaveViewPreference() {
    const saved = saveViewPreference("goals", userId, {
      viewMode,
      kanbanGroup,
      search,
      statusFilter,
      kindFilter,
      categoryFilter,
      deadlineFilter,
      urgencyFilter,
    });
    setFeedback({
      type: saved ? "success" : "error",
      message: saved ? "Visualização padrão de metas salva." : "Não foi possível salvar a visualização padrão.",
    });
  }

  function handleRestoreViewPreference() {
    clearViewPreference("goals", userId);
    setViewMode(goalsDefaultViewPreference.viewMode);
    setKanbanGroup(goalsDefaultViewPreference.kanbanGroup);
    setSearch(goalsDefaultViewPreference.search);
    setStatusFilter(goalsDefaultViewPreference.statusFilter);
    setKindFilter(goalsDefaultViewPreference.kindFilter);
    setCategoryFilter(goalsDefaultViewPreference.categoryFilter);
    setDeadlineFilter(goalsDefaultViewPreference.deadlineFilter);
    setUrgencyFilter(goalsDefaultViewPreference.urgencyFilter);
    setFeedback({ type: "success", message: "Visualização padrão de metas restaurada." });
  }

  async function handleSubmit(values: GoalFormValues) {
    if (!values.name.trim()) {
      setFeedback({ type: "error", message: "Informe o nome da meta." });
      return;
    }
    const financialValues = values.goal_kind === "financial" ? [values.target_amount, values.current_amount, values.monthly_contribution] : [];
    if (financialValues.some((value) => value.trim() && (Number(value) < 0 || Number.isNaN(Number(value))))) {
      setFeedback({ type: "error", message: "Valores devem ser maiores ou iguais a zero." });
      return;
    }
    if (!userId) return;

    setSaving(true);
    setFeedback(null);
    try {
      const result = modal?.mode === "edit"
        ? await updateGoal(createClient(), modal.goal.id, values)
        : await createGoal(createClient(), userId, values);

      if (result.error) {
        console.error("Erro técnico ao salvar meta:", result.error);
        setFeedback({ type: "error", message: "Não foi possível salvar a meta." });
        return;
      }

      setFeedback({ type: "success", message: modal?.mode === "edit" ? "Meta atualizada." : "Meta criada." });
      setModal(null);
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao salvar meta:", error);
      setFeedback({ type: "error", message: "Não foi possível salvar a meta." });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(goal: Goal) {
    if (!userId) return;
    const confirmed = window.confirm(`Arquivar "${goal.name}"?`);
    if (!confirmed) return;
    const { error } = await archiveGoal(createClient(), goal.id, userId);
    if (error) {
      console.error("Erro técnico ao arquivar meta:", error);
      setFeedback({ type: "error", message: "Não foi possível arquivar a meta." });
      return;
    }
    setFeedback({ type: "success", message: "Meta arquivada." });
    await loadData();
  }

  async function handleQuickUpdate(goal: Goal, patch: Partial<GoalFormValues>) {
    setFeedback(null);
    try {
      const result = await updateGoal(createClient(), goal.id, {
        ...goalToFormValues(goal),
        ...patch,
      });
      if (result.error) {
        console.error("Erro técnico ao atualizar meta:", result.error);
        setFeedback({ type: "error", message: "Não foi possível atualizar a meta." });
        return;
      }
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao atualizar meta:", error);
      setFeedback({ type: "error", message: "Não foi possível atualizar a meta." });
    }
  }

  async function handleKanbanDrop(goalId: string, columnValue: string) {
    const goal = goals.find((item) => item.id === goalId);
    if (!goal) return;

    if (!isEditableKanbanGroup(kanbanGroup)) {
      setFeedback({ type: "error", message: "Este agrupamento é apenas visual. Altere data ou progresso pela edição da meta." });
      return;
    }

    const patch: Partial<GoalFormValues> =
      kanbanGroup === "status"
        ? { status: columnValue }
        : { goal_category: columnValue, goal_type: columnValue };

    await handleQuickUpdate(goal, patch);
    setFeedback({
      type: "success",
      message: kanbanGroup === "status" ? "Status da meta atualizado." : "Tipo/categoria da meta atualizado.",
    });
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    if (!userId) return;
    const confirmed = window.confirm(`Arquivar ${selectedIds.size} metas selecionadas?`);
    if (!confirmed) return;
    setDeletingSelected(true);
    try {
      const client = createClient();
      const results = await Promise.all(Array.from(selectedIds).map((id) => archiveGoal(client, id, userId)));
      const error = results.find((result) => result.error)?.error;
      if (error) {
        console.error("Erro técnico ao arquivar metas em lote:", error);
        setFeedback({ type: "error", message: "Não foi possível arquivar todas as metas." });
        return;
      }
      setSelectedIds(new Set());
      setFeedback({ type: "success", message: "Metas arquivadas." });
      await loadData();
    } finally {
      setDeletingSelected(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Futuro"
        title="Metas"
        description="Acompanhe metas pessoais, profissionais, cursos, formação e projetos sem tratar tudo como meta financeira."
        action={<ActionButton onClick={() => setModal({ mode: "create", goal: null })}>Nova meta</ActionButton>}
      />
      <CrudFeedback feedback={feedback} />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Metas ativas" value={String(summary.activeCount)} helper="Em acompanhamento." tone="info" />
        <StatCard label="Qualitativas" value={String(summary.qualitativeCount)} helper="Sem valor financeiro obrigatório." tone="neutral" />
        <StatCard label="Com prazo" value={String(summary.withTargetDateCount)} helper="Usadas para calcular urgência." tone="warning" />
        {summary.financialCount > 0 ? (
          <StatCard label="Valores financeiros" value={formatCurrency(summary.targetTotal)} helper="Somente metas financeiras ou mensuráveis com valor." tone="success" />
        ) : null}
      </section>

      <SectionCard title="Visualização e filtros">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <FieldShell label="Visualização">
            <select className={inputClassName} value={viewMode} onChange={(event) => setViewMode(event.target.value as ViewMode)}>
              <option value="list">Lista</option>
              <option value="kanban">Kanban</option>
            </select>
          </FieldShell>
          <FieldShell label="Colunas do kanban">
            <select className={inputClassName} value={kanbanGroup} onChange={(event) => setKanbanGroup(event.target.value as KanbanGroupMode)}>
              <option value="status">Status</option>
              <option value="goal_category">Tipo/categoria</option>
              <option value="category">Categoria vinculada</option>
              <option value="deadline">Prazo</option>
              <option value="progress">Progresso</option>
            </select>
          </FieldShell>
          <FieldShell label="Busca">
            <input className={inputClassName} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome" />
          </FieldShell>
          <FieldShell label="Status">
            <select className={inputClassName} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">Todos</option>
              {goalStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </FieldShell>
          <FieldShell label="Tipo">
            <select className={inputClassName} value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}>
              <option value="all">Todos</option>
              {goalKindOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              {goalCategoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </FieldShell>
          <FieldShell label="Categoria">
            <select className={inputClassName} value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="all">Todas</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </FieldShell>
          <FieldShell label="Prazo">
            <select className={inputClassName} value={deadlineFilter} onChange={(event) => setDeadlineFilter(event.target.value as DeadlineFilter)}>
              <option value="all">Todos</option>
              <option value="overdue">Vencidas</option>
              <option value="next_30">Próximas</option>
              <option value="future">Em andamento</option>
              <option value="no_target">Sem prazo</option>
            </select>
          </FieldShell>
          <FieldShell label="Urgência">
            <select className={inputClassName} value={urgencyFilter} onChange={(event) => setUrgencyFilter(event.target.value as UrgencyFilter)}>
              <option value="all">Todas</option>
              <option value="urgent">Urgente</option>
              <option value="attention">Atenção</option>
              <option value="comfortable">Confortável</option>
              <option value="no_target">Sem prazo</option>
            </select>
          </FieldShell>
        </div>
        <p className="mt-3 text-sm text-ink-600 dark:text-slate-300">
          Mostrando {filteredGoals.length} de {goals.length} metas. Arrastar cards altera dados somente nos agrupamentos por status ou tipo/categoria.
        </p>
        <div className="mt-4">
          <ViewPreferenceActions onSave={handleSaveViewPreference} onRestore={handleRestoreViewPreference} />
        </div>
      </SectionCard>

      <SectionCard title="Metas cadastradas">
        {loading ? (
          <p className="text-sm text-ink-600">Carregando metas...</p>
        ) : goals.length === 0 ? (
          <EmptyState title="Nenhuma meta cadastrada" description="Crie metas pessoais para considerar nos planos do mês." />
        ) : (
          <>
            {viewMode === "kanban" ? (
              <GoalsKanban
                categories={categories}
                columns={kanbanColumns}
                editable={isEditableKanbanGroup(kanbanGroup)}
                onDrop={(goalId, columnValue) => void handleKanbanDrop(goalId, columnValue)}
                onEdit={(goal) => setModal({ mode: "edit", goal })}
              />
            ) : (
              <>
            <BulkActionsBar selectedCount={selectedIds.size} deleting={deletingSelected} onClear={() => setSelectedIds(new Set())} onDelete={() => void handleBulkDelete()} />
            <RowSelectionHint />
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-ink-950/10 text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-ink-600">
                  <tr>
                    <th className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={filteredGoals.length > 0 && filteredGoals.every((goal) => selectedIds.has(goal.id))}
                        onChange={(event) => setSelectedIds(event.target.checked ? new Set(filteredGoals.map((goal) => goal.id)) : new Set())}
                        aria-label="Selecionar todas as metas"
                      />
                    </th>
                    <th className="px-4 py-3">Meta</th>
                    <th className="px-4 py-3">Categoria</th>
                    <th className="px-4 py-3">Progresso</th>
                    <th className="px-4 py-3">Prazo</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-950/10">
                  {filteredGoals.map((goal) => (
                    <tr
                      key={goal.id}
                      className="cursor-default"
                      onClick={(event) => {
                        if (!shouldToggleRowSelection(event)) return;
                        const next = new Set(selectedIds);
                        if (next.has(goal.id)) next.delete(goal.id);
                        else next.add(goal.id);
                        setSelectedIds(next);
                      }}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(goal.id)}
                          onChange={(event) => {
                            const next = new Set(selectedIds);
                            if (event.target.checked) next.add(goal.id);
                            else next.delete(goal.id);
                            setSelectedIds(next);
                          }}
                          aria-label={`Selecionar ${goal.name}`}
                        />
                      </td>
                      <td className="px-4 py-3">
                        {allowQuickTableEdit ? (
                          <QuickEditInput value={goal.name} onCommit={(value) => void handleQuickUpdate(goal, { name: value })} />
                        ) : (
                          <TitleButton onClick={() => setModal({ mode: "edit", goal })}>{goal.name}</TitleButton>
                        )}
                        <div className="mt-1 flex flex-wrap gap-2">
                          {goal.category_id ? <CategoryBadge category={categories.find((category) => category.id === goal.category_id)} /> : null}
                          {goal.source_label ? <TextBadge tone="neutral">{goal.source_label}</TextBadge> : null}
                        </div>
                        <p className="mt-1 text-xs text-ink-600">{goal.notes ?? "Sem observações"}</p>
                      </td>
                      <td className="px-4 py-3 text-ink-600">
                        {allowQuickTableEdit ? (
                          <QuickEditSelect
                            value={goal.goal_category ?? goal.goal_type}
                            options={goalCategoryOptions}
                            onCommit={(value) => void handleQuickUpdate(goal, { goal_category: value, goal_type: value })}
                          />
                        ) : (
                          <div className="space-y-1">
                            <p>{labelFor(goalCategoryOptions, goal.goal_category ?? goal.goal_type)}</p>
                            <TextBadge tone="neutral">{labelFor(goalKindOptions, goal.goal_kind ?? "qualitative")}</TextBadge>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-ink-950">
                        <GoalProgress goal={goal} />
                      </td>
                      <td className="px-4 py-3 text-ink-600">
                        {allowQuickTableEdit ? (
                          <QuickEditInput type="date" value={goal.target_date ?? ""} onCommit={(value) => void handleQuickUpdate(goal, { target_date: value })} />
                        ) : (
                          <div className="space-y-1">
                            <span>{formatDate(goal.target_date)}</span>
                            <UrgencyBadge goal={goal} />
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {allowQuickTableEdit ? (
                          <QuickEditSelect value={goal.status} options={goalStatusOptions} onCommit={(value) => void handleQuickUpdate(goal, { status: value })} />
                        ) : (
                          <TextBadge tone={goal.status === "completed" ? "success" : goal.status === "active" ? "info" : "neutral"}>
                            {labelFor(goalStatusOptions, goal.status)}
                          </TextBadge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <ActionButton variant="secondary" onClick={() => setModal({ mode: "edit", goal })}>Editar</ActionButton>
                          <ActionButton variant="danger" onClick={() => void handleDelete(goal)}>Arquivar</ActionButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
              </>
            )}
          </>
        )}
      </SectionCard>

      {modal ? <GoalModal modal={modal} saving={saving} onClose={() => setModal(null)} onSubmit={(values) => void handleSubmit(values)} /> : null}
    </div>
  );
}

function GoalsKanban({
  categories,
  columns,
  editable,
  onDrop,
  onEdit,
}: {
  categories: Pick<Category, "id" | "name" | "type" | "color" | "icon">[];
  columns: KanbanColumn[];
  editable: boolean;
  onDrop: (goalId: string, columnValue: string) => void;
  onEdit: (goal: Goal) => void;
}) {
  return (
    <div className="overflow-x-auto pb-2">
      <div className="grid min-w-[920px] auto-cols-fr grid-flow-col gap-4">
        {columns.map((column) => (
          <section
            key={column.value}
            className="flex min-h-96 flex-col rounded-lg border border-slate-300 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950/55"
            onDragOver={(event) => {
              if (!editable) return;
              event.preventDefault();
            }}
            onDrop={(event) => {
              if (!editable) return;
              const goalId = event.dataTransfer.getData("text/plain");
              if (goalId) onDrop(goalId, column.value);
            }}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink-950 dark:text-slate-100">{column.label}</h3>
                <p className="mt-1 text-xs text-ink-600 dark:text-slate-300">{column.goals.length} meta(s)</p>
              </div>
              {!editable ? <TextBadge tone="neutral">Visual</TextBadge> : null}
            </div>
            <div className="flex flex-1 flex-col gap-3">
              {column.goals.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-300 bg-white/70 px-3 py-8 text-center text-sm text-ink-600 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300">
                  Nenhuma meta
                </div>
              ) : (
                column.goals.map((goal) => (
                  <GoalKanbanCard
                    key={goal.id}
                    categories={categories}
                    draggable={editable}
                    goal={goal}
                    onEdit={onEdit}
                  />
                ))
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function GoalKanbanCard({
  categories,
  draggable,
  goal,
  onEdit,
}: {
  categories: Pick<Category, "id" | "name" | "type" | "color" | "icon">[];
  draggable: boolean;
  goal: Goal;
  onEdit: (goal: Goal) => void;
}) {
  return (
    <article
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", goal.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      className="rounded-lg border border-slate-300 bg-white p-4 text-ink-950 shadow-sm transition hover:border-mint-500 hover:shadow-md dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
    >
      <div className="flex items-start justify-between gap-3">
        <button type="button" className="text-left text-sm font-semibold text-ink-950 hover:text-mint-700 dark:text-slate-100 dark:hover:text-mint-200" onClick={() => onEdit(goal)}>
          {goal.name}
        </button>
        <TextBadge tone={goal.status === "completed" ? "success" : goal.status === "active" ? "info" : "neutral"}>
          {labelFor(goalStatusOptions, goal.status)}
        </TextBadge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <TextBadge tone="neutral">{labelFor(goalCategoryOptions, goal.goal_category ?? goal.goal_type)}</TextBadge>
        <TextBadge tone="neutral">{labelFor(goalKindOptions, goal.goal_kind ?? "qualitative")}</TextBadge>
        {goal.category_id ? <CategoryBadge category={categories.find((category) => category.id === goal.category_id)} /> : null}
      </div>
      <div className="mt-4">
        <GoalProgress goal={goal} />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-600 dark:text-slate-300">
        <span>Prazo: {goal.target_date ? formatDate(goal.target_date) : "Sem prazo"}</span>
        <UrgencyBadge goal={goal} />
      </div>
    </article>
  );
}

function GoalModal({ modal, saving, onClose, onSubmit }: { modal: ModalState; saving: boolean; onClose: () => void; onSubmit: (values: GoalFormValues) => void }) {
  const [values, setValues] = useState<GoalFormValues>(modal?.mode === "edit" ? goalToFormValues(modal.goal) : emptyGoalForm);
  const isFinancial = values.goal_kind === "financial";
  const submitValues = isFinancial
    ? values
    : {
      ...values,
      target_amount: "",
      current_amount: "",
      monthly_contribution: "",
      manual_progress_percent: "",
    };
  return (
    <Modal title={modal?.mode === "edit" ? "Editar meta" : "Nova meta"} description="Valores são opcionais para metas qualitativas. A urgência é calculada pelo prazo." onClose={onClose}>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); onSubmit(submitValues); }}>
        <FieldShell label="Nome"><input required className={inputClassName} value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} /></FieldShell>
        <FieldShell label="Categoria ou tipo"><select className={inputClassName} value={values.goal_category} onChange={(event) => setValues({ ...values, goal_category: event.target.value, goal_type: event.target.value })}>{goalCategoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></FieldShell>
        <FieldShell label="Tipo de meta"><select className={inputClassName} value={values.goal_kind} onChange={(event) => setValues({ ...values, goal_kind: event.target.value })}>{goalKindOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></FieldShell>
        <FieldShell label="Data inicial"><input type="date" className={inputClassName} value={values.start_date} onChange={(event) => setValues({ ...values, start_date: event.target.value })} /></FieldShell>
        <FieldShell label="Data alvo"><input type="date" className={inputClassName} value={values.target_date} onChange={(event) => setValues({ ...values, target_date: event.target.value })} /></FieldShell>
        {isFinancial ? (
          <>
            <FieldShell label="Valor objetivo"><input min="0" step="0.01" type="number" className={inputClassName} value={values.target_amount} onChange={(event) => setValues({ ...values, target_amount: event.target.value })} /></FieldShell>
            <FieldShell label="Valor atual"><input min="0" step="0.01" type="number" className={inputClassName} value={values.current_amount} onChange={(event) => setValues({ ...values, current_amount: event.target.value })} /></FieldShell>
            <FieldShell label="Aporte mensal"><input min="0" step="0.01" type="number" className={inputClassName} value={values.monthly_contribution} onChange={(event) => setValues({ ...values, monthly_contribution: event.target.value })} /></FieldShell>
          </>
        ) : (
          <div className="rounded-md border border-ink-950/10 bg-slate-50 p-4 text-sm leading-6 text-ink-600 md:col-span-2">
            Esta meta será acompanhada por prazo. Valores financeiros ficam ocultos para metas qualitativas ou numéricas.
          </div>
        )}
        <FieldShell label="Status"><select className={inputClassName} value={values.status} onChange={(event) => setValues({ ...values, status: event.target.value })}>{goalStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></FieldShell>
        <div className="md:col-span-2"><FieldShell label="Observações"><textarea rows={3} className={inputClassName} value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} /></FieldShell></div>
        <div className="flex justify-end gap-2 md:col-span-2">
          <ActionButton type="button" variant="secondary" onClick={onClose}>Cancelar</ActionButton>
          <ActionButton type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</ActionButton>
        </div>
      </form>
    </Modal>
  );
}

function GoalProgress({ goal }: { goal: Goal }) {
  const progress = calculateDeadlineProgress(goal);
  return (
    <div className="min-w-32">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-ink-950 dark:text-slate-100">{progress}%</span>
        <span className="text-xs text-ink-500 dark:text-slate-400">Prazo</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-slate-200 dark:bg-slate-700">
        <div className={`h-2 rounded-full ${deadlineProgressColor(goal)}`} style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

function buildKanbanColumns(
  goals: Goal[],
  categories: Pick<Category, "id" | "name" | "type" | "color" | "icon">[],
  groupMode: KanbanGroupMode,
): KanbanColumn[] {
  const definitions = getKanbanColumnDefinitions(goals, categories, groupMode);

  return definitions.map((definition) => ({
    ...definition,
    goals: goals.filter((goal) => getKanbanValue(goal, groupMode) === definition.value),
  }));
}

function getKanbanColumnDefinitions(
  goals: Goal[],
  categories: Pick<Category, "id" | "name" | "type" | "color" | "icon">[],
  groupMode: KanbanGroupMode,
) {
  if (groupMode === "status") return goalStatusOptions;
  if (groupMode === "goal_category") return goalCategoryOptions;
  if (groupMode === "deadline") {
    return [
      { value: "overdue", label: "Vencidas" },
      { value: "next_30", label: "Próximas" },
      { value: "future", label: "Em andamento" },
      { value: "no_target", label: "Sem prazo" },
    ];
  }
  if (groupMode === "progress") {
    return [
      { value: "0_25", label: "0-25%" },
      { value: "26_50", label: "26-50%" },
      { value: "51_75", label: "51-75%" },
      { value: "76_100", label: "76-100%" },
    ];
  }

  const usedCategoryIds = new Set(goals.map((goal) => goal.category_id).filter((id): id is string => Boolean(id)));
  return [
    ...categories
      .filter((category) => usedCategoryIds.has(category.id))
      .map((category) => ({ value: category.id, label: category.name })),
    { value: "no_category", label: "Sem categoria" },
  ];
}

function getKanbanValue(goal: Goal, groupMode: KanbanGroupMode) {
  if (groupMode === "status") return goal.status;
  if (groupMode === "goal_category") return goal.goal_category ?? goal.goal_type ?? "personal";
  if (groupMode === "category") return goal.category_id ?? "no_category";
  if (groupMode === "deadline") return getDeadlineBucket(goal);
  return getProgressBucket(calculateDeadlineProgress(goal));
}

function isEditableKanbanGroup(groupMode: KanbanGroupMode) {
  return groupMode === "status" || groupMode === "goal_category";
}

function getDeadlineBucket(goal: Goal): Exclude<DeadlineFilter, "all"> {
  if (!goal.target_date) return "no_target";
  const today = startOfDay(new Date());
  const target = startOfDay(new Date(`${goal.target_date}T00:00:00`));
  const days = Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return "overdue";
  if (days <= 30) return "next_30";
  return "future";
}

function getProgressBucket(progress: number) {
  if (progress <= 25) return "0_25";
  if (progress <= 50) return "26_50";
  if (progress <= 75) return "51_75";
  return "76_100";
}

function UrgencyBadge({ goal }: { goal: Goal }) {
  const urgency = calculateUrgency(goal);
  const config = {
    comfortable: { label: "Confortável", tone: "success" as const },
    attention: { label: "Atenção", tone: "warning" as const },
    urgent: { label: "Urgente", tone: "danger" as const },
    no_target: { label: "Sem prazo", tone: "neutral" as const },
  }[urgency];
  return <TextBadge tone={config.tone}>{config.label}</TextBadge>;
}

function calculateDeadlineProgress(goal: Goal) {
  if (!goal.target_date) return 0;
  const today = startOfDay(new Date());
  const target = startOfDay(new Date(`${goal.target_date}T00:00:00`));
  const start = goal.start_date
    ? startOfDay(new Date(`${goal.start_date}T00:00:00`))
    : startOfDay(new Date(goal.created_at));
  if (target.getTime() <= start.getTime()) return target.getTime() < today.getTime() ? 100 : 0;
  const elapsed = today.getTime() - start.getTime();
  const total = target.getTime() - start.getTime();
  return clamp((elapsed / total) * 100);
}

function deadlineProgressColor(goal: Goal) {
  const urgency = calculateUrgency(goal);
  if (urgency === "urgent") return "bg-danger-500";
  if (urgency === "attention") return "bg-amber-500";
  if (urgency === "comfortable") return "bg-mint-500";
  return "bg-slate-400";
}

function isFinancialGoal(goal: Goal) {
  return goal.goal_kind === "financial";
}

function calculateUrgency(goal: Goal) {
  if (!goal.target_date) return "no_target";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${goal.target_date}T00:00:00`);
  const days = Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
  if (days < 0 || days <= 7) return "urgent";
  if (days <= 30) return "attention";
  return "comfortable";
}

function startOfDay(date: Date) {
  date.setHours(0, 0, 0, 0);
  return date;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function labelFor(options: { value: string; label: string }[], value: string) {
  return options.find((option) => option.value === value)?.label ?? value;
}
