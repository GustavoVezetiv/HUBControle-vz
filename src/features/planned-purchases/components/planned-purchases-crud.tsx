"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { createPlannedPurchase, deletePlannedPurchase, listPlannedPurchases, listPlannedPurchaseSupportData, updatePlannedPurchase } from "@/features/planned-purchases/queries";
import { decisionStatusOptions, emptyPlannedPurchaseForm, plannedPurchaseToFormValues, type PlannedPurchaseFormValues, type PlannedPurchaseRow, type PlannedPurchaseSupportData } from "@/features/planned-purchases/types";
import { ActionButton, BulkActionsBar, CategoryBadge, CrudFeedback, FieldShell, inputClassName, Modal, QuickEditInput, QuickEditSelect, RowSelectionHint, shouldToggleRowSelection, TextBadge, TitleButton } from "@/features/shared/crud-ui";
import { formatCurrency, formatDate } from "@/features/shared/format";
import { optionLabel, paymentMethodOptions, priorityOptions } from "@/features/shared/options";
import { PeriodFilter } from "@/features/shared/period-filter";
import { isDateInPeriod, parsePeriodSearchParams } from "@/features/shared/period";
import { getQuickTableEditPreference } from "@/features/shared/quick-edit";
import type { FeedbackState } from "@/features/shared/types";
import { createClient } from "@/lib/supabase/client";

type ModalState = { mode: "create"; item: null } | { mode: "edit"; item: PlannedPurchaseRow } | null;

export function PlannedPurchasesCrud() {
  const searchParams = useSearchParams();
  const [items, setItems] = useState<PlannedPurchaseRow[]>([]);
  const [support, setSupport] = useState<PlannedPurchaseSupportData>({ categories: [] });
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") ?? "all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [period, setPeriod] = useState(() => parsePeriodSearchParams(Object.fromEntries(searchParams.entries())));
  const [modal, setModal] = useState<ModalState>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [allowQuickTableEdit, setAllowQuickTableEdit] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const client = createClient();
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth.user) {
      setFeedback({ type: "error", message: "Sessão não encontrada. Entre novamente." });
      setLoading(false);
      return;
    }
    setUserId(auth.user.id);

    const [purchaseResult, supportResult, quickEdit] = await Promise.all([
      listPlannedPurchases(client),
      listPlannedPurchaseSupportData(client),
      getQuickTableEditPreference(client, auth.user.id),
    ]);

    if (purchaseResult.error) setFeedback({ type: "error", message: purchaseResult.error.message });
    else setItems(purchaseResult.data ?? []);

    if (supportResult.categories.error) setFeedback({ type: "error", message: supportResult.categories.error.message });
    else setSupport({ categories: supportResult.categories.data ?? [] });
    setAllowQuickTableEdit(quickEdit);

    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const periodItems = useMemo(() => {
    return items.filter((item) => isDateInPeriod(item.target_date, period));
  }, [items, period]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return periodItems.filter((item) => {
      const matchesSearch = !term || [item.title, item.description, item.notes].some((value) => value?.toLowerCase().includes(term));
      const matchesStatus = statusFilter === "all" || item.decision_status === statusFilter;
      const matchesRisk = riskFilter === "all" || item.risk_level === riskFilter;
      return matchesSearch && matchesStatus && matchesRisk;
    });
  }, [periodItems, riskFilter, search, statusFilter]);

  const summary = useMemo(() => {
    const active = periodItems.filter((item) => !["purchased", "canceled"].includes(item.decision_status));
    const highRisk = active.filter((item) => ["high", "critical"].includes(item.risk_level));
    const approved = active.filter((item) => item.decision_status === "approved");
    return {
      totalActive: active.reduce((sum, item) => sum + Number(item.estimated_amount), 0),
      highRiskTotal: highRisk.reduce((sum, item) => sum + Number(item.estimated_amount), 0),
      approvedTotal: approved.reduce((sum, item) => sum + Number(item.estimated_amount), 0),
      count: active.length,
    };
  }, [periodItems]);

  async function handleSubmit(values: PlannedPurchaseFormValues) {
    if (!values.title.trim()) {
      setFeedback({ type: "error", message: "Informe o nome da compra ou desejo." });
      return;
    }
    if (Number(values.estimated_amount) < 0) {
      setFeedback({ type: "error", message: "O valor estimado deve ser maior ou igual a zero." });
      return;
    }
    if (values.installment_count && Number(values.installment_count) <= 0) {
      setFeedback({ type: "error", message: "O número de parcelas deve ser maior que zero." });
      return;
    }
    if (!userId) {
      setFeedback({ type: "error", message: "Sessão não encontrada. Entre novamente." });
      return;
    }

    setSaving(true);
    try {
      const client = createClient();
      const result = modal?.mode === "edit"
        ? await updatePlannedPurchase(client, modal.item.id, values)
        : await createPlannedPurchase(client, userId, values);

      if (result.error) {
        console.error("Erro técnico ao salvar compra planejada:", result.error);
        setFeedback({ type: "error", message: result.error.message });
        return;
      }

      setFeedback({ type: "success", message: modal?.mode === "edit" ? "Compra atualizada." : "Compra adicionada." });
      setModal(null);
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao salvar compra planejada:", error);
      setFeedback({ type: "error", message: "Não foi possível salvar a compra planejada." });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item: PlannedPurchaseRow) {
    if (!window.confirm("Excluir esta compra planejada?")) return;
    const { error } = await deletePlannedPurchase(createClient(), item.id);
    if (error) {
      console.error("Erro técnico ao excluir compra planejada:", error);
      setFeedback({ type: "error", message: error.message });
    } else {
      setFeedback({ type: "success", message: "Compra excluída." });
      await loadData();
    }
  }

  async function handleQuickUpdate(item: PlannedPurchaseRow, patch: Partial<PlannedPurchaseFormValues>) {
    setFeedback(null);

    try {
      const result = await updatePlannedPurchase(createClient(), item.id, {
        ...plannedPurchaseToFormValues(item),
        ...patch,
      });

      if (result.error) {
        console.error("Erro técnico ao editar compra planejada rapidamente:", result.error);
        setFeedback({ type: "error", message: "Não foi possível salvar a edição rápida." });
        return;
      }

      await loadData();
    } catch (error) {
      console.error("Erro técnico ao editar compra planejada rapidamente:", error);
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
      const results = await Promise.all(ids.map((id) => deletePlannedPurchase(client, id)));
      const failed = results.find((result) => result.error);

      if (failed?.error) {
        console.error("Erro técnico ao excluir compras selecionadas:", failed.error);
        setFeedback({ type: "error", message: "Não foi possível excluir todos os itens selecionados." });
        return;
      }

      setSelectedIds(new Set());
      setFeedback({ type: "success", message: `${ids.length} compra(s) excluída(s).` });
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao excluir compras selecionadas:", error);
      setFeedback({ type: "error", message: "Não foi possível excluir os itens selecionados." });
    } finally {
      setDeletingSelected(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Decisão futura"
        title="Compras e desejos"
        description="Organize compras planejadas antes que elas pressionem o caixa ou a próxima fatura."
        action={<ActionButton onClick={() => setModal({ mode: "create", item: null })}>Nova compra</ActionButton>}
      />
      <CrudFeedback feedback={feedback} />
      <PeriodFilter value={period} onChange={setPeriod} description="Escolha o período de data alvo das compras planejadas." syncUrl />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Em análise" value={formatCurrency(summary.totalActive)} helper={`${summary.count} itens ativos.`} tone="info" />
        <StatCard label="Alta prioridade" value={formatCurrency(summary.highRiskTotal)} helper="Pode afetar decisões do mês." tone="warning" />
        <StatCard label="Aprovadas" value={formatCurrency(summary.approvedTotal)} helper="Tendem a virar obrigação." tone="danger" />
        <StatCard label="Impacto futuro" value={String(summary.count)} helper="Compras não realizadas ainda." tone="neutral" />
      </section>

      <SectionCard title="Lista de compras" description="Compras planejadas não são contas ainda, mas podem virar pressão no caixa.">
        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <input value={search} onChange={(event) => setSearch(event.target.value)} className={inputClassName} placeholder="Buscar por nome ou descrição" />
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={inputClassName}>
            <option value="all">Todos os status</option>
            {decisionStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)} className={inputClassName}>
            <option value="all">Todos os riscos</option>
            {priorityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        {loading ? (
          <p className="text-sm text-ink-600">Carregando compras...</p>
        ) : filtered.length === 0 ? (
          <EmptyState title="Nenhuma compra no período" description="Ajuste o período ou os filtros para ver outras compras planejadas." />
        ) : (
          <>
          <BulkActionsBar
            selectedCount={selectedIds.size}
            deleting={deletingSelected}
            onClear={() => setSelectedIds(new Set())}
            onDelete={() => void handleBulkDelete()}
          />
          <RowSelectionHint />
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-ink-950/10 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-ink-600">
                <tr>
                  <th className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && filtered.every((item) => selectedIds.has(item.id))}
                      onChange={(event) => {
                        if (event.target.checked) {
                          setSelectedIds(new Set([...selectedIds, ...filtered.map((item) => item.id)]));
                          return;
                        }
                        const next = new Set(selectedIds);
                        filtered.forEach((item) => next.delete(item.id));
                        setSelectedIds(next);
                      }}
                      aria-label="Selecionar todas as compras filtradas"
                    />
                  </th>
                  <th className="px-4 py-3">Compra</th>
                  <th className="px-4 py-3">Valor</th>
                  <th className="px-4 py-3">Categoria</th>
                  <th className="px-4 py-3">Data alvo</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Risco</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-950/10">
                {filtered.map((item) => (
                  <tr
                    key={item.id}
                    onClick={(event) => {
                      if (!shouldToggleRowSelection(event)) return;
                      const next = new Set(selectedIds);
                      if (next.has(item.id)) next.delete(item.id);
                      else next.add(item.id);
                      setSelectedIds(next);
                    }}
                    className="cursor-default"
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(item.id)}
                        onChange={(event) => {
                          const next = new Set(selectedIds);
                          if (event.target.checked) next.add(item.id);
                          else next.delete(item.id);
                          setSelectedIds(next);
                        }}
                        aria-label={`Selecionar ${item.title}`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      {allowQuickTableEdit ? (
                        <QuickEditInput value={item.title} onCommit={(value) => void handleQuickUpdate(item, { title: value })} />
                      ) : (
                        <TitleButton onClick={() => setModal({ mode: "edit", item })}>{item.title}</TitleButton>
                      )}
                      <p className="text-xs text-ink-600">{item.description ?? "Sem descrição"}</p>
                    </td>
                    <td className="px-4 py-3 text-ink-950">
                      {allowQuickTableEdit ? (
                        <QuickEditInput type="number" value={String(item.estimated_amount)} onCommit={(value) => void handleQuickUpdate(item, { estimated_amount: value })} />
                      ) : formatCurrency(Number(item.estimated_amount))}
                    </td>
                    <td className="px-4 py-3">
                      {allowQuickTableEdit ? (
                        <QuickEditSelect value={item.category_id ?? ""} options={[{ value: "", label: "Sem categoria" }, ...support.categories.map((category) => ({ value: category.id, label: category.name }))]} onCommit={(value) => void handleQuickUpdate(item, { category_id: value })} />
                      ) : (
                        <CategoryBadge category={support.categories.find((category) => category.id === item.category_id)} />
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {allowQuickTableEdit ? (
                        <QuickEditInput type="date" value={item.target_date ?? ""} onCommit={(value) => void handleQuickUpdate(item, { target_date: value })} />
                      ) : formatDate(item.target_date)}
                    </td>
                    <td className="px-4 py-3">
                      {allowQuickTableEdit ? (
                        <QuickEditSelect value={item.decision_status} options={decisionStatusOptions} onCommit={(value) => void handleQuickUpdate(item, { decision_status: value })} />
                      ) : (
                        <TextBadge tone={item.decision_status === "approved" ? "danger" : item.decision_status === "purchased" ? "success" : "neutral"}>{optionLabel(decisionStatusOptions, item.decision_status)}</TextBadge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {allowQuickTableEdit ? (
                        <QuickEditSelect value={item.risk_level} options={priorityOptions} onCommit={(value) => void handleQuickUpdate(item, { risk_level: value as PlannedPurchaseFormValues["risk_level"] })} />
                      ) : optionLabel(priorityOptions, item.risk_level)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <ActionButton variant="secondary" onClick={() => setModal({ mode: "edit", item })}>Editar</ActionButton>
                        <ActionButton variant="danger" onClick={() => void handleDelete(item)}>Excluir</ActionButton>
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

      {modal ? <PlannedPurchaseModal modal={modal} saving={saving} support={support} onClose={() => setModal(null)} onSubmit={(values) => void handleSubmit(values)} /> : null}
    </div>
  );
}

function PlannedPurchaseModal({ modal, saving, support, onClose, onSubmit }: { modal: ModalState; saving: boolean; support: PlannedPurchaseSupportData; onClose: () => void; onSubmit: (values: PlannedPurchaseFormValues) => void }) {
  const [values, setValues] = useState<PlannedPurchaseFormValues>(modal?.mode === "edit" ? plannedPurchaseToFormValues(modal.item) : emptyPlannedPurchaseForm);

  return (
    <Modal title={modal?.mode === "edit" ? "Editar compra" : "Nova compra"} description="Use para simular desejos antes que virem gasto real." onClose={onClose}>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); onSubmit(values); }}>
        <div className="md:col-span-2"><FieldShell label="Nome"><input required className={inputClassName} value={values.title} onChange={(event) => setValues({ ...values, title: event.target.value })} /></FieldShell></div>
        <div className="md:col-span-2"><FieldShell label="Descrição"><textarea rows={3} className={inputClassName} value={values.description} onChange={(event) => setValues({ ...values, description: event.target.value })} /></FieldShell></div>
        <FieldShell label="Valor estimado"><input min="0" step="0.01" type="number" className={inputClassName} value={values.estimated_amount} onChange={(event) => setValues({ ...values, estimated_amount: event.target.value })} /></FieldShell>
        <FieldShell label="Data alvo"><input type="date" className={inputClassName} value={values.target_date} onChange={(event) => setValues({ ...values, target_date: event.target.value })} /></FieldShell>
        <FieldShell label="Categoria"><select className={inputClassName} value={values.category_id} onChange={(event) => setValues({ ...values, category_id: event.target.value })}><option value="">Sem categoria</option>{support.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></FieldShell>
        <FieldShell label="Forma planejada"><select className={inputClassName} value={values.payment_method} onChange={(event) => setValues({ ...values, payment_method: event.target.value })}>{paymentMethodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></FieldShell>
        <FieldShell label="Parcelas"><input min="1" type="number" className={inputClassName} value={values.installment_count} onChange={(event) => setValues({ ...values, installment_count: event.target.value })} /></FieldShell>
        <FieldShell label="Status"><select className={inputClassName} value={values.decision_status} onChange={(event) => setValues({ ...values, decision_status: event.target.value })}>{decisionStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></FieldShell>
        <FieldShell label="Risco"><select className={inputClassName} value={values.risk_level} onChange={(event) => setValues({ ...values, risk_level: event.target.value as PlannedPurchaseFormValues["risk_level"] })}>{priorityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></FieldShell>
        <div className="md:col-span-2"><FieldShell label="Notas"><textarea rows={3} className={inputClassName} value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} /></FieldShell></div>
        <div className="flex justify-end gap-2 md:col-span-2"><ActionButton type="button" variant="secondary" onClick={onClose}>Cancelar</ActionButton><ActionButton type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</ActionButton></div>
      </form>
    </Modal>
  );
}
