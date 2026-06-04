"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import {
  createReimbursement,
  deleteReimbursement,
  generateLinkedEntryFromReimbursement,
  generateRecurringReimbursements,
  listReimbursements,
  listReimbursementSupportData,
  updateReimbursement,
} from "@/features/reimbursements/queries";
import {
  emptyReimbursementForm,
  reimbursementToFormValues,
  type ReimbursementAccount,
  type ReimbursementCard,
  type ReimbursementCategory,
  type ReimbursementFormValues,
  type ReimbursementGeneratedLinkValues,
  type ReimbursementIncome,
  type ReimbursementInvoice,
  type ReimbursementPerson,
  type ReimbursementRow,
  type ReimbursementTransaction,
} from "@/features/reimbursements/types";
import { ActionButton, BulkActionsBar, CategoryBadge, CategorySelect, CrudFeedback, FieldShell, inputClassName, Modal, QuickEditInput, QuickEditSelect, RowSelectionHint, shouldToggleRowSelection, TextBadge, TitleButton } from "@/features/shared/crud-ui";
import { formatCurrency, formatDate } from "@/features/shared/format";
import { invoiceStatusOptions, optionLabel, reimbursementStatusOptions } from "@/features/shared/options";
import { PeriodFilter } from "@/features/shared/period-filter";
import { isAnyDateInPeriod, parsePeriodSearchParams, type PeriodValue } from "@/features/shared/period";
import { getQuickTableEditPreference } from "@/features/shared/quick-edit";
import type { FeedbackState } from "@/features/shared/types";
import { createClient } from "@/lib/supabase/client";

type ModalState = { mode: "create"; reimbursement: null } | { mode: "edit"; reimbursement: ReimbursementRow } | null;
type LinkModalState = { reimbursement: ReimbursementRow } | null;

export function ReimbursementsCrud() {
  const searchParams = useSearchParams();
  const [reimbursements, setReimbursements] = useState<ReimbursementRow[]>([]);
  const [people, setPeople] = useState<ReimbursementPerson[]>([]);
  const [transactions, setTransactions] = useState<ReimbursementTransaction[]>([]);
  const [accounts, setAccounts] = useState<ReimbursementAccount[]>([]);
  const [income, setIncome] = useState<ReimbursementIncome[]>([]);
  const [categories, setCategories] = useState<ReimbursementCategory[]>([]);
  const [cards, setCards] = useState<ReimbursementCard[]>([]);
  const [invoices, setInvoices] = useState<ReimbursementInvoice[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [personFilter, setPersonFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") ?? "all");
  const [linkedFilter, setLinkedFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [period, setPeriod] = useState(() => parsePeriodSearchParams(Object.fromEntries(searchParams.entries())));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [linkModal, setLinkModal] = useState<LinkModalState>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [bulkPersonId, setBulkPersonId] = useState("");
  const [allowQuickTableEdit, setAllowQuickTableEdit] = useState(false);
  const [showAllPeopleSummary, setShowAllPeopleSummary] = useState(false);

  const periodReimbursements = useMemo(() => {
    return reimbursements.filter((reimbursement) =>
      isAnyDateInPeriod([reimbursement.expected_date, reimbursement.received_date], period),
    );
  }, [period, reimbursements]);

  const filteredReimbursements = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return periodReimbursements.filter((reimbursement) => {
      const personName = people.find((person) => person.id === reimbursement.person_id)?.name ?? "";
      const hasLink = Boolean(
        reimbursement.credit_card_transaction_id ||
          reimbursement.account_payable_id ||
          reimbursement.income_source_id,
      );

      return (
        (!needle ||
          (reimbursement.description ?? "").toLowerCase().includes(needle) ||
          personName.toLowerCase().includes(needle)) &&
        (personFilter === "all" || reimbursement.person_id === personFilter) &&
        (categoryFilter === "all" || reimbursement.category_id === categoryFilter) &&
        (statusFilter === "all" || reimbursement.status === statusFilter) &&
        (linkedFilter === "all" ||
          (linkedFilter === "linked" && hasLink) ||
          (linkedFilter === "manual" && !hasLink))
      );
    });
  }, [categoryFilter, linkedFilter, people, periodReimbursements, personFilter, search, statusFilter]);

  const summary = useMemo(() => {
    const isOpen = (item: ReimbursementRow) => ["expected", "partial", "late"].includes(item.status);
    const totalExpected = periodReimbursements
      .filter(isOpen)
      .reduce((sum, item) => sum + Number(item.expected_amount), 0);
    const totalReceived = periodReimbursements.reduce((sum, item) => sum + Number(item.received_amount), 0);
    const lateAmount = periodReimbursements
      .filter((item) => item.status === "late")
      .reduce((sum, item) => sum + Number(item.expected_amount) - Number(item.received_amount), 0);
    const partialAmount = periodReimbursements
      .filter((item) => item.status === "partial")
      .reduce((sum, item) => sum + Number(item.expected_amount) - Number(item.received_amount), 0);
    const amountOwed = periodReimbursements
      .filter(isOpen)
      .reduce((sum, item) => sum + Number(item.expected_amount) - Number(item.received_amount), 0);
    const linkedGrossAmount = periodReimbursements.reduce((sum, item) => {
      const transaction = transactions.find((transactionItem) => transactionItem.id === item.credit_card_transaction_id);
      const account = accounts.find((accountItem) => accountItem.id === item.account_payable_id);

      return sum + Number(transaction?.amount ?? account?.amount ?? item.expected_amount ?? 0);
    }, 0);
    const estimatedPersonalCost = Math.max(linkedGrossAmount - amountOwed, 0);

    return { totalExpected, totalReceived, lateAmount, partialAmount, amountOwed, estimatedPersonalCost };
  }, [accounts, periodReimbursements, transactions]);

  const peopleSummary = useMemo(() => {
    return people
      .map((person) => {
        const personRows = periodReimbursements.filter((item) => item.person_id === person.id);
        const openRows = personRows.filter((item) => ["expected", "partial", "late"].includes(item.status));
        const expected = openRows.reduce((sum, item) => sum + Number(item.expected_amount), 0);
        const received = personRows.reduce((sum, item) => sum + Number(item.received_amount), 0);
        const open = openRows.reduce((sum, item) => sum + Number(item.expected_amount) - Number(item.received_amount), 0);
        const late = personRows
          .filter((item) => item.status === "late")
          .reduce((sum, item) => sum + Number(item.expected_amount) - Number(item.received_amount), 0);

        return { person, expected, received, open, late, count: personRows.length };
      })
      .filter((item) => item.count > 0)
      .sort((a, b) => b.open - a.open);
  }, [people, periodReimbursements]);

  const visiblePeopleSummary = useMemo(() => {
    return showAllPeopleSummary ? peopleSummary : peopleSummary.filter((item) => item.open > 0);
  }, [peopleSummary, showAllPeopleSummary]);

  const selectedPerson = personFilter === "all" ? null : people.find((person) => person.id === personFilter) ?? null;

  async function loadData() {
    setLoading(true);
    const client = createClient();
    const { data: auth } = await client.auth.getUser();
    if (!auth.user) {
      setFeedback({ type: "error", message: "Sessão não encontrada." });
      setLoading(false);
      return;
    }

    setUserId(auth.user.id);
    const [reimbursementsResult, support, quickEdit] = await Promise.all([
      listReimbursements(client),
      listReimbursementSupportData(client),
      getQuickTableEditPreference(client, auth.user.id),
    ]);
    if (reimbursementsResult.error) setFeedback({ type: "error", message: reimbursementsResult.error.message });
    else setReimbursements(reimbursementsResult.data ?? []);
    if (!support.people.error) setPeople(support.people.data ?? []);
    if (!support.transactions.error) setTransactions(support.transactions.data ?? []);
    if (!support.accounts.error) setAccounts(support.accounts.data ?? []);
    if (!support.income.error) setIncome(support.income.data ?? []);
    if (!support.categories.error) setCategories(support.categories.data ?? []);
    if (!support.cards.error) setCards(support.cards.data ?? []);
    if (!support.invoices.error) setInvoices(support.invoices.data ?? []);
    setAllowQuickTableEdit(quickEdit);
    setLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function handleSubmit(values: ReimbursementFormValues) {
    if (!values.person_id || Number(values.expected_amount) < 0 || Number(values.received_amount) < 0) {
      setFeedback({ type: "error", message: "Pessoa é obrigatória e valores não podem ser negativos." });
      return;
    }
    if (values.is_recurring && !values.recurrence_start_date && !values.expected_date) {
      setFeedback({ type: "error", message: "Informe o início do reembolso recorrente." });
      return;
    }
    if (values.is_recurring && values.recurrence_end_date && values.recurrence_end_date < (values.recurrence_start_date || values.expected_date)) {
      setFeedback({ type: "error", message: "O fim da recorrência deve ser depois do início." });
      return;
    }
    if (!userId) return;

    setSaving(true);
    setFeedback(null);

    try {
      const client = createClient();
      const result =
        modal?.mode === "edit"
          ? await updateReimbursement(client, modal.reimbursement.id, values)
          : await createReimbursement(client, userId, values);

      if (result.error) {
        console.error("Erro técnico ao salvar reembolso:", result.error);
        setFeedback({ type: "error", message: result.error.message });
        return;
      }

      let generatedMessage = "";
      const occurrences = Number(values.recurrence_occurrences || 0);

      if (values.is_recurring && occurrences > 0) {
        const generated = await generateRecurringReimbursements(client, userId, result.data, occurrences);

        if (generated.error) {
          setFeedback({ type: "error", message: generated.error.message });
          return;
        }

        generatedMessage = ` ${generated.created} ocorrência(s) gerada(s), ${generated.skipped} já existia(m).`;
      }

      setFeedback({
        type: "success",
        message: `${modal?.mode === "edit" ? "Reembolso atualizado." : "Reembolso criado."}${generatedMessage}`,
      });
      setModal(null);
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao salvar reembolso:", error);
      setFeedback({ type: "error", message: "Não foi possível salvar o reembolso." });
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateRecurring(reimbursement: ReimbursementRow) {
    if (!userId) {
      setFeedback({ type: "error", message: "Sessão não encontrada." });
      return;
    }

    const raw = window.prompt("Quantas próximas ocorrências deseja gerar? Máximo 24.", "12");
    if (!raw) return;

    const occurrences = Number(raw);
    if (Number.isNaN(occurrences) || occurrences < 1) {
      setFeedback({ type: "error", message: "Informe uma quantidade válida." });
      return;
    }

    setGeneratingId(reimbursement.id);
    setFeedback(null);

    try {
      const result = await generateRecurringReimbursements(createClient(), userId, reimbursement, occurrences);

      if (result.error) {
        setFeedback({ type: "error", message: result.error.message });
        return;
      }

      setFeedback({ type: "success", message: `${result.created} reembolso(s) gerado(s). ${result.skipped} já existia(m).` });
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao gerar reembolsos recorrentes:", error);
      setFeedback({ type: "error", message: "Não foi possível gerar os próximos reembolsos." });
    } finally {
      setGeneratingId(null);
    }
  }

  async function handleGenerateLinked(values: ReimbursementGeneratedLinkValues) {
    if (!userId || !linkModal) {
      setFeedback({ type: "error", message: "Sessão não encontrada." });
      return;
    }

    setLinkingId(linkModal.reimbursement.id);
    setFeedback(null);

    try {
      const result = await generateLinkedEntryFromReimbursement(createClient(), userId, linkModal.reimbursement, values);

      if (result.error) {
        setFeedback({ type: "error", message: result.error.message });
        return;
      }

      setFeedback({ type: "success", message: values.target === "account" ? "Conta vinculada gerada." : "Lançamento de fatura vinculado gerado." });
      setLinkModal(null);
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao gerar lançamento vinculado:", error);
      setFeedback({ type: "error", message: "Não foi possível gerar o lançamento vinculado." });
    } finally {
      setLinkingId(null);
    }
  }

  async function handleDelete(reimbursement: ReimbursementRow) {
    if (!window.confirm("Excluir este reembolso?")) return;
    const { error } = await deleteReimbursement(createClient(), reimbursement.id);
    if (error) setFeedback({ type: "error", message: error.message });
    else {
      setFeedback({ type: "success", message: "Reembolso excluído." });
      await loadData();
    }
  }

  async function handleQuickUpdate(reimbursement: ReimbursementRow, patch: Partial<ReimbursementFormValues>) {
    setFeedback(null);

    try {
      const result = await updateReimbursement(createClient(), reimbursement.id, {
        ...reimbursementToFormValues(reimbursement),
        ...patch,
      });

      if (result.error) {
        console.error("Erro técnico ao editar reembolso rapidamente:", result.error);
        setFeedback({ type: "error", message: "Não foi possível salvar a edição rápida." });
        return;
      }

      await loadData();
    } catch (error) {
      console.error("Erro técnico ao editar reembolso rapidamente:", error);
      setFeedback({ type: "error", message: "Não foi possível salvar a edição rápida." });
    }
  }

  async function handleStatusUpdate(reimbursement: ReimbursementRow, status: string) {
    const patch: Partial<ReimbursementFormValues> = { status };

    if (status === "received" && (!Number(reimbursement.received_amount) || !reimbursement.received_date)) {
      const remaining = Math.max(Number(reimbursement.expected_amount) - Number(reimbursement.received_amount), 0);
      const amountRaw = window.prompt(
        "Informe o valor recebido para marcar este reembolso como recebido.",
        String(remaining || reimbursement.expected_amount || 0),
      );
      if (amountRaw === null) return;

      const amount = Number(amountRaw.replace(",", "."));
      if (Number.isNaN(amount) || amount < 0) {
        setFeedback({ type: "error", message: "Informe um valor recebido válido." });
        return;
      }

      const today = new Date().toISOString().slice(0, 10);
      const receivedDate = window.prompt("Informe a data de recebimento.", reimbursement.received_date || today);
      if (receivedDate === null) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedDate)) {
        setFeedback({ type: "error", message: "Informe uma data recebida válida no formato AAAA-MM-DD." });
        return;
      }

      patch.received_amount = String(amount);
      patch.received_date = receivedDate;
    }

    await handleQuickUpdate(reimbursement, patch);
  }

  async function handleBulkUpdate(
    label: string,
    getPatch: (reimbursement: ReimbursementRow) => Partial<ReimbursementFormValues> | null,
  ) {
    const selected = reimbursements.filter((item) => selectedIds.has(item.id));
    if (selected.length === 0) return;
    if (!window.confirm(`${label} em ${selected.length} reembolso(s) selecionado(s)?`)) return;

    setBulkUpdating(true);
    setFeedback(null);

    try {
      const client = createClient();
      const results = await Promise.all(
        selected.map((reimbursement) => {
          const patch = getPatch(reimbursement);
          if (!patch) return Promise.resolve({ error: null });
          return updateReimbursement(client, reimbursement.id, {
            ...reimbursementToFormValues(reimbursement),
            ...patch,
          });
        }),
      );
      const failed = results.find((result) => result.error);

      if (failed?.error) {
        console.error("Erro técnico ao alterar reembolsos em lote:", failed.error);
        setFeedback({ type: "error", message: "Não foi possível alterar todos os reembolsos selecionados." });
        return;
      }

      setSelectedIds(new Set());
      setBulkStatus("");
      setBulkCategoryId("");
      setBulkPersonId("");
      setFeedback({ type: "success", message: `${selected.length} reembolso(s) atualizado(s).` });
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao alterar reembolsos em lote:", error);
      setFeedback({ type: "error", message: "Não foi possível alterar os reembolsos selecionados." });
    } finally {
      setBulkUpdating(false);
    }
  }

  async function handleBulkMarkReceived() {
    const today = new Date().toISOString().slice(0, 10);
    await handleBulkUpdate("Marcar como recebido", (reimbursement) => ({
      status: "received",
      received_amount: String(Number(reimbursement.expected_amount)),
      received_date: reimbursement.received_date || today,
    }));
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
      const results = await Promise.all(ids.map((id) => deleteReimbursement(client, id)));
      const failed = results.find((result) => result.error);

      if (failed?.error) {
        console.error("Erro técnico ao excluir reembolsos selecionados:", failed.error);
        setFeedback({ type: "error", message: "Não foi possível excluir todos os itens selecionados." });
        return;
      }

      setSelectedIds(new Set());
      setFeedback({ type: "success", message: `${ids.length} reembolso(s) excluído(s).` });
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao excluir reembolsos selecionados:", error);
      setFeedback({ type: "error", message: "Não foi possível excluir os itens selecionados." });
    } finally {
      setDeletingSelected(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Dinheiro vinculado"
        title="Reembolsos"
        description="Controle o que outras pessoas devem por despesas que você pagou antes."
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <ActionButton variant="secondary" onClick={() => setReportOpen(true)}>Gerar relatório</ActionButton>
            <ActionButton onClick={() => setModal({ mode: "create", reimbursement: null })}>Novo reembolso</ActionButton>
          </div>
        }
      />
      <CrudFeedback feedback={feedback} />

      <PeriodFilter value={period} onChange={setPeriod} syncUrl />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <StatCard label="A receber" value={formatCurrency(summary.totalExpected)} helper="Não é renda livre." tone="warning" />
        <StatCard label="Recebido" value={formatCurrency(summary.totalReceived)} helper="Pix já recebido." tone="success" />
        <StatCard label="Atrasado" value={formatCurrency(summary.lateAmount)} helper="Maior risco de caixa." tone="danger" />
        <StatCard label="Parcial" value={formatCurrency(summary.partialAmount)} helper="Ainda falta receber." tone="warning" />
        <StatCard label="Pessoas devem" value={formatCurrency(summary.amountOwed)} helper="Saldo aberto." tone="info" />
        <StatCard label="Custo pessoal estimado" value={formatCurrency(summary.estimatedPersonalCost)} helper="Valor vinculado menos saldo aberto." tone="info" />
      </section>

      <SectionCard title="Separação importante" description="Reembolso existe para compensar despesa paga antes.">
        <p className="text-sm leading-6 text-ink-600">
          Mesmo quando entra via Pix, esse valor deve ser lido como dinheiro vinculado a uma compra,
          conta ou favor financeiro. Ele não aumenta sua renda real disponível.
        </p>
        <p className="mt-2 text-sm leading-6 text-ink-600">
          Reembolsos recorrentes servem para valores mensais combinados, como assinaturas familiares.
          Gere próximas ocorrências de forma controlada e revise cada uma antes de considerar no caixa.
        </p>
      </SectionCard>

      <SectionCard title="Quem deve agora" description="Por padrão, mostra apenas pessoas com valor em aberto.">
        <div className="mb-4 flex justify-end">
          <label className="inline-flex items-center gap-2 text-sm font-medium text-ink-600">
            <input
              type="checkbox"
              checked={showAllPeopleSummary}
              onChange={(event) => setShowAllPeopleSummary(event.target.checked)}
            />
            Mostrar pessoas sem saldo em aberto
          </label>
        </div>
        {peopleSummary.length === 0 ? (
          <EmptyState title="Nenhuma pessoa com reembolso" description="Quando houver reembolsos, o resumo por pessoa aparecerá aqui." />
        ) : visiblePeopleSummary.length === 0 ? (
          <EmptyState title="Ninguém deve agora" description="Não há pessoas com valor em aberto no período filtrado." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visiblePeopleSummary.map((item) => (
              <button
                key={item.person.id}
                type="button"
                className={`rounded-md border bg-white p-4 text-left transition hover:border-mint-500 hover:shadow-sm ${
                  personFilter === item.person.id ? "border-mint-500 ring-2 ring-mint-500/20" : "border-ink-950/10"
                }`}
                onClick={() => setPersonFilter(item.person.id)}
                aria-pressed={personFilter === item.person.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink-950">{item.person.name}</p>
                    <p className="mt-1 text-sm text-ink-600">{item.count} reembolso(s)</p>
                  </div>
                  <TextBadge tone={item.late > 0 ? "danger" : item.open > 0 ? "warning" : "success"}>
                    {item.late > 0 ? "Atrasado" : item.open > 0 ? "Aberto" : "Recebido"}
                  </TextBadge>
                </div>
                <div className="mt-4 grid gap-2 text-sm text-ink-600">
                  <p>Esperado: <strong className="text-ink-950">{formatCurrency(item.expected)}</strong></p>
                  <p>Recebido: <strong className="text-ink-950">{formatCurrency(item.received)}</strong></p>
                  <p>Em aberto: <strong className="text-ink-950">{formatCurrency(item.open)}</strong></p>
                </div>
              </button>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Filtros">
        {selectedPerson ? (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-mint-500/30 bg-mint-50 px-3 py-2 text-sm text-ink-700">
            <span>Filtro de pessoa ativo: <strong>{selectedPerson.name}</strong></span>
            <ActionButton variant="secondary" onClick={() => setPersonFilter("all")}>Limpar filtro de pessoa</ActionButton>
          </div>
        ) : null}
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
          <input className={inputClassName} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por descrição ou pessoa" />
          <select className={inputClassName} value={personFilter} onChange={(event) => setPersonFilter(event.target.value)}>
            <option value="all">Todas pessoas</option>
            {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
          <select className={inputClassName} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">Todos status</option>
            {reimbursementStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <CategorySelect
            categories={categories}
            value={categoryFilter === "all" ? "" : categoryFilter}
            placeholder="Todas categorias"
            onChange={(value) => setCategoryFilter(value || "all")}
          />
          <select className={inputClassName} value={linkedFilter} onChange={(event) => setLinkedFilter(event.target.value)}>
            <option value="all">Todos vínculos</option>
            <option value="linked">Com lançamento</option>
            <option value="manual">Manual</option>
          </select>
        </div>
      </SectionCard>

      <SectionCard title="Reembolsos cadastrados">
        {loading ? (
          <p className="text-sm text-ink-600">Carregando reembolsos...</p>
        ) : reimbursements.length === 0 ? (
          <EmptyState title="Nenhum reembolso cadastrado" description="Crie reembolsos para separar dinheiro de terceiros da sua renda real." />
        ) : filteredReimbursements.length === 0 ? (
          <EmptyState title="Nenhum reembolso no período" description="Ajuste o período ou os filtros para ver outros reembolsos." />
        ) : (
          <>
          <BulkActionsBar
            selectedCount={selectedIds.size}
            deleting={deletingSelected || bulkUpdating}
            onClear={() => setSelectedIds(new Set())}
            onDelete={() => void handleBulkDelete()}
          >
            <select
              className={inputClassName}
              value={bulkStatus}
              disabled={bulkUpdating || deletingSelected}
              onChange={(event) => setBulkStatus(event.target.value)}
            >
              <option value="">Status</option>
              {reimbursementStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <ActionButton
              type="button"
              variant="secondary"
              disabled={!bulkStatus || bulkUpdating || deletingSelected}
              onClick={() => void handleBulkUpdate("Alterar status", () => ({ status: bulkStatus }))}
            >
              Alterar status
            </ActionButton>
            <select
              className={inputClassName}
              value={bulkCategoryId}
              disabled={bulkUpdating || deletingSelected}
              onChange={(event) => setBulkCategoryId(event.target.value)}
            >
              <option value="">Categoria</option>
              <option value="__none">Sem categoria</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <ActionButton
              type="button"
              variant="secondary"
              disabled={!bulkCategoryId || bulkUpdating || deletingSelected}
              onClick={() => void handleBulkUpdate("Alterar categoria", () => ({ category_id: bulkCategoryId === "__none" ? "" : bulkCategoryId }))}
            >
              Alterar categoria
            </ActionButton>
            <select
              className={inputClassName}
              value={bulkPersonId}
              disabled={bulkUpdating || deletingSelected}
              onChange={(event) => setBulkPersonId(event.target.value)}
            >
              <option value="">Pessoa</option>
              {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
            <ActionButton
              type="button"
              variant="secondary"
              disabled={!bulkPersonId || bulkUpdating || deletingSelected}
              onClick={() => void handleBulkUpdate("Alterar pessoa", () => ({ person_id: bulkPersonId }))}
            >
              Alterar pessoa
            </ActionButton>
            <ActionButton
              type="button"
              variant="secondary"
              disabled={bulkUpdating || deletingSelected}
              onClick={() => void handleBulkMarkReceived()}
            >
              Marcar recebido
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
                      checked={filteredReimbursements.length > 0 && filteredReimbursements.every((item) => selectedIds.has(item.id))}
                      onChange={(event) => {
                        if (event.target.checked) {
                          setSelectedIds(new Set([...selectedIds, ...filteredReimbursements.map((item) => item.id)]));
                          return;
                        }
                        const next = new Set(selectedIds);
                        filteredReimbursements.forEach((item) => next.delete(item.id));
                        setSelectedIds(next);
                      }}
                      aria-label="Selecionar todos os reembolsos filtrados"
                    />
                  </th>
                  <th className="px-4 py-3">Pessoa</th>
                  <th className="px-4 py-3">Descrição</th>
                  <th className="px-4 py-3">Esperado</th>
                  <th className="px-4 py-3">Recebido</th>
                  <th className="px-4 py-3">Data prevista</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Categoria</th>
                  <th className="px-4 py-3">Vínculo</th>
                  <th className="px-4 py-3">Recorrência</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-950/10">
                {filteredReimbursements.map((reimbursement) => (
                  <tr
                    key={reimbursement.id}
                    onClick={(event) => {
                      if (!shouldToggleRowSelection(event)) return;
                      const next = new Set(selectedIds);
                      if (next.has(reimbursement.id)) next.delete(reimbursement.id);
                      else next.add(reimbursement.id);
                      setSelectedIds(next);
                    }}
                    className="cursor-default"
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(reimbursement.id)}
                        onChange={(event) => {
                          const next = new Set(selectedIds);
                          if (event.target.checked) next.add(reimbursement.id);
                          else next.delete(reimbursement.id);
                          setSelectedIds(next);
                        }}
                        aria-label={`Selecionar ${reimbursement.description ?? "reembolso"}`}
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-ink-950">
                      <TitleButton onClick={() => setModal({ mode: "edit", reimbursement })}>
                        {people.find((person) => person.id === reimbursement.person_id)?.name ?? "-"}
                      </TitleButton>
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {allowQuickTableEdit ? (
                        <QuickEditInput value={reimbursement.description ?? ""} onCommit={(value) => void handleQuickUpdate(reimbursement, { description: value })} />
                      ) : reimbursement.description ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-ink-950">
                      {allowQuickTableEdit ? (
                        <QuickEditInput type="number" value={String(reimbursement.expected_amount)} onCommit={(value) => void handleQuickUpdate(reimbursement, { expected_amount: value })} />
                      ) : formatCurrency(Number(reimbursement.expected_amount))}
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {allowQuickTableEdit ? (
                        <QuickEditInput type="number" value={String(reimbursement.received_amount)} onCommit={(value) => void handleQuickUpdate(reimbursement, { received_amount: value })} />
                      ) : formatCurrency(Number(reimbursement.received_amount))}
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {allowQuickTableEdit ? (
                        <QuickEditInput type="date" value={reimbursement.expected_date ?? ""} onCommit={(value) => void handleQuickUpdate(reimbursement, { expected_date: value })} />
                      ) : formatDate(reimbursement.expected_date)}
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      <QuickEditSelect value={reimbursement.status} options={reimbursementStatusOptions} onCommit={(value) => void handleStatusUpdate(reimbursement, value)} />
                    </td>
                    <td className="px-4 py-3">
                      {allowQuickTableEdit ? (
                        <QuickEditSelect
                          value={reimbursement.category_id ?? ""}
                          options={[{ value: "", label: "Sem categoria" }, ...categories.map((category) => ({ value: category.id, label: category.name }))]}
                          onCommit={(value) => void handleQuickUpdate(reimbursement, { category_id: value })}
                        />
                      ) : (
                        <CategoryBadge category={categories.find((category) => category.id === reimbursement.category_id)} />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <TextBadge tone={getLinkedTone(reimbursement)}>
                        {getLinkedLabel(reimbursement, transactions, accounts, income)}
                      </TextBadge>
                    </td>
                    <td className="px-4 py-3">
                      {reimbursement.is_recurring ? (
                        <TextBadge tone="info">{reimbursement.recurrence_parent_id ? "Ocorrência" : "Recorrente"}</TextBadge>
                      ) : (
                        <span className="text-ink-500">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {reimbursement.is_recurring && !reimbursement.recurrence_parent_id ? (
                          <ActionButton
                            variant="secondary"
                            disabled={generatingId === reimbursement.id}
                            onClick={() => void handleGenerateRecurring(reimbursement)}
                          >
                            {generatingId === reimbursement.id ? "Gerando..." : "Gerar próximas"}
                          </ActionButton>
                        ) : null}
                        <ActionButton
                          variant="secondary"
                          disabled={linkingId === reimbursement.id}
                          onClick={() => setLinkModal({ reimbursement })}
                        >
                          {linkingId === reimbursement.id ? "Gerando..." : "Gerar lançamento vinculado"}
                        </ActionButton>
                        <ActionButton variant="secondary" onClick={() => setModal({ mode: "edit", reimbursement })}>Editar</ActionButton>
                        <ActionButton variant="danger" onClick={() => void handleDelete(reimbursement)}>Excluir</ActionButton>
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

      {modal ? (
        <ReimbursementModal
          accounts={accounts}
          categories={categories}
          income={income}
          modal={modal}
          people={people}
          saving={saving}
          transactions={transactions}
          onClose={() => setModal(null)}
          onSubmit={(values) => void handleSubmit(values)}
        />
      ) : null}
      {linkModal ? (
        <LinkedEntryModal
          cards={cards}
          invoices={invoices}
          linking={linkingId === linkModal.reimbursement.id}
          reimbursement={linkModal.reimbursement}
          onClose={() => setLinkModal(null)}
          onSubmit={(values) => void handleGenerateLinked(values)}
        />
      ) : null}
      {reportOpen ? (
        <ReimbursementReportModal
          accounts={accounts}
          cards={cards}
          categories={categories}
          income={income}
          invoices={invoices}
          period={period}
          person={selectedPerson}
          reimbursements={filteredReimbursements}
          transactions={transactions}
          people={people}
          onClose={() => setReportOpen(false)}
        />
      ) : null}
    </div>
  );
}

function ReimbursementModal({
  accounts,
  categories,
  income,
  modal,
  people,
  saving,
  transactions,
  onClose,
  onSubmit,
}: {
  accounts: ReimbursementAccount[];
  categories: ReimbursementCategory[];
  income: ReimbursementIncome[];
  modal: ModalState;
  people: ReimbursementPerson[];
  saving: boolean;
  transactions: ReimbursementTransaction[];
  onClose: () => void;
  onSubmit: (values: ReimbursementFormValues) => void;
}) {
  const [values, setValues] = useState<ReimbursementFormValues>(
    modal?.mode === "edit" ? reimbursementToFormValues(modal.reimbursement) : emptyReimbursementForm,
  );

  return (
    <Modal
      title={modal?.mode === "edit" ? "Editar reembolso" : "Novo reembolso"}
      onClose={onClose}
      headerAction={
        <ActionButton type="submit" form="reimbursement-form" disabled={saving}>
          {saving ? "Salvando..." : "Salvar"}
        </ActionButton>
      }
    >
      <form
        id="reimbursement-form"
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(values);
        }}
      >
        <FieldShell label="Pessoa responsável">
          <select required className={inputClassName} value={values.person_id} onChange={(event) => setValues({ ...values, person_id: event.target.value })}>
            <option value="">Selecione</option>
            {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        </FieldShell>
        <FieldShell label="Status">
          <select className={inputClassName} value={values.status} onChange={(event) => setValues({ ...values, status: event.target.value })}>
            {reimbursementStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FieldShell>
        <FieldShell label="Categoria">
          <CategorySelect categories={categories} value={values.category_id} onChange={(category_id) => setValues({ ...values, category_id })} />
        </FieldShell>
        <div className="md:col-span-2">
          <FieldShell label="Descrição">
            <input className={inputClassName} value={values.description} onChange={(event) => setValues({ ...values, description: event.target.value })} />
          </FieldShell>
        </div>
        <FieldShell label="Valor esperado">
          <input min="0" step="0.01" type="number" className={inputClassName} value={values.expected_amount} onChange={(event) => setValues({ ...values, expected_amount: event.target.value })} />
        </FieldShell>
        <FieldShell label="Valor recebido">
          <input min="0" step="0.01" type="number" className={inputClassName} value={values.received_amount} onChange={(event) => setValues({ ...values, received_amount: event.target.value })} />
        </FieldShell>
        <FieldShell label="Data prevista">
          <input type="date" className={inputClassName} value={values.expected_date} onChange={(event) => setValues({ ...values, expected_date: event.target.value })} />
        </FieldShell>
        <FieldShell label="Data recebida">
          <input type="date" className={inputClassName} value={values.received_date} onChange={(event) => setValues({ ...values, received_date: event.target.value })} />
        </FieldShell>
        <FieldShell label="Reembolso recorrente?">
          <select
            className={inputClassName}
            value={String(values.is_recurring)}
            onChange={(event) => setValues({ ...values, is_recurring: event.target.value === "true" })}
          >
            <option value="false">Não</option>
            <option value="true">Sim, mensal</option>
          </select>
        </FieldShell>
        {values.is_recurring ? (
          <>
            <FieldShell label="Frequência">
              <select className={inputClassName} value={values.recurrence_frequency} onChange={(event) => setValues({ ...values, recurrence_frequency: event.target.value as "monthly" })}>
                <option value="monthly">Mensal</option>
              </select>
            </FieldShell>
            <FieldShell label="Início">
              <input type="date" className={inputClassName} value={values.recurrence_start_date} onChange={(event) => setValues({ ...values, recurrence_start_date: event.target.value })} />
            </FieldShell>
            <FieldShell label="Fim opcional">
              <input type="date" className={inputClassName} value={values.recurrence_end_date} onChange={(event) => setValues({ ...values, recurrence_end_date: event.target.value })} />
            </FieldShell>
            <FieldShell label="Gerar próximas ocorrências">
              <input
                min="0"
                max="24"
                type="number"
                className={inputClassName}
                value={values.recurrence_occurrences}
                onChange={(event) => setValues({ ...values, recurrence_occurrences: event.target.value })}
              />
            </FieldShell>
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 md:col-span-2">
              Reembolsos recorrentes geram novas cobranças mensais sem transformar esse dinheiro em renda livre.
            </p>
          </>
        ) : null}
        <FieldShell label="Lançamento do cartão">
          <select className={inputClassName} value={values.credit_card_transaction_id} onChange={(event) => setValues({ ...values, credit_card_transaction_id: event.target.value })}>
            <option value="">Sem vínculo</option>
            {transactions.map((transaction) => (
              <option key={transaction.id} value={transaction.id}>
                {transaction.description} - {formatCurrency(Number(transaction.amount))}
              </option>
            ))}
          </select>
        </FieldShell>
        <FieldShell label="Conta vinculada">
          <select className={inputClassName} value={values.account_payable_id} onChange={(event) => setValues({ ...values, account_payable_id: event.target.value })}>
            <option value="">Sem vínculo</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.title}</option>
            ))}
          </select>
        </FieldShell>
        <FieldShell label="Entrada relacionada">
          <select className={inputClassName} value={values.income_source_id} onChange={(event) => setValues({ ...values, income_source_id: event.target.value })}>
            <option value="">Sem vínculo</option>
            {income.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </FieldShell>
        <div className="md:col-span-2">
          <FieldShell label="Notas">
            <textarea rows={3} className={inputClassName} value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} />
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

function LinkedEntryModal({
  cards,
  invoices,
  linking,
  reimbursement,
  onClose,
  onSubmit,
}: {
  cards: ReimbursementCard[];
  invoices: ReimbursementInvoice[];
  linking: boolean;
  reimbursement: ReimbursementRow;
  onClose: () => void;
  onSubmit: (values: ReimbursementGeneratedLinkValues) => void;
}) {
  const hasLink = Boolean(
    reimbursement.account_payable_id ||
      reimbursement.credit_card_transaction_id ||
      reimbursement.credit_card_invoice_id,
  );
  const defaultDate = reimbursement.expected_date ?? new Date().toISOString().slice(0, 10);
  const defaultDescription = reimbursement.description ?? "Reembolso";
  const defaultAmount = String(reimbursement.expected_amount);
  const [target, setTarget] = useState<"account" | "invoice">("account");
  const [accountValues, setAccountValues] = useState({
    title: defaultDescription,
    description: `Gerado a partir do reembolso: ${defaultDescription}`,
    amount: defaultAmount,
    due_date: defaultDate,
  });
  const [invoiceValues, setInvoiceValues] = useState({
    credit_card_id: "",
    invoice_id: "",
    description: defaultDescription,
    amount: defaultAmount,
    transaction_date: defaultDate,
  });
  const filteredInvoices = invoices.filter((invoice) => !invoiceValues.credit_card_id || invoice.credit_card_id === invoiceValues.credit_card_id);

  return (
    <Modal
      title="Gerar lançamento vinculado"
      onClose={onClose}
      headerAction={
        <ActionButton type="submit" form="linked-reimbursement-form" disabled={linking}>
          {linking ? "Gerando..." : "Salvar"}
        </ActionButton>
      }
    >
      <form
        id="linked-reimbursement-form"
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();

          if (hasLink) {
            onSubmit(target === "account" ? { target, ...accountValues } : { target, ...invoiceValues });
            return;
          }

          onSubmit(target === "account" ? { target, ...accountValues } : { target, ...invoiceValues });
        }}
      >
        {hasLink ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 md:col-span-2">
            Este reembolso já possui vínculo. Para evitar duplicidade, o sistema não cria outro lançamento sobre o mesmo reembolso.
          </p>
        ) : (
          <p className="rounded-md border border-mint-500/30 bg-mint-50 px-3 py-2 text-sm text-ink-700 md:col-span-2">
            Gerar lançamento vinculado cria uma conta ou lançamento de fatura rastreável a este reembolso.
          </p>
        )}
        <FieldShell label="Tipo de lançamento">
          <select className={inputClassName} value={target} onChange={(event) => setTarget(event.target.value as "account" | "invoice")}>
            <option value="account">Gerar conta</option>
            <option value="invoice">Gerar lançamento na fatura</option>
          </select>
        </FieldShell>
        {target === "account" ? (
          <>
            <FieldShell label="Título">
              <input className={inputClassName} value={accountValues.title} onChange={(event) => setAccountValues({ ...accountValues, title: event.target.value })} />
            </FieldShell>
            <FieldShell label="Valor">
              <input min="0" step="0.01" type="number" className={inputClassName} value={accountValues.amount} onChange={(event) => setAccountValues({ ...accountValues, amount: event.target.value })} />
            </FieldShell>
            <FieldShell label="Vencimento">
              <input type="date" className={inputClassName} value={accountValues.due_date} onChange={(event) => setAccountValues({ ...accountValues, due_date: event.target.value })} />
            </FieldShell>
            <div className="md:col-span-2">
              <FieldShell label="Descrição">
                <textarea rows={3} className={inputClassName} value={accountValues.description} onChange={(event) => setAccountValues({ ...accountValues, description: event.target.value })} />
              </FieldShell>
            </div>
          </>
        ) : (
          <>
            <FieldShell label="Cartão">
              <select
                required
                className={inputClassName}
                value={invoiceValues.credit_card_id}
                onChange={(event) => setInvoiceValues({ ...invoiceValues, credit_card_id: event.target.value, invoice_id: "" })}
              >
                <option value="">Selecione</option>
                {cards.map((card) => (
                  <option key={card.id} value={card.id}>{card.name}{card.issuer ? ` - ${card.issuer}` : ""}</option>
                ))}
              </select>
            </FieldShell>
            <FieldShell label="Fatura">
              <select required className={inputClassName} value={invoiceValues.invoice_id} onChange={(event) => setInvoiceValues({ ...invoiceValues, invoice_id: event.target.value })}>
                <option value="">Selecione</option>
                {filteredInvoices.map((invoice) => (
                  <option key={invoice.id} value={invoice.id}>
                    {formatInvoiceOptionLabel(invoice, cards)}
                  </option>
                ))}
              </select>
            </FieldShell>
            <FieldShell label="Valor">
              <input min="0" step="0.01" type="number" className={inputClassName} value={invoiceValues.amount} onChange={(event) => setInvoiceValues({ ...invoiceValues, amount: event.target.value })} />
            </FieldShell>
            <FieldShell label="Data">
              <input type="date" className={inputClassName} value={invoiceValues.transaction_date} onChange={(event) => setInvoiceValues({ ...invoiceValues, transaction_date: event.target.value })} />
            </FieldShell>
            <div className="md:col-span-2">
              <FieldShell label="Descrição">
                <input className={inputClassName} value={invoiceValues.description} onChange={(event) => setInvoiceValues({ ...invoiceValues, description: event.target.value })} />
              </FieldShell>
            </div>
          </>
        )}
        <div className="flex justify-end gap-2 md:col-span-2">
          <ActionButton type="button" variant="secondary" onClick={onClose}>Cancelar</ActionButton>
          <ActionButton type="submit" disabled={linking}>{linking ? "Gerando..." : "Gerar"}</ActionButton>
        </div>
      </form>
    </Modal>
  );
}

function ReimbursementReportModal({
  accounts,
  cards,
  categories,
  income,
  invoices,
  period,
  person,
  people,
  reimbursements,
  transactions,
  onClose,
}: {
  accounts: ReimbursementAccount[];
  cards: ReimbursementCard[];
  categories: ReimbursementCategory[];
  income: ReimbursementIncome[];
  invoices: ReimbursementInvoice[];
  period: PeriodValue;
  person: ReimbursementPerson | null;
  people: ReimbursementPerson[];
  reimbursements: ReimbursementRow[];
  transactions: ReimbursementTransaction[];
  onClose: () => void;
}) {
  const generatedAt = new Date();
  const reportRef = useRef<HTMLElement | null>(null);
  const summary = summarizeReportReimbursements(reimbursements);
  const groups = groupReimbursementsByPerson(reimbursements, people);

  function handlePrint() {
    const report = reportRef.current;

    if (!report) {
      window.print();
      return;
    }

    const printWindow = window.open("", "hub-vz-reembolsos-pdf", "width=980,height=1200");

    if (!printWindow) {
      document.documentElement.classList.add("printing-reimbursement-report");
      window.print();
      window.setTimeout(() => {
        document.documentElement.classList.remove("printing-reimbursement-report");
      }, 300);
      return;
    }

    printWindow.document.write(buildReimbursementPrintDocument(report.outerHTML));
    printWindow.document.close();
    printWindow.focus();
    printWindow.setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 150);
  }

  function handleFallbackPrint() {
    document.documentElement.classList.add("printing-reimbursement-report");
    window.print();
    window.setTimeout(() => {
      document.documentElement.classList.remove("printing-reimbursement-report");
    }, 300);
  }

  return (
    <Modal title="Relatório de reembolsos" onClose={onClose}>
      <div className="reimbursement-report-shell space-y-5">
        <div className="report-actions flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-600">
            Relatório otimizado para impressão/PDF. No navegador, desative &quot;Cabeçalhos e rodapés&quot; para ocultar URL e data externas.
          </p>
          <div className="flex flex-wrap gap-2">
            <ActionButton variant="secondary" onClick={handlePrint}>Exportar PDF</ActionButton>
            <ActionButton variant="secondary" onClick={handleFallbackPrint}>Imprimir tela</ActionButton>
            <ActionButton variant="secondary" onClick={onClose}>Voltar</ActionButton>
          </div>
        </div>

        <article ref={reportRef} className="reimbursement-report rounded-lg border border-ink-950/10 bg-white p-6 text-ink-950 shadow-sm">
          <header className="report-header border-b border-ink-950/10 pb-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-mint-600">Hub VZ</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink-950">Relatório de Reembolsos</h2>
                <p className="mt-2 text-sm leading-6 text-ink-600">
                  {formatPeriodLabel(period)} · Gerado em {formatDateTime(generatedAt)} · {person?.name ?? "Todas as pessoas"}
                </p>
              </div>
              <div className="rounded-md border border-mint-500/30 bg-mint-100 px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.12em] text-mint-600">
                Documento de apoio
              </div>
            </div>
          </header>

          {reimbursements.length === 0 ? (
            <div className="mt-8 rounded-md border border-dashed border-ink-950/18 bg-slate-50 px-6 py-10 text-center">
              <p className="text-base font-semibold text-ink-950">Nenhum reembolso encontrado para os filtros selecionados.</p>
              <p className="mt-2 text-sm text-ink-600">Volte e ajuste período, pessoa, status, categoria, vínculo ou busca.</p>
            </div>
          ) : (
            <>
              <section className="report-summary mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <ReportMetric label="Total esperado" value={formatCurrency(summary.expected)} />
                <ReportMetric label="Total recebido" value={formatCurrency(summary.received)} />
                <ReportMetric label="Total em aberto" value={formatCurrency(summary.open)} tone={summary.open > 0 ? "warning" : "success"} />
                <ReportMetric label="Quantidade de reembolsos" value={String(summary.count)} />
                <ReportMetric label="Quantidade de pessoas" value={String(summary.personCount)} />
                <ReportMetric label="Maior valor em aberto" value={formatCurrency(summary.largestOpen)} tone={summary.largestOpen > 0 ? "warning" : "neutral"} />
                <ReportMetric label="Próximo recebimento previsto" value={summary.nextExpectedDate ? formatDate(summary.nextExpectedDate) : "-"} />
                <ReportMetric label="Percentual recebido" value={`${summary.receivedPercentage.toFixed(1)}%`} tone={summary.receivedPercentage >= 80 ? "success" : "neutral"} />
              </section>

              <section className="mt-7 space-y-5">
                {groups.map((group) => (
                  <div key={group.person.id} className="report-person-group rounded-lg border border-ink-950/10 bg-white">
                    <div className="report-person-header border-b border-ink-950/10 bg-slate-50 px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-base font-semibold text-ink-950">{group.person.name}</h3>
                          <p className="mt-1 text-xs font-medium uppercase tracking-[0.12em] text-ink-600">{group.statusLabel}</p>
                        </div>
                        <div className="grid gap-x-4 gap-y-1 text-right text-xs text-ink-600 sm:grid-cols-4">
                          <p><strong className="block text-ink-950">{formatCurrency(group.summary.expected)}</strong> esperado</p>
                          <p><strong className="block text-ink-950">{formatCurrency(group.summary.received)}</strong> recebido</p>
                          <p><strong className="block text-ink-950">{formatCurrency(group.summary.open)}</strong> em aberto</p>
                          <p><strong className="block text-ink-950">{group.summary.count}</strong> itens</p>
                        </div>
                      </div>
                    </div>

                    <table className="report-table w-full table-fixed border-collapse text-left text-sm">
                      <thead>
                        <tr className="border-b border-ink-950/10 text-xs uppercase tracking-[0.12em] text-ink-600">
                          <th className="w-[15%] px-4 py-3 font-semibold">Data prevista</th>
                          <th className="w-[40%] px-4 py-3 font-semibold">Descrição</th>
                          <th className="w-[12%] px-4 py-3 text-right font-semibold">Esperado</th>
                          <th className="w-[12%] px-4 py-3 text-right font-semibold">Recebido</th>
                          <th className="w-[12%] px-4 py-3 text-right font-semibold">Em aberto</th>
                          <th className="w-[9%] px-4 py-3 font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-ink-950/10">
                        {group.rows.map((reimbursement) => {
                          const openAmount = getOpenAmount(reimbursement);
                          const category = categories.find((item) => item.id === reimbursement.category_id);
                          const late = isLateReimbursement(reimbursement);

                          return (
                            <tr key={reimbursement.id} className={late ? "report-row-late bg-amberRisk-100/45" : ""}>
                              <td className="px-4 py-3 align-top text-ink-600">
                                <span className={late ? "font-semibold text-amberRisk-500" : ""}>{formatDate(reimbursement.expected_date)}</span>
                                {reimbursement.received_date ? (
                                  <span className="mt-1 block text-xs text-ink-600">Recebido: {formatDate(reimbursement.received_date)}</span>
                                ) : null}
                              </td>
                              <td className="px-4 py-3 align-top">
                                <p className="font-semibold text-ink-950">{reimbursement.description ?? "Reembolso sem descrição"}</p>
                                <div className="report-description-meta mt-1 flex flex-wrap items-center gap-2 text-xs leading-5 text-ink-600">
                                  <CategoryBadge category={category} />
                                  <span>Vínculo: {getLinkedLabel(reimbursement, transactions, accounts, income, invoices, cards)}</span>
                                </div>
                                {reimbursement.notes ? (
                                  <p className="report-description-meta mt-1 text-xs leading-5 text-ink-600">Obs.: {reimbursement.notes}</p>
                                ) : null}
                              </td>
                              <td className="report-money px-4 py-3 text-right align-top font-semibold text-ink-950">{formatCurrency(Number(reimbursement.expected_amount))}</td>
                              <td className="report-money px-4 py-3 text-right align-top text-ink-600">{formatCurrency(Number(reimbursement.received_amount))}</td>
                              <td className="report-money px-4 py-3 text-right align-top font-semibold text-ink-950">{formatCurrency(openAmount)}</td>
                              <td className="report-status px-4 py-3 align-top">
                                <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${late ? "bg-amberRisk-100 text-amberRisk-500" : "bg-ink-950/5 text-ink-600"}`}>
                                  {late ? "Atrasado" : optionLabel(reimbursementStatusOptions, reimbursement.status)}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}
              </section>
            </>
          )}

          <footer className="report-footer mt-8 border-t border-ink-950/10 pt-4 text-xs leading-5 text-ink-600">
            Hub VZ · Relatório gerado em {formatDateTime(generatedAt)} · Reembolsos são dinheiro vinculado, não renda livre.
          </footer>
        </article>
      </div>
    </Modal>
  );
}

function ReportMetric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "warning";
}) {
  const toneClass =
    tone === "success"
      ? "border-mint-500/30 bg-mint-100 text-mint-600"
      : tone === "warning"
        ? "border-amberRisk-500/30 bg-amberRisk-100 text-amberRisk-500"
        : "border-ink-950/10 bg-slate-50 text-ink-950";

  return (
    <div className={`report-metric rounded-md border px-3 py-2 ${toneClass}`}>
      <p className="report-metric-label text-[10px] font-semibold uppercase tracking-[0.08em] opacity-80">{label}</p>
      <p className="report-metric-value mt-1 text-base font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function buildReimbursementPrintDocument(reportHtml: string) {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Hub VZ - Relatório de Reembolsos</title>
    <style>
      @page {
        size: A4;
        margin: 12mm;
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        margin: 0;
        min-height: auto;
        overflow: visible;
        background: #ffffff;
        color: #111827;
        font-family: Arial, Helvetica, sans-serif;
      }

      body {
        width: 100%;
        font-size: 9pt;
        line-height: 1.35;
      }

      .reimbursement-report {
        width: 100%;
        margin: 0;
        padding: 0;
        border: 0;
        box-shadow: none;
        background: #ffffff;
      }

      .report-header {
        padding-bottom: 10pt;
        border-bottom: 1px solid #d1d5db;
      }

      .report-header > div {
        display: flex;
        justify-content: space-between;
        gap: 12pt;
      }

      .report-header p,
      .report-header h2 {
        margin: 0;
      }

      .report-header p:first-child {
        color: #087f74;
        font-size: 7pt;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .report-header h2 {
        margin-top: 5pt;
        color: #111827;
        font-size: 17pt;
        line-height: 1.1;
      }

      .report-header h2 + p {
        margin-top: 6pt;
        color: #4b5563;
        font-size: 8pt;
      }

      .report-header .rounded-md {
        align-self: flex-start;
        border: 1px solid #99f6e4;
        border-radius: 6pt;
        background: #ccfbf1;
        color: #0f766e;
        padding: 5pt 7pt;
        font-size: 6.5pt;
        font-weight: 700;
        text-transform: uppercase;
        white-space: nowrap;
      }

      .report-summary {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 5pt;
        margin-top: 10pt;
      }

      .report-metric {
        min-height: 34pt;
        break-inside: avoid;
        page-break-inside: avoid;
        border: 1px solid #d1d5db;
        border-radius: 5pt;
        background: #f8fafc;
        padding: 5pt 6pt;
        color: #111827;
      }

      .report-metric-label {
        margin: 0;
        font-size: 6.3pt;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        white-space: nowrap;
      }

      .report-metric-value {
        margin: 2pt 0 0;
        font-size: 10.5pt;
        font-weight: 700;
        line-height: 1.15;
        white-space: nowrap;
      }

      .report-person-group {
        margin-top: 10pt;
        break-inside: avoid;
        page-break-inside: avoid;
        border: 1px solid #d1d5db;
        border-radius: 6pt;
        overflow: hidden;
      }

      .report-person-header {
        border-bottom: 1px solid #d1d5db;
        background: #f8fafc;
        padding: 7pt 8pt;
      }

      .report-person-header > div {
        display: flex;
        justify-content: space-between;
        gap: 10pt;
      }

      .report-person-header h3 {
        margin: 0;
        font-size: 10pt;
        color: #111827;
      }

      .report-person-header h3 + p {
        margin: 3pt 0 0;
        color: #4b5563;
        font-size: 6.7pt;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .report-person-header .grid {
        display: grid;
        grid-template-columns: repeat(4, max-content);
        gap: 4pt 10pt;
        text-align: right;
        color: #4b5563;
        font-size: 6.8pt;
        white-space: nowrap;
      }

      .report-person-header strong {
        display: block;
        color: #111827;
        font-size: 8pt;
      }

      .report-table {
        width: 100%;
        table-layout: fixed;
        border-collapse: collapse;
        font-size: 7.7pt;
      }

      .report-table thead {
        display: table-header-group;
      }

      .report-table tr {
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .report-table th,
      .report-table td {
        padding: 5pt 6pt;
        border-bottom: 1px solid #e5e7eb;
        vertical-align: top;
        word-break: break-word;
      }

      .report-table th {
        color: #4b5563;
        font-size: 6.4pt;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }

      .report-table td p {
        margin: 0;
      }

      .report-description-meta {
        margin-top: 2pt;
        color: #4b5563;
        font-size: 7pt;
        line-height: 1.35;
      }

      .hub-category-badge {
        display: inline-flex;
        align-items: center;
        gap: 3pt;
        max-width: 90pt;
        border: 1px solid transparent;
        border-radius: 999px;
        background: var(--category-color, #e2e8f0);
        color: var(--category-text, #0f172a);
        padding: 1.5pt 4pt;
        font-size: 6.6pt;
        font-weight: 700;
        white-space: nowrap;
      }

      .hub-category-badge svg {
        width: 7pt;
        height: 7pt;
        flex: 0 0 auto;
      }

      .report-money,
      .report-status {
        white-space: nowrap;
      }

      .report-money {
        text-align: right;
      }

      .report-status span {
        display: inline-flex;
        border-radius: 999px;
        background: #f3f4f6;
        color: #374151;
        padding: 2pt 4pt;
        font-size: 6.8pt;
        font-weight: 700;
        white-space: nowrap;
      }

      .report-row-late {
        background: #fff7ed;
      }

      .report-footer {
        margin-top: 12pt;
        padding-top: 7pt;
        border-top: 1px solid #d1d5db;
        color: #4b5563;
        font-size: 7pt;
      }

      .report-actions {
        display: none !important;
      }

      .rounded-lg,
      .rounded-md {
        border-radius: 6pt;
      }

      .border {
        border-style: solid;
      }

      @media print {
        html,
        body {
          width: auto;
          height: auto;
        }

        .reimbursement-report {
          break-after: auto;
          page-break-after: auto;
        }
      }
    </style>
  </head>
  <body>${reportHtml}</body>
</html>`;
}

function getLinkedLabel(
  reimbursement: ReimbursementRow,
  transactions: ReimbursementTransaction[],
  accounts: ReimbursementAccount[],
  income: ReimbursementIncome[],
  invoices: ReimbursementInvoice[] = [],
  cards: ReimbursementCard[] = [],
) {
  if (reimbursement.credit_card_invoice_id) {
    const invoice = invoices.find((item) => item.id === reimbursement.credit_card_invoice_id);
    const card = cards.find((item) => item.id === invoice?.credit_card_id);

    if (invoice) {
      return `Fatura ${card?.name ?? "cartão"} ${invoice.reference_month.slice(0, 7)}`;
    }
  }

  if (reimbursement.credit_card_transaction_id) {
    const transaction = transactions.find((item) => item.id === reimbursement.credit_card_transaction_id);
    return transaction ? `Lançamento: ${transaction.description}` : "Lançamento de cartão";
  }

  if (reimbursement.account_payable_id) {
    const account = accounts.find((item) => item.id === reimbursement.account_payable_id);
    return account ? `Conta: ${account.title}` : "Conta vinculada";
  }

  if (reimbursement.income_source_id) {
    const incomeSource = income.find((item) => item.id === reimbursement.income_source_id);
    return incomeSource ? `Receita: ${incomeSource.name}` : "Receita relacionada";
  }

  return "Manual";
}

function formatInvoiceOptionLabel(invoice: ReimbursementInvoice, cards: ReimbursementCard[]) {
  const card = cards.find((item) => item.id === invoice.credit_card_id);
  return [
    card?.name ?? "Cartão",
    invoice.reference_month.slice(0, 7),
    `vence ${formatDate(invoice.due_date)}`,
    optionLabel(invoiceStatusOptions, invoice.status),
    formatCurrency(Number(invoice.total_amount)),
  ].join(" · ");
}

function getLinkedTone(reimbursement: ReimbursementRow) {
  if (reimbursement.credit_card_transaction_id) return "info";
  if (reimbursement.account_payable_id) return "warning";
  if (reimbursement.income_source_id) return "success";
  return "neutral";
}

function summarizeReportReimbursements(rows: ReimbursementRow[]) {
  const expected = rows.reduce((sum, item) => sum + Number(item.expected_amount), 0);
  const received = rows.reduce((sum, item) => sum + Number(item.received_amount), 0);
  const open = rows.reduce((sum, item) => sum + getOpenAmount(item), 0);
  const largestOpen = rows.reduce((max, item) => Math.max(max, getOpenAmount(item)), 0);
  const personCount = new Set(rows.map((item) => item.person_id)).size;
  const nextExpectedDate =
    rows
      .filter((item) => getOpenAmount(item) > 0 && item.expected_date)
      .sort((a, b) => String(a.expected_date).localeCompare(String(b.expected_date)))[0]?.expected_date ?? null;
  const receivedPercentage = expected > 0 ? (received / expected) * 100 : 0;

  return { expected, received, open, count: rows.length, personCount, largestOpen, nextExpectedDate, receivedPercentage };
}

function groupReimbursementsByPerson(rows: ReimbursementRow[], people: ReimbursementPerson[]) {
  const groups = new Map<string, ReimbursementRow[]>();

  rows.forEach((row) => {
    const current = groups.get(row.person_id) ?? [];
    current.push(row);
    groups.set(row.person_id, current);
  });

  return Array.from(groups.entries())
    .map(([personId, groupRows]) => {
      const person = people.find((item) => item.id === personId) ?? { id: personId, name: "Pessoa não encontrada" };
      const sortedRows = [...groupRows].sort((a, b) => String(a.expected_date ?? "").localeCompare(String(b.expected_date ?? "")));
      const summary = summarizePersonGroup(sortedRows);

      return {
        person,
        rows: sortedRows,
        summary,
        statusLabel: getPersonGroupStatusLabel(sortedRows),
      };
    })
    .sort((a, b) => b.summary.open - a.summary.open || a.person.name.localeCompare(b.person.name));
}

function summarizePersonGroup(rows: ReimbursementRow[]) {
  const expected = rows.reduce((sum, item) => sum + Number(item.expected_amount), 0);
  const received = rows.reduce((sum, item) => sum + Number(item.received_amount), 0);
  const open = rows.reduce((sum, item) => sum + getOpenAmount(item), 0);

  return { expected, received, open, count: rows.length };
}

function getPersonGroupStatusLabel(rows: ReimbursementRow[]) {
  if (rows.some(isLateReimbursement)) return "Com itens atrasados";
  if (rows.some((item) => getOpenAmount(item) > 0)) return "Com valores em aberto";
  return "Tudo recebido ou encerrado";
}

function getOpenAmount(reimbursement: ReimbursementRow) {
  if (["received", "cancelled", "forgiven"].includes(reimbursement.status)) return 0;
  return Math.max(Number(reimbursement.expected_amount) - Number(reimbursement.received_amount), 0);
}

function isLateReimbursement(reimbursement: ReimbursementRow) {
  if (["received", "cancelled", "forgiven"].includes(reimbursement.status)) return false;
  if (reimbursement.status === "late") return true;
  if (!reimbursement.expected_date) return false;

  return reimbursement.expected_date < new Date().toISOString().slice(0, 10);
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatPeriodLabel(period: PeriodValue) {
  if (period.preset === "all") return "Todos os períodos";
  if (period.startDate && period.endDate) return `${formatDate(period.startDate)} até ${formatDate(period.endDate)}`;
  return "Período selecionado";
}
