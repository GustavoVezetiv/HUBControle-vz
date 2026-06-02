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
import {
  confidenceOptions,
  incomeStatusOptions,
  incomeTypeOptions,
  optionLabel,
} from "@/features/shared/options";
import { PeriodFilter } from "@/features/shared/period-filter";
import { createDefaultPeriodValue, isAnyDateInPeriod } from "@/features/shared/period";
import { getQuickTableEditPreference } from "@/features/shared/quick-edit";
import type { FeedbackState } from "@/features/shared/types";
import {
  createIncomeSource,
  deleteIncomeSource,
  listIncomeSources,
  listIncomeSupportData,
  updateIncomeSource,
} from "@/features/income-sources/queries";
import {
  emptyIncomeForm,
  incomeToFormValues,
  type IncomeCategory,
  type IncomePerson,
  type IncomeSourceFormValues,
  type IncomeSourceRow,
} from "@/features/income-sources/types";
import { createClient } from "@/lib/supabase/client";

type ModalState =
  | { mode: "create"; income: null }
  | { mode: "edit"; income: IncomeSourceRow }
  | null;

export function IncomeSourcesCrud() {
  const [incomeSources, setIncomeSources] = useState<IncomeSourceRow[]>([]);
  const [categories, setCategories] = useState<IncomeCategory[]>([]);
  const [people, setPeople] = useState<IncomePerson[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [confidenceFilter, setConfidenceFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [period, setPeriod] = useState(createDefaultPeriodValue());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [allowQuickTableEdit, setAllowQuickTableEdit] = useState(false);

  const periodIncome = useMemo(() => {
    return incomeSources.filter((income) =>
      isAnyDateInPeriod([income.expected_date, income.received_date], period),
    );
  }, [incomeSources, period]);

  const filteredIncome = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return periodIncome.filter((income) => {
      const matchesSearch =
        !needle ||
        income.name.toLowerCase().includes(needle) ||
        (income.description ?? "").toLowerCase().includes(needle);
      const matchesStatus = statusFilter === "all" || income.status === statusFilter;
      const matchesType = typeFilter === "all" || income.source_type === typeFilter;
      const matchesConfidence = confidenceFilter === "all" || income.confidence === confidenceFilter;
      const matchesCategory = categoryFilter === "all" || income.category_id === categoryFilter;

      return (
        matchesSearch &&
        matchesStatus &&
        matchesType &&
        matchesConfidence &&
        matchesCategory
      );
    });
  }, [
    categoryFilter,
    confidenceFilter,
    periodIncome,
    search,
    statusFilter,
    typeFilter,
  ]);

  const summary = useMemo(() => {
    return periodIncome.reduce(
      (acc, income) => {
        const amount = Number(income.amount);

        if (income.status === "expected") {
          acc.expected += amount;
        }

        if (income.status === "received") {
          acc.received += amount;
        }

        if (income.inflow_kind === "reimbursement" && income.status === "expected") {
          acc.reimbursement += amount;
        }

        if (income.inflow_kind === "third_party_money" && income.status === "expected") {
          acc.thirdParty += amount;
        }

        if (income.confidence === "low" || income.confidence === "uncertain") {
          acc.lowConfidence += amount;
        }

        return acc;
      },
      { expected: 0, received: 0, reimbursement: 0, thirdParty: 0, lowConfidence: 0 },
    );
  }, [periodIncome]);

  async function loadIncomeSources() {
    setLoading(true);
    setFeedback(null);

    try {
      const client = createClient();
      const {
        data: { user },
        error: userError,
      } = await client.auth.getUser();

      if (userError || !user) {
        setFeedback({ type: "error", message: "Sessão não encontrada. Entre novamente." });
        return;
      }

      setUserId(user.id);

      const [incomeResult, support, quickEdit] = await Promise.all([
        listIncomeSources(client),
        listIncomeSupportData(client),
        getQuickTableEditPreference(client, user.id),
      ]);

      if (incomeResult.error) {
        setFeedback({ type: "error", message: incomeResult.error.message });
        return;
      }

      if (support.categories.error) {
        setFeedback({ type: "error", message: support.categories.error.message });
        return;
      }

      if (support.people.error) {
        setFeedback({ type: "error", message: support.people.error.message });
        return;
      }

      setIncomeSources(incomeResult.data ?? []);
      setCategories(support.categories.data ?? []);
      setPeople(support.people.data ?? []);
      setAllowQuickTableEdit(quickEdit);
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Erro ao carregar receitas.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadIncomeSources();
  }, []);

  async function handleSubmit(values: IncomeSourceFormValues) {
    const amount = Number(values.amount);

    if (!values.source.trim()) {
      setFeedback({ type: "error", message: "Informe a fonte da entrada." });
      return;
    }

    if (Number.isNaN(amount) || amount < 0) {
      setFeedback({ type: "error", message: "O valor deve ser maior ou igual a zero." });
      return;
    }

    if (!values.expected_date) {
      setFeedback({ type: "error", message: "Informe a data prevista." });
      return;
    }

    if (!userId) {
      setFeedback({ type: "error", message: "Sessão não encontrada. Entre novamente." });
      return;
    }

    setSaving(true);
    setFeedback(null);

    try {
      const client = createClient();
      const result =
        modal?.mode === "edit"
          ? await updateIncomeSource(client, modal.income.id, values)
          : await createIncomeSource(client, userId, values);

      if (result.error) {
        setFeedback({ type: "error", message: result.error.message });
        return;
      }

      setFeedback({
        type: "success",
        message: modal?.mode === "edit" ? "Receita atualizada." : "Receita criada.",
      });
      setModal(null);
      await loadIncomeSources();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(income: IncomeSourceRow) {
    if (!window.confirm(`Excluir ${income.name}?`)) {
      return;
    }

    const { error } = await deleteIncomeSource(createClient(), income.id);

    if (error) {
      setFeedback({ type: "error", message: error.message });
      return;
    }

    setFeedback({ type: "success", message: "Receita excluída." });
    await loadIncomeSources();
  }

  async function handleQuickUpdate(income: IncomeSourceRow, patch: Partial<IncomeSourceFormValues>) {
    setFeedback(null);

    try {
      const result = await updateIncomeSource(createClient(), income.id, {
        ...incomeToFormValues(income),
        ...patch,
      });

      if (result.error) {
        console.error("Erro técnico ao editar receita rapidamente:", result.error);
        setFeedback({ type: "error", message: "Não foi possível salvar a edição rápida." });
        return;
      }

      await loadIncomeSources();
    } catch (error) {
      console.error("Erro técnico ao editar receita rapidamente:", error);
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
      const results = await Promise.all(ids.map((id) => deleteIncomeSource(client, id)));
      const failed = results.find((result) => result.error);

      if (failed?.error) {
        console.error("Erro técnico ao excluir receitas selecionadas:", failed.error);
        setFeedback({ type: "error", message: "Não foi possível excluir todos os itens selecionados." });
        return;
      }

      setSelectedIds(new Set());
      setFeedback({ type: "success", message: `${ids.length} entrada(s) excluída(s).` });
      await loadIncomeSources();
    } catch (error) {
      console.error("Erro técnico ao excluir receitas selecionadas:", error);
      setFeedback({ type: "error", message: "Não foi possível excluir os itens selecionados." });
    } finally {
      setDeletingSelected(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Entradas"
        title="Receitas"
        description="Cadastre renda real, reembolsos esperados e dinheiro de terceiros sem misturar os conceitos."
        action={<ActionButton onClick={() => setModal({ mode: "create", income: null })}>Nova entrada</ActionButton>}
      />

      <CrudFeedback feedback={feedback} />

      <PeriodFilter value={period} onChange={setPeriod} />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Previsto" value={formatCurrency(summary.expected)} helper="Entradas esperadas." tone="info" />
        <StatCard label="Recebido" value={formatCurrency(summary.received)} helper="Já recebido." tone="success" />
        <StatCard label="Reembolso previsto" value={formatCurrency(summary.reimbursement)} helper="Não é renda livre." tone="warning" />
        <StatCard label="Terceiros previsto" value={formatCurrency(summary.thirdParty)} helper="Dinheiro temporário." tone="warning" />
        <StatCard label="Baixa confiança" value={formatCurrency(summary.lowConfidence)} helper="Baixa ou incerta." tone="danger" />
      </section>

      <SectionCard
        title="Regra financeira"
        description="Reembolso e dinheiro de terceiros ajudam o caixa, mas não são renda livre."
      >
        <p className="text-sm leading-6 text-ink-600">
          Reembolsos devem ser ligados a despesas anteriores em uma etapa futura. Por enquanto,
          eles já ficam separados visualmente da renda real.
        </p>
      </SectionCard>

      <SectionCard title="Filtros" description="Refine por status, tipo, confiança e categoria.">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar" className={inputClassName} />
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={inputClassName}>
            <option value="all">Todos status</option>
            {incomeStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className={inputClassName}>
            <option value="all">Todos tipos</option>
            {incomeTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select value={confidenceFilter} onChange={(event) => setConfidenceFilter(event.target.value)} className={inputClassName}>
            <option value="all">Todas confianças</option>
            {confidenceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className={inputClassName}>
            <option value="all">Todas categorias</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </div>
      </SectionCard>

      <SectionCard title="Entradas cadastradas">
        {loading ? (
          <p className="text-sm text-ink-600">Carregando receitas...</p>
        ) : incomeSources.length === 0 ? (
          <EmptyState title="Nenhuma entrada cadastrada" description="Crie receitas e entradas previstas para projetar o mês." />
        ) : filteredIncome.length === 0 ? (
          <EmptyState title="Nenhuma entrada no período" description="Ajuste o período ou os filtros para ver outras receitas." />
        ) : (
          <>
          <BulkActionsBar
            selectedCount={selectedIds.size}
            deleting={deletingSelected}
            onClear={() => setSelectedIds(new Set())}
            onDelete={() => void handleBulkDelete()}
          />
          <RowSelectionHint />
          <IncomeTable
            incomeSources={filteredIncome}
            categories={categories}
            people={people}
            onEdit={(income) => setModal({ mode: "edit", income })}
            onDelete={(income) => void handleDelete(income)}
            onQuickUpdate={(income, patch) => void handleQuickUpdate(income, patch)}
            allowQuickTableEdit={allowQuickTableEdit}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
          />
          </>
        )}
      </SectionCard>

      {modal ? (
        <IncomeModal
          modal={modal}
          categories={categories}
          people={people}
          saving={saving}
          onSubmit={(values) => void handleSubmit(values)}
          onClose={() => setModal(null)}
        />
      ) : null}
    </div>
  );
}

function IncomeTable({
  incomeSources,
  categories,
  people,
  onEdit,
  onDelete,
  onQuickUpdate,
  allowQuickTableEdit,
  selectedIds,
  onSelectionChange,
}: {
  incomeSources: IncomeSourceRow[];
  categories: IncomeCategory[];
  people: IncomePerson[];
  onEdit: (income: IncomeSourceRow) => void;
  onDelete: (income: IncomeSourceRow) => void;
  onQuickUpdate: (income: IncomeSourceRow, patch: Partial<IncomeSourceFormValues>) => void;
  allowQuickTableEdit: boolean;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
}) {
  const allSelected = incomeSources.length > 0 && incomeSources.every((income) => selectedIds.has(income.id));

  function toggleAll(checked: boolean) {
    if (checked) {
      onSelectionChange(new Set([...selectedIds, ...incomeSources.map((income) => income.id)]));
      return;
    }

    const next = new Set(selectedIds);
    incomeSources.forEach((income) => next.delete(income.id));
    onSelectionChange(next);
  }

  function toggleOne(id: string, checked: boolean) {
    const next = new Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    onSelectionChange(next);
  }

  function handleRowClick(event: React.MouseEvent<HTMLTableRowElement>, id: string) {
    if (!shouldToggleRowSelection(event)) return;
    toggleOne(id, !selectedIds.has(id));
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-ink-950/10 text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-ink-600">
          <tr>
            <th className="px-4 py-3">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(event) => toggleAll(event.target.checked)}
                aria-label="Selecionar todas as receitas filtradas"
              />
            </th>
            <th className="px-4 py-3">Data</th>
            <th className="px-4 py-3">Fonte</th>
            <th className="px-4 py-3">Valor</th>
            <th className="px-4 py-3">Tipo</th>
            <th className="px-4 py-3">Categoria</th>
            <th className="px-4 py-3">Pessoa</th>
            <th className="px-4 py-3">Confiança</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-950/10">
          {incomeSources.map((income) => (
            <tr key={income.id} onClick={(event) => handleRowClick(event, income.id)} className="cursor-default">
              <td className="px-4 py-3">
                <input
                  type="checkbox"
                  checked={selectedIds.has(income.id)}
                  onChange={(event) => toggleOne(income.id, event.target.checked)}
                  aria-label={`Selecionar ${income.name}`}
                />
              </td>
              <td className="px-4 py-3 text-ink-600">
                {allowQuickTableEdit ? (
                  <QuickEditInput type="date" value={income.expected_date ?? ""} onCommit={(value) => onQuickUpdate(income, { expected_date: value })} />
                ) : formatDate(income.expected_date)}
              </td>
              <td className="px-4 py-3">
                {allowQuickTableEdit ? (
                  <QuickEditInput value={income.name} onCommit={(value) => onQuickUpdate(income, { source: value })} />
                ) : (
                  <TitleButton onClick={() => onEdit(income)}>{income.name}</TitleButton>
                )}
                <p className="text-xs text-ink-600">{income.description ?? "-"}</p>
              </td>
              <td className="px-4 py-3 font-medium text-ink-950">
                {allowQuickTableEdit ? (
                  <QuickEditInput type="number" value={String(income.amount)} onCommit={(value) => onQuickUpdate(income, { amount: value })} />
                ) : formatCurrency(Number(income.amount))}
              </td>
              <td className="px-4 py-3">
                <TextBadge tone={income.inflow_kind === "real_income" ? "success" : "warning"}>
                  {optionLabel(incomeTypeOptions, income.source_type)}
                </TextBadge>
              </td>
              <td className="px-4 py-3">
                {allowQuickTableEdit ? (
                  <QuickEditSelect value={income.category_id ?? ""} options={[{ value: "", label: "Sem categoria" }, ...categories.map((category) => ({ value: category.id, label: category.name }))]} onCommit={(value) => onQuickUpdate(income, { category_id: value })} />
                ) : (
                  <CategoryBadge category={categories.find((category) => category.id === income.category_id)} />
                )}
              </td>
              <td className="px-4 py-3 text-ink-600">{people.find((person) => person.id === income.person_id)?.name ?? "-"}</td>
              <td className="px-4 py-3 text-ink-600">
                {allowQuickTableEdit ? (
                  <QuickEditSelect value={income.confidence} options={confidenceOptions} onCommit={(value) => onQuickUpdate(income, { confidence: value })} />
                ) : optionLabel(confidenceOptions, income.confidence)}
              </td>
              <td className="px-4 py-3 text-ink-600">
                {allowQuickTableEdit ? (
                  <QuickEditSelect value={income.status} options={incomeStatusOptions} onCommit={(value) => onQuickUpdate(income, { status: value })} />
                ) : optionLabel(incomeStatusOptions, income.status)}
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-2">
                  <ActionButton variant="secondary" onClick={() => onEdit(income)}>Editar</ActionButton>
                  <ActionButton variant="danger" onClick={() => onDelete(income)}>Excluir</ActionButton>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IncomeModal({
  modal,
  categories,
  people,
  saving,
  onSubmit,
  onClose,
}: {
  modal: ModalState;
  categories: IncomeCategory[];
  people: IncomePerson[];
  saving: boolean;
  onSubmit: (values: IncomeSourceFormValues) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState<IncomeSourceFormValues>(
    modal?.mode === "edit" ? incomeToFormValues(modal.income) : emptyIncomeForm,
  );

  return (
    <Modal
      title={modal?.mode === "edit" ? "Editar entrada" : "Nova entrada"}
      description="Separe renda real, reembolso e dinheiro de terceiros desde o cadastro."
      onClose={onClose}
    >
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(values);
        }}
      >
        <FieldShell label="Fonte">
          <input value={values.source} onChange={(event) => setValues({ ...values, source: event.target.value })} className={inputClassName} required />
        </FieldShell>
        <FieldShell label="Valor">
          <input value={values.amount} onChange={(event) => setValues({ ...values, amount: event.target.value })} type="number" min="0" step="0.01" className={inputClassName} required />
        </FieldShell>
        <FieldShell label="Data prevista">
          <input value={values.expected_date} onChange={(event) => setValues({ ...values, expected_date: event.target.value })} type="date" className={inputClassName} required />
        </FieldShell>
        <FieldShell label="Data recebida">
          <input value={values.received_date} onChange={(event) => setValues({ ...values, received_date: event.target.value })} type="date" className={inputClassName} />
        </FieldShell>
        <FieldShell label="Tipo">
          <select value={values.type} onChange={(event) => setValues({ ...values, type: event.target.value })} className={inputClassName}>
            {incomeTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FieldShell>
        <FieldShell label="Status">
          <select value={values.status} onChange={(event) => setValues({ ...values, status: event.target.value })} className={inputClassName}>
            {incomeStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FieldShell>
        <FieldShell label="Confiança">
          <select value={values.confidence} onChange={(event) => setValues({ ...values, confidence: event.target.value })} className={inputClassName}>
            {confidenceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FieldShell>
        <FieldShell label="Categoria">
          <select value={values.category_id} onChange={(event) => setValues({ ...values, category_id: event.target.value })} className={inputClassName}>
            <option value="">Sem categoria</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </FieldShell>
        <FieldShell label="Pessoa">
          <select value={values.person_id} onChange={(event) => setValues({ ...values, person_id: event.target.value })} className={inputClassName}>
            <option value="">Sem pessoa</option>
            {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        </FieldShell>
        <div className="md:col-span-2">
          <FieldShell label="Descrição">
            <textarea value={values.description} onChange={(event) => setValues({ ...values, description: event.target.value })} className={inputClassName} rows={3} />
          </FieldShell>
        </div>
        <div className="md:col-span-2">
          <FieldShell label="Notas">
            <textarea value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} className={inputClassName} rows={3} />
          </FieldShell>
        </div>
        <div className="flex justify-end gap-2 md:col-span-2">
          <ActionButton type="button" variant="secondary" onClick={onClose}>Cancelar</ActionButton>
          <ActionButton type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</ActionButton>
        </div>
      </form>
    </Modal>
  );
}
