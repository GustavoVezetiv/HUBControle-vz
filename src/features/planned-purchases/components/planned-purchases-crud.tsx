"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { archivePlannedPurchase, createPlannedPurchase, listPlannedPurchases, listPlannedPurchaseSupportData, updatePlannedPurchase } from "@/features/planned-purchases/queries";
import { decisionStatusOptions, emptyPlannedPurchaseForm, plannedPurchaseToFormValues, type PlannedPurchaseFormValues, type PlannedPurchaseRow, type PlannedPurchaseSupportData } from "@/features/planned-purchases/types";
import { ActionButton, BulkActionsBar, CategoryBadge, CategorySelect, CrudFeedback, FieldShell, inputClassName, Modal, QuickEditInput, QuickEditSelect, RowSelectionHint, shouldToggleRowSelection, TextBadge, TitleButton, ViewPreferenceActions } from "@/features/shared/crud-ui";
import { formatCurrency, formatDate } from "@/features/shared/format";
import { optionLabel, paymentMethodOptions, priorityOptions } from "@/features/shared/options";
import { getQuickTableEditPreference } from "@/features/shared/quick-edit";
import type { FeedbackState } from "@/features/shared/types";
import { clearViewPreference, loadViewPreference, preferenceString, preferenceText, saveViewPreference } from "@/features/shared/view-preferences";
import { createClient } from "@/lib/supabase/client";

type ModalState = { mode: "create"; item: null } | { mode: "edit"; item: PlannedPurchaseRow } | null;
type ViewMode = "list" | "kanban";
type KanbanGroupMode = "decision_status" | "category" | "risk_level" | "project";
type PurchaseStateFilter = "all" | "purchased" | "pending";
type KanbanColumn = {
  value: string;
  label: string;
  items: PlannedPurchaseRow[];
};
type PlannedPurchasesViewPreference = {
  search?: string;
  statusFilter?: string;
  priorityFilter?: string;
  categoryFilter?: string;
  projectFilter?: string;
  purchaseStateFilter?: PurchaseStateFilter;
  viewMode?: ViewMode;
  kanbanGroup?: KanbanGroupMode;
};

const purchaseViewModeOptions = ["list", "kanban"] as const;
const purchaseKanbanGroupOptions = ["decision_status", "category", "risk_level", "project"] as const;
const purchaseStateFilterOptions = ["all", "purchased", "pending"] as const;
const purchasesDefaultViewPreference: Required<PlannedPurchasesViewPreference> = {
  search: "",
  statusFilter: "all",
  priorityFilter: "all",
  categoryFilter: "all",
  projectFilter: "all",
  purchaseStateFilter: "all",
  viewMode: "list",
  kanbanGroup: "decision_status",
};

export function PlannedPurchasesCrud() {
  const [items, setItems] = useState<PlannedPurchaseRow[]>([]);
  const [support, setSupport] = useState<PlannedPurchaseSupportData>({ categories: [] });
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [purchaseStateFilter, setPurchaseStateFilter] = useState<PurchaseStateFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [kanbanGroup, setKanbanGroup] = useState<KanbanGroupMode>("decision_status");
  const [modal, setModal] = useState<ModalState>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [allowQuickTableEdit, setAllowQuickTableEdit] = useState(false);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [bulkRisk, setBulkRisk] = useState("");

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

  useEffect(() => {
    if (!userId) return;
    const preference = loadViewPreference<PlannedPurchasesViewPreference>("purchases", userId);
    if (!preference) return;

    setSearch(preferenceText(preference.search));
    setStatusFilter(preferenceText(preference.statusFilter, "all"));
    setPriorityFilter(preferenceText(preference.priorityFilter, "all"));
    setCategoryFilter(preferenceText(preference.categoryFilter, "all"));
    setProjectFilter(preferenceText(preference.projectFilter, "all"));
    setPurchaseStateFilter(preferenceString(preference.purchaseStateFilter, purchaseStateFilterOptions, "all"));
    setViewMode(preferenceString(preference.viewMode, purchaseViewModeOptions, "list"));
    setKanbanGroup(preferenceString(preference.kanbanGroup, purchaseKanbanGroupOptions, "decision_status"));
  }, [userId]);

  function handleSaveViewPreference() {
    const saved = saveViewPreference("purchases", userId, {
      search,
      statusFilter,
      priorityFilter,
      categoryFilter,
      projectFilter,
      purchaseStateFilter,
      viewMode,
      kanbanGroup,
    });
    setFeedback({
      type: saved ? "success" : "error",
      message: saved ? "Visualização padrão de compras salva." : "Não foi possível salvar a visualização padrão.",
    });
  }

  function handleRestoreViewPreference() {
    clearViewPreference("purchases", userId);
    setSearch(purchasesDefaultViewPreference.search);
    setStatusFilter(purchasesDefaultViewPreference.statusFilter);
    setPriorityFilter(purchasesDefaultViewPreference.priorityFilter);
    setCategoryFilter(purchasesDefaultViewPreference.categoryFilter);
    setProjectFilter(purchasesDefaultViewPreference.projectFilter);
    setPurchaseStateFilter(purchasesDefaultViewPreference.purchaseStateFilter);
    setViewMode(purchasesDefaultViewPreference.viewMode);
    setKanbanGroup(purchasesDefaultViewPreference.kanbanGroup);
    setFeedback({ type: "success", message: "Visualização padrão de compras restaurada." });
  }

  const projectOptions = useMemo(() => {
    return Array.from(new Set(items.map((item) => item.project?.trim()).filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b));
  }, [items]);
  const purchaseCategories = useMemo(() => support.categories.filter(isPurchaseCategory), [support.categories]);

  useEffect(() => {
    if (categoryFilter === "all") return;
    if (!purchaseCategories.some((category) => category.id === categoryFilter)) {
      setCategoryFilter("all");
    }
  }, [categoryFilter, purchaseCategories]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      const category = support.categories.find((categoryItem) => categoryItem.id === item.category_id);
      const matchesSearch =
        !term ||
        [item.title, item.description, item.notes, item.project, category?.name].some((value) => value?.toLowerCase().includes(term));
      const matchesStatus = statusFilter === "all" || item.decision_status === statusFilter;
      const matchesPriority = priorityFilter === "all" || item.risk_level === priorityFilter;
      const matchesCategory = categoryFilter === "all" || item.category_id === categoryFilter;
      const matchesProject = projectFilter === "all" || item.project === projectFilter;
      const matchesPurchaseState =
        purchaseStateFilter === "all" ||
        (purchaseStateFilter === "purchased" && Boolean(item.purchase_date)) ||
        (purchaseStateFilter === "pending" && !item.purchase_date);

      return matchesSearch && matchesStatus && matchesPriority && matchesCategory && matchesProject && matchesPurchaseState;
    });
  }, [categoryFilter, items, priorityFilter, projectFilter, purchaseStateFilter, search, statusFilter, support.categories]);

  const summary = useMemo(() => {
    const purchased = filtered.filter((item) => Boolean(item.purchase_date));
    const pending = filtered.filter((item) => !item.purchase_date && item.decision_status !== "canceled");
    const totalEstimated = filtered.reduce((sum, item) => sum + Number(item.estimated_amount || 0), 0);
    const totalPaid = purchased.reduce((sum, item) => sum + Number(item.paid_amount || 0), 0);
    const difference = totalEstimated - totalPaid;

    return {
      totalEstimated,
      totalPaid,
      difference,
      purchasedCount: purchased.length,
      pendingCount: pending.length,
    };
  }, [filtered]);

  const kanbanColumns = useMemo(
    () => buildKanbanColumns(filtered, support.categories, purchaseCategories, kanbanGroup),
    [filtered, kanbanGroup, purchaseCategories, support.categories],
  );

  async function handleSubmit(values: PlannedPurchaseFormValues) {
    if (!values.title.trim()) {
      setFeedback({ type: "error", message: "Informe o nome da compra ou desejo." });
      return;
    }
    if (Number(values.estimated_amount) < 0 || Number(values.paid_amount) < 0) {
      setFeedback({ type: "error", message: "Valores devem ser maiores ou iguais a zero." });
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

    const preparedValues = preparePurchaseStatusValues(values);
    if (!preparedValues) return;

    setSaving(true);
    try {
      const client = createClient();
      const result = modal?.mode === "edit"
        ? await updatePlannedPurchase(client, modal.item.id, preparedValues)
        : await createPlannedPurchase(client, userId, preparedValues);

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
    if (!userId) return;
    if (!window.confirm("Arquivar esta compra planejada?")) return;
    const { error } = await archivePlannedPurchase(createClient(), item.id, userId);
    if (error) {
      console.error("Erro técnico ao arquivar compra planejada:", error);
      setFeedback({ type: "error", message: error.message });
    } else {
      setFeedback({ type: "success", message: "Compra arquivada." });
      await loadData();
    }
  }

  async function handleQuickUpdate(item: PlannedPurchaseRow, patch: Partial<PlannedPurchaseFormValues>) {
    setFeedback(null);

    try {
      const nextValues = preparePurchaseStatusValues({
        ...plannedPurchaseToFormValues(item),
        ...patch,
      });
      if (!nextValues) return;

      const result = await updatePlannedPurchase(createClient(), item.id, {
        ...nextValues,
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

    if (!userId) return;
    if (!window.confirm(`Arquivar ${ids.length} compra(s) selecionada(s)?`)) {
      return;
    }

    setDeletingSelected(true);
    setFeedback(null);

    try {
      const client = createClient();
      const results = await Promise.all(ids.map((id) => archivePlannedPurchase(client, id, userId)));
      const failed = results.find((result) => result.error);

      if (failed?.error) {
        console.error("Erro técnico ao arquivar compras selecionadas:", failed.error);
        setFeedback({ type: "error", message: "Não foi possível arquivar todos os itens selecionados." });
        return;
      }

      setSelectedIds(new Set());
      setFeedback({ type: "success", message: `${ids.length} compra(s) arquivada(s).` });
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao arquivar compras selecionadas:", error);
      setFeedback({ type: "error", message: "Não foi possível arquivar os itens selecionados." });
    } finally {
      setDeletingSelected(false);
    }
  }

  async function handleBulkUpdate(
    label: string,
    getPatch: (item: PlannedPurchaseRow) => Partial<PlannedPurchaseFormValues>,
  ) {
    const selected = items.filter((item) => selectedIds.has(item.id));
    if (selected.length === 0) return;
    if (!window.confirm(`${label} em ${selected.length} compra(s) selecionada(s)?`)) return;

    setBulkUpdating(true);
    setFeedback(null);

    try {
      const client = createClient();
      const results = await Promise.all(
        selected.map((item) =>
          updatePlannedPurchase(client, item.id, {
            ...plannedPurchaseToFormValues(item),
            ...getPatch(item),
          }),
        ),
      );
      const failed = results.find((result) => result.error);

      if (failed?.error) {
        console.error("Erro técnico ao alterar compras em lote:", failed.error);
        setFeedback({ type: "error", message: "Não foi possível alterar todas as compras selecionadas." });
        return;
      }

      setSelectedIds(new Set());
      setBulkStatus("");
      setBulkCategoryId("");
      setBulkRisk("");
      setFeedback({ type: "success", message: `${selected.length} compra(s) atualizada(s).` });
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao alterar compras em lote:", error);
      setFeedback({ type: "error", message: "Não foi possível alterar as compras selecionadas." });
    } finally {
      setBulkUpdating(false);
    }
  }

  async function handleKanbanDrop(itemId: string, columnValue: string) {
    const item = items.find((current) => current.id === itemId);
    if (!item) return;

    if (kanbanGroup === "category" && columnValue === "out_of_scope_category") {
      setFeedback({ type: "error", message: "Categoria fora do escopo é apenas visual. Edite a compra para escolher uma categoria válida." });
      return;
    }

    const patch: Partial<PlannedPurchaseFormValues> =
      kanbanGroup === "decision_status"
        ? { decision_status: columnValue }
        : kanbanGroup === "risk_level"
          ? { risk_level: columnValue as PlannedPurchaseFormValues["risk_level"] }
          : kanbanGroup === "category"
            ? { category_id: columnValue === "no_category" ? "" : columnValue }
            : { project: columnValue === "no_project" ? "" : columnValue };

    await handleQuickUpdate(item, patch);
    setFeedback({ type: "success", message: "Compra atualizada pelo kanban." });
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

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Total estimado" value={formatCurrency(summary.totalEstimated)} helper="Itens filtrados." tone="info" />
        <StatCard label="Total pago" value={formatCurrency(summary.totalPaid)} helper="Somente itens com data de compra." tone="success" />
        <StatCard
          label={summary.difference >= 0 ? "Economia" : "Estouro"}
          value={formatCurrency(Math.abs(summary.difference))}
          helper={summary.difference >= 0 ? "Estimado menos pago." : "Pago acima do estimado."}
          tone={summary.difference >= 0 ? "success" : "danger"}
        />
        <StatCard label="Comprados" value={String(summary.purchasedCount)} helper="Com data de compra." tone="success" />
        <StatCard label="Pendentes" value={String(summary.pendingCount)} helper="Sem data de compra." tone="warning" />
      </section>

      <SectionCard title="Visualização e filtros" description="A data de compra define se o item foi comprado; data alvo é apenas planejamento.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <FieldShell label="Visualização">
            <select className={inputClassName} value={viewMode} onChange={(event) => setViewMode(event.target.value as ViewMode)}>
              <option value="list">Lista</option>
              <option value="kanban">Kanban</option>
            </select>
          </FieldShell>
          <FieldShell label="Colunas do kanban">
            <select className={inputClassName} value={kanbanGroup} onChange={(event) => setKanbanGroup(event.target.value as KanbanGroupMode)}>
              <option value="decision_status">Status</option>
              <option value="category">Categoria</option>
              <option value="risk_level">Prioridade</option>
              <option value="project">Projeto</option>
            </select>
          </FieldShell>
          <input value={search} onChange={(event) => setSearch(event.target.value)} className={inputClassName} placeholder="Buscar por nome ou descrição" />
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={inputClassName}>
            <option value="all">Todos os status</option>
            {decisionStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} className={inputClassName}>
            <option value="all">Todas prioridades</option>
            {priorityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className={inputClassName}>
            <option value="all">Todas categorias</option>
            {purchaseCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
          <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className={inputClassName}>
            <option value="all">Todos projetos</option>
            {projectOptions.map((project) => <option key={project} value={project}>{project}</option>)}
          </select>
          <select value={purchaseStateFilter} onChange={(event) => setPurchaseStateFilter(event.target.value as PurchaseStateFilter)} className={inputClassName}>
            <option value="all">Comprados e pendentes</option>
            <option value="purchased">Comprados</option>
            <option value="pending">Pendentes</option>
          </select>
        </div>
        <p className="mt-3 text-sm text-ink-600 dark:text-slate-300">Mostrando {filtered.length} de {items.length} item(ns).</p>
        <div className="mt-4">
          <ViewPreferenceActions onSave={handleSaveViewPreference} onRestore={handleRestoreViewPreference} />
        </div>
      </SectionCard>

      <SectionCard title="Compras cadastradas" description="Compras planejadas não são contas ainda, mas podem virar pressão no caixa.">
        {loading ? (
          <p className="text-sm text-ink-600">Carregando compras...</p>
        ) : filtered.length === 0 ? (
          <EmptyState title="Nenhuma compra encontrada" description="Ajuste os filtros para ver outras compras planejadas." />
        ) : viewMode === "kanban" ? (
          <PurchasesKanban
            categories={support.categories}
            columns={kanbanColumns}
            onDrop={(itemId, columnValue) => void handleKanbanDrop(itemId, columnValue)}
            onEdit={(item) => setModal({ mode: "edit", item })}
          />
        ) : (
          <>
          <BulkActionsBar
            selectedCount={selectedIds.size}
            deleting={deletingSelected || bulkUpdating}
            onClear={() => setSelectedIds(new Set())}
            onDelete={() => void handleBulkDelete()}
          >
            <select className={inputClassName} value={bulkStatus} disabled={deletingSelected || bulkUpdating} onChange={(event) => setBulkStatus(event.target.value)}>
              <option value="">Status</option>
              {decisionStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <ActionButton type="button" variant="secondary" disabled={!bulkStatus || deletingSelected || bulkUpdating} onClick={() => void handleBulkUpdate("Alterar status", () => ({ decision_status: bulkStatus }))}>
              Alterar status
            </ActionButton>
            <select className={inputClassName} value={bulkCategoryId} disabled={deletingSelected || bulkUpdating} onChange={(event) => setBulkCategoryId(event.target.value)}>
              <option value="">Categoria</option>
              <option value="__none">Sem categoria</option>
              {purchaseCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <ActionButton type="button" variant="secondary" disabled={!bulkCategoryId || deletingSelected || bulkUpdating} onClick={() => void handleBulkUpdate("Alterar categoria", () => ({ category_id: bulkCategoryId === "__none" ? "" : bulkCategoryId }))}>
              Alterar categoria
            </ActionButton>
            <select className={inputClassName} value={bulkRisk} disabled={deletingSelected || bulkUpdating} onChange={(event) => setBulkRisk(event.target.value)}>
              <option value="">Prioridade</option>
              {priorityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <ActionButton type="button" variant="secondary" disabled={!bulkRisk || deletingSelected || bulkUpdating} onClick={() => void handleBulkUpdate("Alterar prioridade", () => ({ risk_level: bulkRisk as PlannedPurchaseFormValues["risk_level"] }))}>
              Alterar prioridade
            </ActionButton>
          </BulkActionsBar>
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
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3">Categoria</th>
                  <th className="px-4 py-3">Projeto</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Prioridade</th>
                  <th className="px-4 py-3">Valor estimado</th>
                  <th className="px-4 py-3">Valor pago</th>
                  <th className="px-4 py-3">Diferença</th>
                  <th className="px-4 py-3">Data compra</th>
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
                    <td className="px-4 py-3">
                      {allowQuickTableEdit ? (
                        <QuickEditSelect value={item.category_id ?? ""} options={buildPurchaseCategoryOptions(support.categories, purchaseCategories, item.category_id)} onCommit={(value) => void handleQuickUpdate(item, { category_id: value })} />
                      ) : (
                        <PurchaseCategoryBadge categories={support.categories} item={item} />
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {allowQuickTableEdit ? (
                        <QuickEditInput value={item.project ?? ""} onCommit={(value) => void handleQuickUpdate(item, { project: value })} />
                      ) : item.project || "-"}
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
                    <td className="px-4 py-3 text-ink-950 dark:text-slate-100">
                      {allowQuickTableEdit ? (
                        <QuickEditInput type="number" value={String(item.estimated_amount)} onCommit={(value) => void handleQuickUpdate(item, { estimated_amount: value })} />
                      ) : formatCurrency(Number(item.estimated_amount))}
                    </td>
                    <td className="px-4 py-3 text-ink-950 dark:text-slate-100">
                      {allowQuickTableEdit ? (
                        <QuickEditInput type="number" value={String(item.paid_amount ?? 0)} onCommit={(value) => void handleQuickUpdate(item, { paid_amount: value })} />
                      ) : formatCurrency(Number(item.paid_amount ?? 0))}
                    </td>
                    <td className="px-4 py-3">
                      <TextBadge tone={getPurchaseDifference(item) >= 0 ? "success" : "danger"}>
                        {getPurchaseDifference(item) >= 0 ? "Economia " : "Estouro "}
                        {formatCurrency(Math.abs(getPurchaseDifference(item)))}
                      </TextBadge>
                    </td>
                    <td className="px-4 py-3 text-ink-600 dark:text-slate-300">
                      {allowQuickTableEdit ? (
                        <QuickEditInput type="date" value={item.purchase_date ?? ""} onCommit={(value) => void handleQuickUpdate(item, { purchase_date: value })} />
                      ) : item.purchase_date ? formatDate(item.purchase_date) : "Pendente"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <ActionButton variant="secondary" onClick={() => setModal({ mode: "edit", item })}>Editar</ActionButton>
                        <ActionButton variant="danger" onClick={() => void handleDelete(item)}>Arquivar</ActionButton>
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

      {modal ? <PlannedPurchaseModal modal={modal} saving={saving} support={support} purchaseCategories={purchaseCategories} onClose={() => setModal(null)} onSubmit={(values) => void handleSubmit(values)} /> : null}
    </div>
  );
}

function PurchasesKanban({
  categories,
  columns,
  onDrop,
  onEdit,
}: {
  categories: PlannedPurchaseSupportData["categories"];
  columns: KanbanColumn[];
  onDrop: (itemId: string, columnValue: string) => void;
  onEdit: (item: PlannedPurchaseRow) => void;
}) {
  return (
    <div className="overflow-x-auto pb-2">
      <div className="grid min-w-[980px] auto-cols-fr grid-flow-col gap-4">
        {columns.map((column) => (
          <section
            key={column.value}
            className="flex min-h-96 flex-col rounded-lg border border-slate-300 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950/55"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              const itemId = event.dataTransfer.getData("text/plain");
              if (itemId) onDrop(itemId, column.value);
            }}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink-950 dark:text-slate-100">{column.label}</h3>
                <p className="mt-1 text-xs text-ink-600 dark:text-slate-300">{column.items.length} item(ns)</p>
              </div>
            </div>
            <div className="flex flex-1 flex-col gap-3">
              {column.items.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-300 bg-white/70 px-3 py-8 text-center text-sm text-ink-600 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300">
                  Nenhuma compra
                </div>
              ) : (
                column.items.map((item) => (
                  <PurchaseKanbanCard key={item.id} categories={categories} item={item} onEdit={onEdit} />
                ))
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function PurchaseKanbanCard({
  categories,
  item,
  onEdit,
}: {
  categories: PlannedPurchaseSupportData["categories"];
  item: PlannedPurchaseRow;
  onEdit: (item: PlannedPurchaseRow) => void;
}) {
  const difference = getPurchaseDifference(item);

  return (
    <article
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", item.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      className="rounded-lg border border-slate-300 bg-white p-4 text-ink-950 shadow-sm transition hover:border-mint-500 hover:shadow-md dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
    >
      <div className="flex items-start justify-between gap-3">
        <button type="button" className="text-left text-sm font-semibold text-ink-950 hover:text-mint-700 dark:text-slate-100 dark:hover:text-mint-200" onClick={() => onEdit(item)}>
          {item.title}
        </button>
        <TextBadge tone={item.purchase_date ? "success" : "warning"}>{item.purchase_date ? "Comprado" : "Pendente"}</TextBadge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <CategoryBadge category={categories.find((category) => category.id === item.category_id)} />
        {isOutOfScopePurchaseCategory(categories.find((category) => category.id === item.category_id)) ? (
          <TextBadge tone="warning">Categoria fora do escopo de compras</TextBadge>
        ) : null}
        <TextBadge tone={item.risk_level === "critical" || item.risk_level === "high" ? "danger" : "neutral"}>
          {optionLabel(priorityOptions, item.risk_level)}
        </TextBadge>
        <TextBadge tone={item.decision_status === "purchased" ? "success" : item.decision_status === "approved" ? "info" : "neutral"}>
          {optionLabel(decisionStatusOptions, item.decision_status)}
        </TextBadge>
      </div>
      <div className="mt-4 grid gap-1 text-sm text-ink-700 dark:text-slate-300">
        <p>Estimado: <strong className="text-ink-950 dark:text-slate-100">{formatCurrency(Number(item.estimated_amount || 0))}</strong></p>
        <p>Pago: <strong className="text-ink-950 dark:text-slate-100">{formatCurrency(Number(item.paid_amount || 0))}</strong></p>
        <p>{difference >= 0 ? "Economia" : "Estouro"}: <strong className={difference >= 0 ? "text-mint-700 dark:text-mint-200" : "text-danger-600 dark:text-red-300"}>{formatCurrency(Math.abs(difference))}</strong></p>
        <p>Projeto: <strong className="text-ink-950 dark:text-slate-100">{item.project || "-"}</strong></p>
        <p>Data compra: <strong className="text-ink-950 dark:text-slate-100">{item.purchase_date ? formatDate(item.purchase_date) : "Pendente"}</strong></p>
      </div>
    </article>
  );
}

function PurchaseCategoryBadge({
  categories,
  item,
}: {
  categories: PlannedPurchaseSupportData["categories"];
  item: PlannedPurchaseRow;
}) {
  const category = categories.find((currentCategory) => currentCategory.id === item.category_id);
  const outOfScope = isOutOfScopePurchaseCategory(category);

  return (
    <div className="flex flex-wrap gap-2">
      <CategoryBadge category={category} />
      {outOfScope ? <TextBadge tone="warning">Categoria fora do escopo de compras</TextBadge> : null}
    </div>
  );
}

function PlannedPurchaseModal({
  modal,
  saving,
  support,
  purchaseCategories,
  onClose,
  onSubmit,
}: {
  modal: ModalState;
  saving: boolean;
  support: PlannedPurchaseSupportData;
  purchaseCategories: PlannedPurchaseSupportData["categories"];
  onClose: () => void;
  onSubmit: (values: PlannedPurchaseFormValues) => void;
}) {
  const [values, setValues] = useState<PlannedPurchaseFormValues>(modal?.mode === "edit" ? plannedPurchaseToFormValues(modal.item) : emptyPlannedPurchaseForm);
  const selectedCategory = support.categories.find((category) => category.id === values.category_id);
  const selectedCategoryOutOfScope = isOutOfScopePurchaseCategory(selectedCategory);

  return (
    <Modal title={modal?.mode === "edit" ? "Editar compra" : "Nova compra"} description="Use para simular desejos antes que virem gasto real." onClose={onClose}>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); onSubmit(values); }}>
        <div className="md:col-span-2"><FieldShell label="Nome"><input required className={inputClassName} value={values.title} onChange={(event) => setValues({ ...values, title: event.target.value })} /></FieldShell></div>
        <div className="md:col-span-2"><FieldShell label="Descrição"><textarea rows={3} className={inputClassName} value={values.description} onChange={(event) => setValues({ ...values, description: event.target.value })} /></FieldShell></div>
        <FieldShell label="Valor estimado"><input min="0" step="0.01" type="number" className={inputClassName} value={values.estimated_amount} onChange={(event) => setValues({ ...values, estimated_amount: event.target.value })} /></FieldShell>
        <FieldShell label="Valor pago"><input min="0" step="0.01" type="number" className={inputClassName} value={values.paid_amount} onChange={(event) => setValues({ ...values, paid_amount: event.target.value })} /></FieldShell>
        <FieldShell label="Data da compra"><input type="date" className={inputClassName} value={values.purchase_date} onChange={(event) => setValues({ ...values, purchase_date: event.target.value })} /></FieldShell>
        <FieldShell label="Data alvo opcional"><input type="date" className={inputClassName} value={values.target_date} onChange={(event) => setValues({ ...values, target_date: event.target.value })} /></FieldShell>
        <FieldShell label="Categoria">
          <CategorySelect categories={purchaseCategories} value={selectedCategoryOutOfScope ? "" : values.category_id} onChange={(category_id) => setValues({ ...values, category_id })} />
          {selectedCategoryOutOfScope ? (
            <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-400/30 dark:bg-amber-950/35 dark:text-amber-100">
              Categoria atual: <strong>{selectedCategory?.name}</strong>. Categoria fora do escopo de compras.
            </div>
          ) : null}
        </FieldShell>
        <FieldShell label="Projeto"><input className={inputClassName} value={values.project} onChange={(event) => setValues({ ...values, project: event.target.value })} /></FieldShell>
        <FieldShell label="Forma planejada"><select className={inputClassName} value={values.payment_method} onChange={(event) => setValues({ ...values, payment_method: event.target.value })}>{paymentMethodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></FieldShell>
        <FieldShell label="Parcelas"><input min="1" type="number" className={inputClassName} value={values.installment_count} onChange={(event) => setValues({ ...values, installment_count: event.target.value })} /></FieldShell>
        <FieldShell label="Status"><select className={inputClassName} value={values.decision_status} onChange={(event) => setValues({ ...values, decision_status: event.target.value })}>{decisionStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></FieldShell>
        <FieldShell label="Prioridade"><select className={inputClassName} value={values.risk_level} onChange={(event) => setValues({ ...values, risk_level: event.target.value as PlannedPurchaseFormValues["risk_level"] })}>{priorityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></FieldShell>
        <div className="md:col-span-2"><FieldShell label="Notas"><textarea rows={3} className={inputClassName} value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} /></FieldShell></div>
        <div className="flex justify-end gap-2 md:col-span-2"><ActionButton type="button" variant="secondary" onClick={onClose}>Cancelar</ActionButton><ActionButton type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</ActionButton></div>
      </form>
    </Modal>
  );
}

function buildKanbanColumns(
  items: PlannedPurchaseRow[],
  categories: PlannedPurchaseSupportData["categories"],
  purchaseCategories: PlannedPurchaseSupportData["categories"],
  groupMode: KanbanGroupMode,
): KanbanColumn[] {
  const definitions = getKanbanColumnDefinitions(items, categories, purchaseCategories, groupMode);

  return definitions.map((definition) => ({
    ...definition,
    items: items.filter((item) => getKanbanValue(item, categories, groupMode) === definition.value),
  }));
}

function getKanbanColumnDefinitions(
  items: PlannedPurchaseRow[],
  categories: PlannedPurchaseSupportData["categories"],
  purchaseCategories: PlannedPurchaseSupportData["categories"],
  groupMode: KanbanGroupMode,
) {
  if (groupMode === "decision_status") return decisionStatusOptions;
  if (groupMode === "risk_level") return priorityOptions;
  if (groupMode === "category") {
    const usedCategoryIds = new Set(items.map((item) => item.category_id).filter((id): id is string => Boolean(id)));
    const hasOutOfScope = items.some((item) => isOutOfScopePurchaseCategory(categories.find((category) => category.id === item.category_id)));
    return [
      ...purchaseCategories.filter((category) => usedCategoryIds.has(category.id)).map((category) => ({ value: category.id, label: category.name })),
      ...(hasOutOfScope ? [{ value: "out_of_scope_category", label: "Categoria fora do escopo" }] : []),
      { value: "no_category", label: "Sem categoria" },
    ];
  }

  const projects = Array.from(new Set(items.map((item) => item.project?.trim()).filter((project): project is string => Boolean(project)))).sort((a, b) => a.localeCompare(b));
  return [
    ...projects.map((project) => ({ value: project, label: project })),
    { value: "no_project", label: "Sem projeto" },
  ];
}

function getKanbanValue(
  item: PlannedPurchaseRow,
  categories: PlannedPurchaseSupportData["categories"],
  groupMode: KanbanGroupMode,
) {
  if (groupMode === "decision_status") return item.decision_status;
  if (groupMode === "risk_level") return item.risk_level;
  if (groupMode === "category") {
    const category = categories.find((currentCategory) => currentCategory.id === item.category_id);
    if (isOutOfScopePurchaseCategory(category)) return "out_of_scope_category";
    return item.category_id ?? "no_category";
  }
  return item.project?.trim() || "no_project";
}

function preparePurchaseStatusValues(values: PlannedPurchaseFormValues) {
  const nextValues = { ...values };
  const today = new Date().toISOString().slice(0, 10);

  if (nextValues.decision_status === "purchased" && !nextValues.purchase_date) {
    if (!window.confirm("Você marcou como comprado sem data da compra. Preencher com a data de hoje?")) {
      return null;
    }
    nextValues.purchase_date = today;
  }

  if (nextValues.purchase_date && nextValues.decision_status !== "purchased") {
    if (window.confirm("Há data de compra preenchida. Alterar status para Comprada?")) {
      nextValues.decision_status = "purchased";
    }
  }

  return nextValues;
}

function getPurchaseDifference(item: PlannedPurchaseRow) {
  return Number(item.estimated_amount || 0) - Number(item.paid_amount || 0);
}

function buildPurchaseCategoryOptions(
  categories: PlannedPurchaseSupportData["categories"],
  purchaseCategories: PlannedPurchaseSupportData["categories"],
  currentCategoryId: string | null,
) {
  const currentCategory = categories.find((category) => category.id === currentCategoryId);

  return [
    { value: "", label: "Sem categoria" },
    ...(isOutOfScopePurchaseCategory(currentCategory)
      ? [{ value: currentCategory?.id ?? "", label: `${currentCategory?.name ?? "Categoria atual"} (fora do escopo)` }]
      : []),
    ...purchaseCategories.map((category) => ({ value: category.id, label: category.name })),
  ];
}

function isPurchaseCategory(category: PlannedPurchaseSupportData["categories"][number]) {
  return ["purchase", "planned_purchase", "wishlist", "shopping"].includes(category.type);
}

function isOutOfScopePurchaseCategory(category: PlannedPurchaseSupportData["categories"][number] | undefined) {
  return category ? !isPurchaseCategory(category) : false;
}
