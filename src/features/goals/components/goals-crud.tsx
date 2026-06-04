"use client";

import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { ActionButton, BulkActionsBar, CrudFeedback, FieldShell, inputClassName, Modal, QuickEditInput, QuickEditSelect, RowSelectionHint, shouldToggleRowSelection, TextBadge, TitleButton } from "@/features/shared/crud-ui";
import { formatCurrency, formatDate } from "@/features/shared/format";
import { getQuickTableEditPreference } from "@/features/shared/quick-edit";
import type { FeedbackState } from "@/features/shared/types";
import { createGoal, deleteGoal, emptyGoalForm, goalToFormValues, listGoals, updateGoal, type GoalFormValues } from "@/features/goals/queries";
import { createClient } from "@/lib/supabase/client";
import type { Goal } from "@/lib/supabase/types";

type ModalState = { mode: "create"; goal: null } | { mode: "edit"; goal: Goal } | null;

const goalTypeOptions = [
  { value: "emergency_reserve", label: "Reserva" },
  { value: "debt_reduction", label: "Reduzir dívida" },
  { value: "planned_purchase", label: "Compra planejada" },
  { value: "savings", label: "Guardar dinheiro" },
  { value: "other", label: "Outra" },
];

const goalStatusOptions = [
  { value: "active", label: "Ativa" },
  { value: "completed", label: "Concluída" },
  { value: "paused", label: "Pausada" },
  { value: "canceled", label: "Cancelada" },
];

export function GoalsCrud() {
  const [goals, setGoals] = useState<Goal[]>([]);
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
    return {
      activeCount: active.length,
      targetTotal: active.reduce((sum, goal) => sum + Number(goal.target_amount), 0),
      currentTotal: active.reduce((sum, goal) => sum + Number(goal.current_amount), 0),
      monthlyTotal: active.reduce((sum, goal) => sum + Number(goal.monthly_contribution), 0),
    };
  }, [goals]);

  async function loadData() {
    setLoading(true);
    const client = createClient();
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth.user) {
      setFeedback({ type: "error", message: "Sessão não encontrada. Entre novamente." });
      setLoading(false);
      return;
    }
    setUserId(auth.user.id);
    const [result, quickEdit] = await Promise.all([
      listGoals(client),
      getQuickTableEditPreference(client, auth.user.id),
    ]);
    if (result.error) {
      console.error("Erro técnico ao carregar metas:", result.error);
      setFeedback({ type: "error", message: "Não foi possível carregar as metas." });
    } else {
      setGoals(result.data ?? []);
      setAllowQuickTableEdit(quickEdit);
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
    if ([values.target_amount, values.current_amount, values.monthly_contribution].some((value) => Number(value) < 0 || Number.isNaN(Number(value)))) {
      setFeedback({ type: "error", message: "Valores devem ser maiores ou iguais a zero." });
      return;
    }
    if (!userId) return;

    setSaving(true);
    setFeedback(null);
    try {
      const client = createClient();
      const result = modal?.mode === "edit" ? await updateGoal(client, modal.goal.id, values) : await createGoal(client, userId, values);
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
    if (!window.confirm(`Excluir ${goal.name}?`)) return;
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
        console.error("Erro técnico ao editar meta rapidamente:", result.error);
        setFeedback({ type: "error", message: "Não foi possível salvar a edição rápida." });
        return;
      }

      await loadData();
    } catch (error) {
      console.error("Erro técnico ao editar meta rapidamente:", error);
      setFeedback({ type: "error", message: "Não foi possível salvar a edição rápida." });
    }
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    if (!window.confirm(`Tem certeza que deseja excluir ${ids.length} itens? Esta ação não pode ser desfeita.`)) {
      return;
    }

    setDeletingSelected(true);
    setFeedback(null);

    try {
      const client = createClient();
      const results = await Promise.all(ids.map((id) => deleteGoal(client, id)));
      const failed = results.find((result) => result.error);

      if (failed?.error) {
        console.error("Erro técnico ao excluir metas selecionadas:", failed.error);
        setFeedback({ type: "error", message: "Não foi possível excluir todos os itens selecionados." });
        return;
      }

      setSelectedIds(new Set());
      setFeedback({ type: "success", message: `${ids.length} meta(s) excluída(s).` });
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao excluir metas selecionadas:", error);
      setFeedback({ type: "error", message: "Não foi possível excluir os itens selecionados." });
    } finally {
      setDeletingSelected(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Planejamento pessoal" title="Metas" description="Acompanhe metas financeiras e pessoais sem misturar com tarefas internas do produto." action={<ActionButton onClick={() => setModal({ mode: "create", goal: null })}>Nova meta</ActionButton>} />
      <CrudFeedback feedback={feedback} />
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Metas ativas" value={String(summary.activeCount)} helper="Em acompanhamento." tone="info" />
        <StatCard label="Objetivo total" value={formatCurrency(summary.targetTotal)} helper="Soma das metas ativas." tone="warning" />
        <StatCard label="Progresso atual" value={formatCurrency(summary.currentTotal)} helper="Valor já acumulado." tone="success" />
        <StatCard label="Aporte mensal" value={formatCurrency(summary.monthlyTotal)} helper="Contribuição planejada." tone="neutral" />
      </section>
      <SectionCard title="Metas cadastradas">
        {loading ? <p className="text-sm text-ink-600">Carregando metas...</p> : goals.length === 0 ? <EmptyState title="Nenhuma meta cadastrada" description="Crie metas pessoais para considerar nos planos do mês." /> : (
          <><BulkActionsBar selectedCount={selectedIds.size} deleting={deletingSelected} onClear={() => setSelectedIds(new Set())} onDelete={() => void handleBulkDelete()} /><RowSelectionHint /><div className="overflow-x-auto"><table className="min-w-full divide-y divide-ink-950/10 text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-ink-600"><tr><th className="px-4 py-3"><input type="checkbox" checked={goals.length > 0 && goals.every((goal) => selectedIds.has(goal.id))} onChange={(event) => setSelectedIds(event.target.checked ? new Set(goals.map((goal) => goal.id)) : new Set())} aria-label="Selecionar todas as metas" /></th><th className="px-4 py-3">Meta</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3">Atual</th><th className="px-4 py-3">Objetivo</th><th className="px-4 py-3">Data</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Ações</th></tr></thead><tbody className="divide-y divide-ink-950/10">
            {goals.map((goal) => <tr key={goal.id} onClick={(event) => { if (!shouldToggleRowSelection(event)) return; const next = new Set(selectedIds); if (next.has(goal.id)) next.delete(goal.id); else next.add(goal.id); setSelectedIds(next); }} className="cursor-default"><td className="px-4 py-3"><input type="checkbox" checked={selectedIds.has(goal.id)} onChange={(event) => { const next = new Set(selectedIds); if (event.target.checked) next.add(goal.id); else next.delete(goal.id); setSelectedIds(next); }} aria-label={`Selecionar ${goal.name}`} /></td><td className="px-4 py-3">{allowQuickTableEdit ? <QuickEditInput value={goal.name} onCommit={(value) => void handleQuickUpdate(goal, { name: value })} /> : <TitleButton onClick={() => setModal({ mode: "edit", goal })}>{goal.name}</TitleButton>}<div className="mt-1 flex flex-wrap gap-2">{goal.category_label ? <TextBadge tone="info">{goal.category_label}</TextBadge> : null}{goal.source_label ? <TextBadge tone="neutral">{goal.source_label}</TextBadge> : null}</div><p className="mt-1 text-xs text-ink-600">{goal.notes ?? "Sem observações"}</p></td><td className="px-4 py-3 text-ink-600">{allowQuickTableEdit ? <QuickEditSelect value={goal.goal_type} options={goalTypeOptions} onCommit={(value) => void handleQuickUpdate(goal, { goal_type: value })} /> : labelFor(goalTypeOptions, goal.goal_type)}</td><td className="px-4 py-3 text-ink-950">{allowQuickTableEdit ? <QuickEditInput type="number" value={String(goal.current_amount)} onCommit={(value) => void handleQuickUpdate(goal, { current_amount: value })} /> : formatCurrency(Number(goal.current_amount))}</td><td className="px-4 py-3 text-ink-950">{allowQuickTableEdit ? <QuickEditInput type="number" value={String(goal.target_amount)} onCommit={(value) => void handleQuickUpdate(goal, { target_amount: value })} /> : formatCurrency(Number(goal.target_amount))}</td><td className="px-4 py-3 text-ink-600">{allowQuickTableEdit ? <QuickEditInput type="date" value={goal.target_date ?? ""} onCommit={(value) => void handleQuickUpdate(goal, { target_date: value })} /> : formatDate(goal.target_date)}</td><td className="px-4 py-3">{allowQuickTableEdit ? <QuickEditSelect value={goal.status} options={goalStatusOptions} onCommit={(value) => void handleQuickUpdate(goal, { status: value })} /> : <TextBadge tone={goal.status === "completed" ? "success" : goal.status === "active" ? "info" : "neutral"}>{labelFor(goalStatusOptions, goal.status)}</TextBadge>}</td><td className="px-4 py-3"><div className="flex justify-end gap-2"><ActionButton variant="secondary" onClick={() => setModal({ mode: "edit", goal })}>Editar</ActionButton><ActionButton variant="danger" onClick={() => void handleDelete(goal)}>Excluir</ActionButton></div></td></tr>)}
          </tbody></table></div>
          </>
        )}
      </SectionCard>
      {modal ? <GoalModal modal={modal} saving={saving} onClose={() => setModal(null)} onSubmit={(values) => void handleSubmit(values)} /> : null}
    </div>
  );
}

function GoalModal({ modal, saving, onClose, onSubmit }: { modal: ModalState; saving: boolean; onClose: () => void; onSubmit: (values: GoalFormValues) => void }) {
  const [values, setValues] = useState<GoalFormValues>(modal?.mode === "edit" ? goalToFormValues(modal.goal) : emptyGoalForm);
  return (
    <Modal title={modal?.mode === "edit" ? "Editar meta" : "Nova meta"} description="Meta é planejamento. Ela não cria pagamento automático nem altera seu caixa sozinha." onClose={onClose}>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); onSubmit(values); }}>
        <FieldShell label="Nome"><input required className={inputClassName} value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} /></FieldShell>
        <FieldShell label="Tipo"><select className={inputClassName} value={values.goal_type} onChange={(event) => setValues({ ...values, goal_type: event.target.value })}>{goalTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></FieldShell>
        <FieldShell label="Valor objetivo"><input min="0" step="0.01" type="number" className={inputClassName} value={values.target_amount} onChange={(event) => setValues({ ...values, target_amount: event.target.value })} /></FieldShell>
        <FieldShell label="Valor atual"><input min="0" step="0.01" type="number" className={inputClassName} value={values.current_amount} onChange={(event) => setValues({ ...values, current_amount: event.target.value })} /></FieldShell>
        <FieldShell label="Data alvo"><input type="date" className={inputClassName} value={values.target_date} onChange={(event) => setValues({ ...values, target_date: event.target.value })} /></FieldShell>
        <FieldShell label="Aporte mensal"><input min="0" step="0.01" type="number" className={inputClassName} value={values.monthly_contribution} onChange={(event) => setValues({ ...values, monthly_contribution: event.target.value })} /></FieldShell>
        <FieldShell label="Status"><select className={inputClassName} value={values.status} onChange={(event) => setValues({ ...values, status: event.target.value })}>{goalStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></FieldShell>
        <div className="md:col-span-2"><FieldShell label="Observações"><textarea rows={3} className={inputClassName} value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} /></FieldShell></div>
        <div className="flex justify-end gap-2 md:col-span-2"><ActionButton type="button" variant="secondary" onClick={onClose}>Cancelar</ActionButton><ActionButton type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</ActionButton></div>
      </form>
    </Modal>
  );
}

function labelFor(options: { value: string; label: string }[], value: string) {
  return options.find((option) => option.value === value)?.label ?? value;
}
