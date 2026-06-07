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
} from "@/features/shared/crud-ui";
import { formatCurrency, formatDate } from "@/features/shared/format";
import { getQuickTableEditPreference } from "@/features/shared/quick-edit";
import type { FeedbackState } from "@/features/shared/types";
import {
  createGoal,
  deleteGoal,
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
    const confirmed = window.confirm(`Excluir "${goal.name}"?`);
    if (!confirmed) return;
    const { error } = await deleteGoal(createClient(), goal.id);
    if (error) {
      console.error("Erro técnico ao excluir meta:", error);
      setFeedback({ type: "error", message: "Não foi possível excluir a meta." });
      return;
    }
    setFeedback({ type: "success", message: "Meta excluída." });
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

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    const confirmed = window.confirm(`Excluir ${selectedIds.size} metas selecionadas?`);
    if (!confirmed) return;
    setDeletingSelected(true);
    try {
      const client = createClient();
      const results = await Promise.all(Array.from(selectedIds).map((id) => deleteGoal(client, id)));
      const error = results.find((result) => result.error)?.error;
      if (error) {
        console.error("Erro técnico ao excluir metas em lote:", error);
        setFeedback({ type: "error", message: "Não foi possível excluir todas as metas." });
        return;
      }
      setSelectedIds(new Set());
      setFeedback({ type: "success", message: "Metas excluídas." });
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

      <SectionCard title="Metas cadastradas">
        {loading ? (
          <p className="text-sm text-ink-600">Carregando metas...</p>
        ) : goals.length === 0 ? (
          <EmptyState title="Nenhuma meta cadastrada" description="Crie metas pessoais para considerar nos planos do mês." />
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
                        checked={goals.length > 0 && goals.every((goal) => selectedIds.has(goal.id))}
                        onChange={(event) => setSelectedIds(event.target.checked ? new Set(goals.map((goal) => goal.id)) : new Set())}
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
                  {goals.map((goal) => (
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
                          <ActionButton variant="danger" onClick={() => void handleDelete(goal)}>Excluir</ActionButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </SectionCard>

      {modal ? <GoalModal modal={modal} saving={saving} onClose={() => setModal(null)} onSubmit={(values) => void handleSubmit(values)} /> : null}
    </div>
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
        <span className="text-sm font-semibold text-ink-950">{progress}%</span>
        <span className="text-xs text-ink-500">Prazo</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-slate-200">
        <div className={`h-2 rounded-full ${deadlineProgressColor(goal)}`} style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
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
