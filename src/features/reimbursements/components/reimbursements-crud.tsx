"use client";

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import {
  buildPersonDebtSummaries,
  filterPersonDebtSummaries,
  getPersonDebtStatusLabel,
  getPersonDebtStatusTone,
  isReimbursementLateByDate,
  type PersonDebtViewMode,
} from "@/features/reimbursements/debt-summary";
import {
  archiveReimbursement,
  createReimbursement,
  generateLinkedEntryFromReimbursement,
  generateRecurringReimbursements,
  listReimbursements,
  listReimbursementSupportData,
  renegotiateReimbursements,
  syncReimbursementFinancialLink,
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
  type ReimbursementFinancialLinkMode,
  type ReimbursementIncome,
  type ReimbursementInvoice,
  type ReimbursementPerson,
  type ReimbursementRenegotiationValues,
  type ReimbursementRow,
  type ReimbursementTransaction,
} from "@/features/reimbursements/types";
import { ActionButton, BulkActionsBar, CategoryBadge, CategorySelect, CrudFeedback, FieldShell, inputClassName, Modal, QuickEditInput, QuickEditSelect, RowSelectionHint, shouldToggleRowSelection, TextBadge, TitleButton, ViewPreferenceActions } from "@/features/shared/crud-ui";
import { formatCurrency, formatDate } from "@/features/shared/format";
import { invoiceStatusOptions, optionLabel, reimbursementStatusOptions } from "@/features/shared/options";
import { PeriodFilter } from "@/features/shared/period-filter";
import { isAnyDateInPeriod, parsePeriodSearchParams, type PeriodValue } from "@/features/shared/period";
import { getQuickTableEditPreference } from "@/features/shared/quick-edit";
import type { FeedbackState } from "@/features/shared/types";
import { clearViewPreference, loadViewPreference, preferenceRecord, preferenceString, preferenceText, saveViewPreference } from "@/features/shared/view-preferences";
import { createClient } from "@/lib/supabase/client";

type ModalState = { mode: "create"; reimbursement: null } | { mode: "edit"; reimbursement: ReimbursementRow } | null;
type LinkModalState = { reimbursement: ReimbursementRow } | null;
type RenegotiationModalState = { reimbursements: ReimbursementRow[]; person: ReimbursementPerson | null } | null;
type ReimbursementsViewPreference = {
  search?: string;
  personFilter?: string;
  statusFilter?: string;
  linkedFilter?: string;
  categoryFilter?: string;
  peopleSummaryView?: PersonDebtViewMode;
  period?: PeriodValue;
};

const reimbursementSummaryViews = ["open_period", "late", "all_debt", "all_history", "hide_settled"] as const;
const reimbursementsDefaultViewPreference: Required<ReimbursementsViewPreference> = {
  search: "",
  personFilter: "all",
  statusFilter: "all",
  linkedFilter: "all",
  categoryFilter: "all",
  peopleSummaryView: "open_period",
  period: parsePeriodSearchParams({}),
};

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
  const [renegotiationModal, setRenegotiationModal] = useState<RenegotiationModalState>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [bulkPersonId, setBulkPersonId] = useState("");
  const [allowQuickTableEdit, setAllowQuickTableEdit] = useState(false);
  const [peopleSummaryView, setPeopleSummaryView] = useState<PersonDebtViewMode>("open_period");
  const [generatedInvoiceLink, setGeneratedInvoiceLink] = useState<{ invoiceId: string; transactionId?: string } | null>(null);

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

  const peopleSummary = useMemo(
    () => buildPersonDebtSummaries(people, periodReimbursements),
    [people, periodReimbursements],
  );

  const visiblePeopleSummary = useMemo(() => {
    return filterPersonDebtSummaries(peopleSummary, peopleSummaryView);
  }, [peopleSummary, peopleSummaryView]);

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

  useEffect(() => {
    if (!userId) return;
    const preference = loadViewPreference<ReimbursementsViewPreference>("reimbursements", userId);
    if (!preference) return;

    setSearch(preferenceText(preference.search));
    setPersonFilter(preferenceText(preference.personFilter, "all"));
    setStatusFilter(preferenceText(preference.statusFilter, "all"));
    setLinkedFilter(preferenceText(preference.linkedFilter, "all"));
    setCategoryFilter(preferenceText(preference.categoryFilter, "all"));
    setPeopleSummaryView(preferenceString(preference.peopleSummaryView, reimbursementSummaryViews, "open_period"));
    setPeriod(preferenceRecord(preference.period, reimbursementsDefaultViewPreference.period));
  }, [userId]);

  function handleSaveViewPreference() {
    const saved = saveViewPreference("reimbursements", userId, {
      search,
      personFilter,
      statusFilter,
      linkedFilter,
      categoryFilter,
      peopleSummaryView,
      period,
    });
    setFeedback({
      type: saved ? "success" : "error",
      message: saved ? "Visualização padrão de reembolsos salva." : "Não foi possível salvar a visualização padrão.",
    });
  }

  function handleRestoreViewPreference() {
    clearViewPreference("reimbursements", userId);
    setSearch(reimbursementsDefaultViewPreference.search);
    setPersonFilter(reimbursementsDefaultViewPreference.personFilter);
    setStatusFilter(reimbursementsDefaultViewPreference.statusFilter);
    setLinkedFilter(reimbursementsDefaultViewPreference.linkedFilter);
    setCategoryFilter(reimbursementsDefaultViewPreference.categoryFilter);
    setPeopleSummaryView(reimbursementsDefaultViewPreference.peopleSummaryView);
    setPeriod(reimbursementsDefaultViewPreference.period);
    setFeedback({ type: "success", message: "Visualização padrão de reembolsos restaurada." });
  }

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

      const reimbursementForSync =
        modal?.mode === "edit"
          ? {
              ...result.data,
              credit_card_transaction_id: modal.reimbursement.credit_card_transaction_id,
              credit_card_invoice_id: modal.reimbursement.credit_card_invoice_id,
            }
          : result.data;

      const linkResult = await syncReimbursementFinancialLink(client, userId, reimbursementForSync, values);
      if (linkResult.error) {
        console.error("Erro técnico ao sincronizar vínculo financeiro do reembolso:", linkResult.error);
        setFeedback({ type: "error", message: linkResult.error.message });
        return;
      }

      if (linkResult.invoiceId) {
        setGeneratedInvoiceLink({ invoiceId: linkResult.invoiceId, transactionId: linkResult.transactionId ?? undefined });
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
    setGeneratedInvoiceLink(null);

    try {
      const result = await generateLinkedEntryFromReimbursement(createClient(), userId, linkModal.reimbursement, values);

      if (result.error) {
        setFeedback({ type: "error", message: result.error.message });
        return;
      }

      if (values.target === "invoice" && result.invoiceId) {
        setGeneratedInvoiceLink({ invoiceId: result.invoiceId, transactionId: result.transactionId });
      }
      setFeedback({
        type: "success",
        message:
          values.target === "account"
            ? "Conta vinculada gerada."
            : "Lançamento de fatura vinculado gerado e confirmado na fatura selecionada.",
      });
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
    if (!userId) return;
    if (!window.confirm("Arquivar este reembolso?")) return;
    const { error } = await archiveReimbursement(createClient(), reimbursement.id, userId);
    if (error) setFeedback({ type: "error", message: error.message });
    else {
      setFeedback({ type: "success", message: "Reembolso arquivado." });
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

    if (!userId) return;
    if (!window.confirm(`Arquivar ${ids.length} reembolso(s) selecionado(s)?`)) {
      return;
    }

    setDeletingSelected(true);
    setFeedback(null);

    try {
      const client = createClient();
      const results = await Promise.all(ids.map((id) => archiveReimbursement(client, id, userId)));
      const failed = results.find((result) => result.error);

      if (failed?.error) {
        console.error("Erro técnico ao excluir reembolsos selecionados:", failed.error);
        setFeedback({ type: "error", message: "Não foi possível arquivar todos os itens selecionados." });
        return;
      }

      setSelectedIds(new Set());
      setFeedback({ type: "success", message: `${ids.length} reembolso(s) arquivado(s).` });
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao arquivar reembolsos selecionados:", error);
      setFeedback({ type: "error", message: "Não foi possível arquivar os itens selecionados." });
    } finally {
      setDeletingSelected(false);
    }
  }

  function handleOpenRenegotiation() {
    const selected = reimbursements.filter((item) => selectedIds.has(item.id));
    if (selected.length === 0) {
      setFeedback({ type: "error", message: "Selecione ao menos um reembolso para renegociar." });
      return;
    }

    const personIds = new Set(selected.map((item) => item.person_id));
    if (personIds.size > 1) {
      setFeedback({ type: "error", message: "Selecione apenas reembolsos da mesma pessoa para renegociar." });
      return;
    }

    const invalid = selected.find(
      (item) =>
        !["expected", "partial", "late"].includes(item.status) ||
        getOpenAmount(item) <= 0 ||
        item.renegotiated_into_id ||
        item.status === "renegotiated",
    );
    if (invalid) {
      setFeedback({ type: "error", message: "Só é possível renegociar reembolsos em aberto, parciais ou atrasados que ainda não foram renegociados." });
      return;
    }

    setRenegotiationModal({
      reimbursements: selected,
      person: people.find((person) => person.id === selected[0].person_id) ?? null,
    });
  }

  async function handleRenegotiationSubmit(values: ReimbursementRenegotiationValues) {
    if (!userId || !renegotiationModal) {
      setFeedback({ type: "error", message: "Sessão não encontrada." });
      return;
    }

    setSaving(true);
    setFeedback(null);

    try {
      const result = await renegotiateReimbursements(
        createClient(),
        userId,
        renegotiationModal.reimbursements,
        values,
      );

      if (result.error) {
        setFeedback({ type: "error", message: result.error.message });
        return;
      }

      setFeedback({ type: "success", message: `Renegociação criada para ${result.count} título(s).` });
      setRenegotiationModal(null);
      setSelectedIds(new Set());
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao renegociar reembolsos:", error);
      setFeedback({ type: "error", message: "Não foi possível criar a renegociação dos reembolsos selecionados." });
    } finally {
      setSaving(false);
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
      {generatedInvoiceLink ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-mint-500/35 bg-mint-50 px-4 py-3 text-sm text-ink-800 shadow-sm dark:border-mint-400/35 dark:bg-mint-950/30 dark:text-slate-100">
          <span>Lançamento vinculado à fatura selecionada.</span>
          <Link className="font-semibold text-mint-700 hover:text-mint-800 dark:text-mint-200 dark:hover:text-mint-100" href={`/dashboard/invoices/${generatedInvoiceLink.invoiceId}`}>
            Abrir fatura
          </Link>
        </div>
      ) : null}

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

      <SectionCard title="Saldo devedor por pessoa" description="Por padrão, mostra apenas pessoas com valores em aberto no período selecionado, atrasos, parcelas parciais ou títulos previstos dentro deste recorte.">
        <div className="mb-4 flex flex-wrap gap-2">
          {[
            { value: "open_period", label: "Em aberto no período" },
            { value: "late", label: "Atrasados" },
            { value: "all_debt", label: "Todos com saldo devedor" },
            { value: "all_history", label: "Todos com histórico" },
            { value: "hide_settled", label: "Ocultar quitados" },
          ].map((option) => (
            <ActionButton
              key={option.value}
              type="button"
              variant={peopleSummaryView === option.value ? "primary" : "secondary"}
              onClick={() => setPeopleSummaryView(option.value as PersonDebtViewMode)}
            >
              {option.label}
            </ActionButton>
          ))}
        </div>
        {peopleSummary.length === 0 ? (
          <EmptyState title="Nenhuma pessoa com reembolso" description="Quando houver reembolsos, o resumo por pessoa aparecerá aqui." />
        ) : visiblePeopleSummary.length === 0 ? (
          <EmptyState title="Nenhuma pessoa neste filtro" description="Troque a visualização para ver outros históricos de reembolso." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visiblePeopleSummary.map((item) => (
              <button
                key={item.person.id}
                type="button"
                className={`flex h-full flex-col rounded-xl border bg-white p-4 text-left text-ink-950 shadow-sm transition hover:border-mint-500 hover:bg-mint-50/60 hover:shadow-md dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800/90 ${
                  personFilter === item.person.id
                    ? "border-mint-500 ring-2 ring-mint-500/25 dark:border-mint-400 dark:ring-mint-400/25"
                    : "border-slate-300 dark:border-slate-700"
                }`}
                onClick={() => setPersonFilter(item.person.id)}
                aria-pressed={personFilter === item.person.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink-950 dark:text-slate-100">{item.person.name}</p>
                    <p className="mt-1 text-sm text-ink-600 dark:text-slate-300">
                      Status geral do saldo desta pessoa.
                    </p>
                  </div>
                  <TextBadge tone={getPersonDebtStatusTone(item.status)}>{getPersonDebtStatusLabel(item.status)}</TextBadge>
                </div>
                <div className="mt-4 grid gap-2 text-sm text-ink-600 dark:text-slate-300">
                  <p>Total esperado: <strong className="text-ink-950 dark:text-slate-100">{formatCurrency(item.totalExpected)}</strong></p>
                  <p>Recebido: <strong className="text-ink-950 dark:text-slate-100">{formatCurrency(item.received)}</strong></p>
                  <p>Em aberto: <strong className={item.open > 0 ? "text-amber-700 dark:text-amber-300" : "text-ink-950 dark:text-slate-100"}>{formatCurrency(item.open)}</strong></p>
                  <p>Atrasado: <strong className={item.late > 0 ? "text-red-600 dark:text-red-300" : "text-ink-950 dark:text-slate-100"}>{formatCurrency(item.late)}</strong></p>
                  <p>Quantidade de títulos: <strong className="text-ink-950 dark:text-slate-100">{item.totalCount}</strong></p>
                  <p>Próxima data prevista: <strong className="text-ink-950 dark:text-slate-100">{item.nextExpectedDate ? formatDate(item.nextExpectedDate) : "-"}</strong></p>
                  <p className="text-xs font-medium text-ink-600 dark:text-slate-300">
                    {item.totalCount} titulo(s) · {item.openCount} aberto(s) · {item.lateCount} atrasado(s)
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Filtros">
        {selectedPerson ? (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-mint-500/30 bg-mint-50 px-3 py-2 text-sm text-ink-700 dark:border-mint-400/30 dark:bg-mint-950/30 dark:text-slate-100">
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
        <div className="mt-4">
          <ViewPreferenceActions onSave={handleSaveViewPreference} onRestore={handleRestoreViewPreference} />
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
            <ActionButton
              type="button"
              variant="secondary"
              disabled={bulkUpdating || deletingSelected}
              onClick={handleOpenRenegotiation}
            >
              Renegociar selecionados
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
                {filteredReimbursements.map((reimbursement) => {
                  const isLate = isLateReimbursement(reimbursement);

                  return (
                  <tr
                    key={reimbursement.id}
                    onClick={(event) => {
                      if (!shouldToggleRowSelection(event)) return;
                      const next = new Set(selectedIds);
                      if (next.has(reimbursement.id)) next.delete(reimbursement.id);
                      else next.add(reimbursement.id);
                      setSelectedIds(next);
                    }}
                    className={`cursor-default ${isLate ? "bg-amberRisk-100/40" : ""}`}
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
                      ) : (
                        <span className={isLate ? "font-semibold text-amberRisk-500" : ""}>
                          {formatDate(reimbursement.expected_date)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      <div className="flex flex-wrap items-center gap-2">
                        <QuickEditSelect value={reimbursement.status} options={reimbursementStatusOptions} onCommit={(value) => void handleStatusUpdate(reimbursement, value)} />
                        {isLate && reimbursement.status !== "late" ? <TextBadge tone="danger">Atrasado pela data</TextBadge> : null}
                        {reimbursement.renegotiated_into_id ? <TextBadge tone="neutral">Renegociado</TextBadge> : null}
                        {reimbursement.renegotiation_source_ids.length > 0 ? <TextBadge tone="info">Originado de renegociação</TextBadge> : null}
                      </div>
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
                      <div className="flex flex-col gap-1">
                        <TextBadge tone={getLinkedTone(reimbursement)}>
                          {getLinkedLabel(reimbursement, transactions, accounts, income)}
                        </TextBadge>
                        {reimbursement.renegotiated_at ? (
                          <span className="text-xs text-ink-500">
                            Renegociado em {formatDate(reimbursement.renegotiated_at.slice(0, 10))}
                          </span>
                        ) : null}
                      </div>
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
                        <ActionButton variant="danger" onClick={() => void handleDelete(reimbursement)}>Arquivar</ActionButton>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </SectionCard>

      {modal ? (
        <ReimbursementModal
          accounts={accounts}
          cards={cards}
          categories={categories}
          income={income}
          invoices={invoices}
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
      {renegotiationModal ? (
        <RenegotiationModal
          modal={renegotiationModal}
          saving={saving}
          onClose={() => setRenegotiationModal(null)}
          onSubmit={(values) => void handleRenegotiationSubmit(values)}
        />
      ) : null}
      {reportOpen ? (
        <ReimbursementReportModal
          allReimbursements={reimbursements}
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
  cards,
  categories,
  income,
  invoices,
  modal,
  people,
  saving,
  transactions,
  onClose,
  onSubmit,
}: {
  accounts: ReimbursementAccount[];
  cards: ReimbursementCard[];
  categories: ReimbursementCategory[];
  income: ReimbursementIncome[];
  invoices: ReimbursementInvoice[];
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
  const currentTransaction =
    modal?.mode === "edit" && modal.reimbursement.credit_card_transaction_id
      ? transactions.find((transaction) => transaction.id === modal.reimbursement.credit_card_transaction_id) ?? null
      : null;
  const currentInvoice =
    modal?.mode === "edit" && modal.reimbursement.credit_card_invoice_id
      ? invoices.find((invoice) => invoice.id === modal.reimbursement.credit_card_invoice_id) ?? null
      : null;
  const currentCard =
    currentTransaction?.credit_card_id
      ? cards.find((card) => card.id === currentTransaction.credit_card_id) ?? null
      : currentInvoice?.credit_card_id
        ? cards.find((card) => card.id === currentInvoice.credit_card_id) ?? null
        : null;
  const selectedCardId = values.financial_link_card_id || currentCard?.id || "";
  const selectedInvoiceId = values.financial_link_invoice_id || currentInvoice?.id || "";
  const filteredInvoices = selectedCardId
    ? invoices.filter((invoice) => invoice.credit_card_id === selectedCardId)
    : [];
  const filteredTransactions = selectedInvoiceId
    ? transactions.filter((transaction) => transaction.invoice_id === selectedInvoiceId)
    : [];
  const selectedFinancialTransaction =
    values.financial_link_transaction_id
      ? transactions.find((transaction) => transaction.id === values.financial_link_transaction_id) ?? null
      : null;
  const selectedTransactionUsedByOtherReimbursement = Boolean(
    selectedFinancialTransaction?.reimbursement_id &&
      selectedFinancialTransaction.reimbursement_id !== modal?.reimbursement?.id,
  );

  useEffect(() => {
    if (modal?.mode !== "edit" || !currentTransaction) return;

    setValues((current) => ({
      ...current,
      financial_link_card_id: current.financial_link_card_id || currentTransaction.credit_card_id || currentCard?.id || "",
      financial_link_invoice_id: current.financial_link_invoice_id || currentTransaction.invoice_id || modal.reimbursement.credit_card_invoice_id || "",
      financial_link_transaction_id: current.financial_link_transaction_id || currentTransaction.id,
      financial_link_new_description: current.financial_link_new_description || currentTransaction.description || current.description,
      financial_link_new_amount:
        current.financial_link_new_amount && current.financial_link_new_amount !== "0"
          ? current.financial_link_new_amount
          : String(currentTransaction.amount ?? current.expected_amount),
      financial_link_new_date: current.financial_link_new_date || currentTransaction.transaction_date || current.expected_date,
      financial_link_new_category_id: current.financial_link_new_category_id || currentTransaction.category_id || current.category_id,
    }));
  }, [currentCard?.id, currentTransaction, modal]);

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
          const nextValues: ReimbursementFormValues = {
            ...values,
            credit_card_transaction_id:
              values.financial_link_mode === "keep_current"
                ? currentTransaction?.id ?? values.credit_card_transaction_id
                : values.financial_link_mode === "link_existing"
                  ? values.financial_link_transaction_id
                  : "",
            credit_card_invoice_id:
              values.financial_link_mode === "keep_current"
                ? currentInvoice?.id ?? values.credit_card_invoice_id
                : values.financial_link_mode === "link_existing"
                  ? values.financial_link_invoice_id
                  : "",
            account_payable_id:
              values.financial_link_mode === "link_existing" || values.financial_link_mode === "create_invoice_transaction"
                ? ""
                : values.account_payable_id,
            income_source_id:
              values.financial_link_mode === "link_existing" || values.financial_link_mode === "create_invoice_transaction"
                ? ""
                : values.income_source_id,
          };

          onSubmit(nextValues);
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
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950 shadow-sm dark:border-amber-400/50 dark:bg-amber-950/35 dark:text-amber-100 md:col-span-2">
              Reembolsos recorrentes geram novas cobranças mensais sem transformar esse dinheiro em renda livre.
            </p>
          </>
        ) : null}
        <div className="rounded-lg border border-slate-300 bg-slate-50 p-4 text-ink-900 shadow-sm dark:border-slate-600 dark:bg-slate-950/70 dark:text-slate-100 md:col-span-2">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold text-ink-950 dark:text-slate-100">Vínculo financeiro</h3>
            <p className="text-sm text-ink-700 dark:text-slate-200">
              Use o fluxo cartão - fatura - lançamento para evitar vínculo errado e manter o total da fatura consistente.
            </p>
          </div>

          {currentTransaction ? (
            <div className="mt-4 rounded-md border border-mint-500/35 bg-mint-50 px-4 py-3 shadow-sm dark:border-mint-400/40 dark:bg-mint-950/35">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1 text-sm text-ink-700 dark:text-slate-200">
                  <p><strong className="text-ink-950 dark:text-slate-50">Cartão:</strong> {currentCard ? getCardLabel(currentCard) : "-"}</p>
                  <p><strong className="text-ink-950 dark:text-slate-50">Fatura:</strong> {currentInvoice ? formatInvoiceOptionLabel(currentInvoice, cards) : "-"}</p>
                  <p><strong className="text-ink-950 dark:text-slate-50">Lançamento:</strong> {currentTransaction.description} · {formatDate(currentTransaction.transaction_date)} · {formatCurrency(Number(currentTransaction.amount))}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {currentInvoice ? (
                    <Link className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-ink-800 hover:border-mint-500 hover:text-mint-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-mint-400 dark:hover:text-mint-200" href={`/dashboard/invoices/${currentInvoice.id}`}>
                      Abrir fatura
                    </Link>
                  ) : null}
                  {currentInvoice && currentTransaction ? (
                    <Link className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-ink-800 hover:border-mint-500 hover:text-mint-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-mint-400 dark:hover:text-mint-200" href={`/dashboard/invoices/${currentInvoice.id}?transaction=${currentTransaction.id}`}>
                      Abrir lançamento
                    </Link>
                  ) : null}
                  <ActionButton
                    type="button"
                    variant="secondary"
                    onClick={() => setValues({ ...values, financial_link_mode: "remove_current" })}
                  >
                    Remover vínculo
                  </ActionButton>
                </div>
              </div>
            </div>
          ) : null}

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <FieldShell label="Modo de vínculo">
              <select
                className={inputClassName}
                value={values.financial_link_mode}
                onChange={(event) =>
                  setValues({
                    ...values,
                    financial_link_mode: event.target.value as ReimbursementFinancialLinkMode,
                  })
                }
              >
                {currentTransaction ? <option value="keep_current">Manter vínculo atual</option> : null}
                <option value="none">Sem vínculo</option>
                <option value="link_existing">Vincular a lançamento existente</option>
                <option value="create_invoice_transaction">Criar lançamento em fatura</option>
                {currentTransaction ? <option value="remove_current">Remover vínculo atual</option> : null}
              </select>
            </FieldShell>
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950 shadow-sm dark:border-amber-400/50 dark:bg-amber-950/35 dark:text-amber-100">
              Não é permitido usar fatura arquivada nem misturar lançamento de outro cartão.
            </div>
          </div>

          {values.financial_link_mode === "link_existing" || values.financial_link_mode === "create_invoice_transaction" ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <FieldShell label="Cartão">
                <select
                  className={inputClassName}
                  value={selectedCardId}
                  onChange={(event) =>
                    setValues({
                      ...values,
                      financial_link_card_id: event.target.value,
                      financial_link_invoice_id: "",
                      financial_link_transaction_id:
                        currentTransaction && values.financial_link_mode === "link_existing" ? currentTransaction.id : "",
                    })
                  }
                >
                  <option value="">
                    {values.financial_link_mode === "create_invoice_transaction"
                      ? "Criar/encontrar automaticamente pela data"
                      : "Selecione"}
                  </option>
                  {cards.map((card) => (
                    <option key={card.id} value={card.id}>
                      {getCardLabel(card)}
                    </option>
                  ))}
                </select>
              </FieldShell>
              <FieldShell label="Fatura">
                <select
                  className={inputClassName}
                  value={selectedInvoiceId}
                  onChange={(event) =>
                    setValues({
                      ...values,
                      financial_link_invoice_id: event.target.value,
                    })
                  }
                >
                  <option value="">Selecione</option>
                  {filteredInvoices.map((invoice) => (
                    <option key={invoice.id} value={invoice.id}>
                      {formatInvoiceOptionLabel(invoice, cards)}
                    </option>
                  ))}
                </select>
              </FieldShell>

              {values.financial_link_mode === "link_existing" ? (
                <>
                  <div className="md:col-span-2">
                    <FieldShell label="Lançamento específico">
                      <select
                        className={inputClassName}
                        value={values.financial_link_transaction_id}
                        onChange={(event) =>
                          setValues({
                            ...values,
                            financial_link_transaction_id: event.target.value,
                            financial_link_allow_reuse: false,
                          })
                        }
                      >
                        <option value="">Selecione</option>
                        {currentTransaction &&
                        values.financial_link_transaction_id === currentTransaction.id &&
                        currentTransaction.invoice_id !== selectedInvoiceId ? (
                          <option value={currentTransaction.id}>
                            Atual: {formatTransactionFinancialOption(currentTransaction, categories)}
                          </option>
                        ) : null}
                        {filteredTransactions.map((transaction) => (
                          <option key={transaction.id} value={transaction.id}>
                            {formatTransactionFinancialOption(transaction, categories)}
                          </option>
                        ))}
                      </select>
                    </FieldShell>
                  </div>
                  {selectedFinancialTransaction ? (
                    <div className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-ink-800 shadow-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 md:col-span-2">
                      {selectedTransactionUsedByOtherReimbursement ? (
                        <>
                          <p className="font-medium text-amber-900 dark:text-amber-200">
                            Este lançamento já está vinculado a outro reembolso.
                          </p>
                          <label className="mt-2 flex items-start gap-2">
                            <input
                              type="checkbox"
                              checked={values.financial_link_allow_reuse}
                              onChange={(event) => setValues({ ...values, financial_link_allow_reuse: event.target.checked })}
                            />
                            <span>Confirmo que desejo substituir o vínculo anterior por este reembolso.</span>
                          </label>
                        </>
                      ) : (
                        <p>Lançamento livre para vínculo. Se você trocar a fatura mantendo o lançamento atual selecionado, o sistema moverá o lançamento para a nova fatura.</p>
                      )}
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <p className="rounded-md border border-mint-500/35 bg-mint-50 px-3 py-2 text-sm font-medium text-ink-800 shadow-sm dark:border-mint-400/35 dark:bg-mint-950/30 dark:text-slate-100 md:col-span-2">
                    Se nenhuma fatura for escolhida, o sistema cria ou encontra automaticamente a fatura correta pelo cartão e data do lançamento.
                  </p>
                  <FieldShell label="Descrição do lançamento">
                    <input
                      className={inputClassName}
                      value={values.financial_link_new_description}
                      onChange={(event) => setValues({ ...values, financial_link_new_description: event.target.value })}
                    />
                  </FieldShell>
                  <FieldShell label="Valor do lançamento">
                    <input
                      min="0"
                      step="0.01"
                      type="number"
                      className={inputClassName}
                      value={values.financial_link_new_amount}
                      onChange={(event) => setValues({ ...values, financial_link_new_amount: event.target.value })}
                    />
                  </FieldShell>
                  <FieldShell label="Data do lançamento">
                    <input
                      type="date"
                      className={inputClassName}
                      value={values.financial_link_new_date}
                      onChange={(event) => setValues({ ...values, financial_link_new_date: event.target.value })}
                    />
                  </FieldShell>
                  <FieldShell label="Categoria do lançamento">
                    <CategorySelect
                      categories={categories}
                      value={values.financial_link_new_category_id}
                      onChange={(category_id) => setValues({ ...values, financial_link_new_category_id: category_id })}
                    />
                  </FieldShell>
                </>
              )}
            </div>
          ) : null}

          {values.financial_link_mode === "remove_current" ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <FieldShell label="Ao remover vínculo">
                <select
                  className={inputClassName}
                  value={values.financial_link_remove_mode}
                  onChange={(event) =>
                    setValues({
                      ...values,
                      financial_link_remove_mode: event.target.value as ReimbursementFormValues["financial_link_remove_mode"],
                    })
                  }
                >
                  <option value="keep_transaction">Manter lançamento de cartão como lançamento normal</option>
                  <option value="archive_transaction">Arquivar lançamento gerado pelo reembolso</option>
                </select>
              </FieldShell>
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950 shadow-sm dark:border-amber-400/50 dark:bg-amber-950/35 dark:text-amber-100">
                O sistema nunca exclui o lançamento automaticamente. Se ele estiver em uma fatura, o total será recalculado.
              </div>
            </div>
          ) : null}
        </div>
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
  const filteredInvoices = invoiceValues.credit_card_id
    ? invoices.filter((invoice) => invoice.credit_card_id === invoiceValues.credit_card_id)
    : [];

  return (
    <Modal
      title="Gerar lançamento vinculado"
      onClose={onClose}
      headerAction={
        <ActionButton type="submit" form="linked-reimbursement-form" disabled={linking || hasLink}>
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
            return;
          }

          onSubmit(target === "account" ? { target, ...accountValues } : { target, ...invoiceValues });
        }}
      >
        {hasLink ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950 shadow-sm dark:border-amber-400/50 dark:bg-amber-950/35 dark:text-amber-100 md:col-span-2">
            <p>Este reembolso já possui vínculo. Para evitar duplicidade, o sistema não cria outro lançamento sobre o mesmo reembolso.</p>
            {reimbursement.credit_card_invoice_id ? (
              <Link className="mt-2 inline-flex font-semibold text-amber-950 underline dark:text-amber-100" href={`/dashboard/invoices/${reimbursement.credit_card_invoice_id}`}>
                Abrir fatura vinculada
              </Link>
            ) : null}
          </div>
        ) : (
          <p className="rounded-md border border-mint-500/35 bg-mint-50 px-3 py-2 text-sm font-medium text-ink-800 shadow-sm dark:border-mint-400/35 dark:bg-mint-950/30 dark:text-slate-100 md:col-span-2">
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
              <select
                disabled={!invoiceValues.credit_card_id}
                className={inputClassName}
                value={invoiceValues.invoice_id}
                onChange={(event) => setInvoiceValues({ ...invoiceValues, invoice_id: event.target.value })}
              >
                <option value="">
                  {invoiceValues.credit_card_id
                    ? "Criar/encontrar automaticamente pela data"
                    : "Selecione um cartão primeiro"}
                </option>
                {filteredInvoices.map((invoice) => (
                  <option key={invoice.id} value={invoice.id}>
                    {formatInvoiceOptionLabel(invoice, cards)}
                  </option>
                ))}
              </select>
            </FieldShell>
            {invoiceValues.credit_card_id && filteredInvoices.length === 0 ? (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950 shadow-sm dark:border-amber-400/50 dark:bg-amber-950/35 dark:text-amber-100 md:col-span-2">
                Este cartão não possui faturas abertas para vínculo. O sistema pode criar a fatura correta pela data do lançamento.
              </p>
            ) : null}
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
          <ActionButton type="submit" disabled={linking || hasLink}>{linking ? "Gerando..." : "Gerar"}</ActionButton>
        </div>
      </form>
    </Modal>
  );
}

function RenegotiationModal({
  modal,
  saving,
  onClose,
  onSubmit,
}: {
  modal: Exclude<RenegotiationModalState, null>;
  saving: boolean;
  onClose: () => void;
  onSubmit: (values: ReimbursementRenegotiationValues) => void;
}) {
  const totalExpected = modal.reimbursements.reduce((sum, item) => sum + Number(item.expected_amount || 0), 0);
  const totalReceived = modal.reimbursements.reduce((sum, item) => sum + Number(item.received_amount || 0), 0);
  const totalOpen = modal.reimbursements.reduce((sum, item) => sum + getOpenAmount(item), 0);
  const [values, setValues] = useState<ReimbursementRenegotiationValues>({
    expected_date: new Date().toISOString().slice(0, 10),
    description: `Renegociação de ${modal.reimbursements.length} título(s)`,
    notes: "",
  });

  return (
    <Modal
      title="Renegociar reembolsos selecionados"
      onClose={onClose}
      headerAction={
        <ActionButton type="submit" form="renegotiation-form" disabled={saving}>
          {saving ? "Renegociando..." : "Salvar"}
        </ActionButton>
      }
    >
      <form
        id="renegotiation-form"
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(values);
        }}
      >
        <div className="rounded-md border border-ink-950/10 bg-slate-50 px-4 py-3 text-sm text-ink-700 md:col-span-2">
          <p><strong>Pessoa:</strong> {modal.person?.name ?? "Pessoa selecionada"}</p>
          <p><strong>Títulos selecionados:</strong> {modal.reimbursements.length}</p>
          <p><strong>Valor total esperado:</strong> {formatCurrency(totalExpected)}</p>
          <p><strong>Valor já recebido:</strong> {formatCurrency(totalReceived)}</p>
          <p><strong>Valor em aberto:</strong> {formatCurrency(totalOpen)}</p>
        </div>
        <FieldShell label="Pessoa">
          <input className={inputClassName} value={modal.person?.name ?? "-"} readOnly />
        </FieldShell>
        <FieldShell label="Nova data prevista">
          <input
            required
            type="date"
            className={inputClassName}
            value={values.expected_date}
            onChange={(event) => setValues({ ...values, expected_date: event.target.value })}
          />
        </FieldShell>
        <div className="md:col-span-2">
          <FieldShell label="Descrição">
            <input
              required
              className={inputClassName}
              value={values.description}
              onChange={(event) => setValues({ ...values, description: event.target.value })}
            />
          </FieldShell>
        </div>
        <div className="md:col-span-2">
          <FieldShell label="Observações">
            <textarea
              rows={4}
              className={inputClassName}
              value={values.notes}
              onChange={(event) => setValues({ ...values, notes: event.target.value })}
            />
          </FieldShell>
        </div>
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-950 shadow-sm dark:border-amber-400/50 dark:bg-amber-950/35 dark:text-amber-100 md:col-span-2">
          Os títulos antigos não serão apagados. Eles serão marcados como renegociados e sairão do saldo ativo.
        </div>
        <div className="flex justify-end gap-2 md:col-span-2">
          <ActionButton type="button" variant="secondary" onClick={onClose}>Cancelar</ActionButton>
          <ActionButton type="submit" disabled={saving}>{saving ? "Renegociando..." : "Criar título consolidado"}</ActionButton>
        </div>
      </form>
    </Modal>
  );
}

function ReimbursementReportModal({
  allReimbursements,
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
  allReimbursements: ReimbursementRow[];
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
  const summary = summarizeReportReimbursements(reimbursements);
  const groups = groupReimbursementsByPerson(reimbursements, people);
  const reportFileName = buildReimbursementReportFileName({
    generatedAt,
    period,
    personName: person?.name ?? null,
  });
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  async function handleDownloadPdf() {
    try {
      setDownloadingPdf(true);
      setPdfError(null);

      const document = buildReimbursementPdfDocument({
        allReimbursements,
        accounts,
        cards,
        categories,
        generatedAt,
        groups,
        income,
        invoices,
        period,
        personName: person?.name ?? null,
        reimbursements,
        summary,
        transactions,
      });

      document.save(reportFileName);
    } catch (error) {
      console.error("Erro ao gerar PDF de reembolsos", error);
      setPdfError("Não foi possível gerar o PDF agora. Tente novamente.");
    } finally {
      setDownloadingPdf(false);
    }
  }

  return (
    <Modal title="Relatório de reembolsos" onClose={onClose}>
      <div className="reimbursement-report-shell space-y-5">
        <div className="report-actions flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-600">
            Relatório otimizado para PDF com nome sugerido automático e layout próprio para compartilhamento.
          </p>
          <div className="flex flex-wrap gap-2">
            <ActionButton variant="secondary" onClick={handleDownloadPdf} disabled={downloadingPdf}>
              {downloadingPdf ? "Baixando..." : "Baixar PDF"}
            </ActionButton>
            <ActionButton variant="secondary" onClick={onClose}>Voltar</ActionButton>
          </div>
        </div>
        {pdfError ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {pdfError}
          </div>
        ) : null}

        <article className="reimbursement-report rounded-lg border border-ink-950/10 bg-white p-6 text-ink-950 shadow-sm">
          <header className="report-header border-b border-ink-950/10 pb-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-mint-600">Hub VZ</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink-950">Relatório de Reembolsos</h2>
                {person ? <p className="mt-2 text-lg font-semibold text-ink-950">{person.name}</p> : null}
                <p className="mt-2 text-sm leading-6 text-ink-600">
                  Período: {formatPeriodLabel(period)} · Gerado em {formatDateTime(generatedAt)}
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
                          <th className="w-[12%] px-4 py-3 font-semibold">Data</th>
                          <th className="w-[32%] px-4 py-3 font-semibold">Descrição</th>
                          <th className="w-[18%] px-4 py-3 font-semibold">Categoria/Vínculo</th>
                          <th className="w-[10%] px-4 py-3 text-right font-semibold">Esperado</th>
                          <th className="w-[10%] px-4 py-3 text-right font-semibold">Recebido</th>
                          <th className="w-[10%] px-4 py-3 text-right font-semibold">Em aberto</th>
                          <th className="w-[8%] px-4 py-3 font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-ink-950/10">
                        {group.rows.map((reimbursement) => {
                          const openAmount = getOpenAmount(reimbursement);
                          const category = categories.find((item) => item.id === reimbursement.category_id);
                          const late = isLateReimbursement(reimbursement);
                          const renegotiationSources = reimbursement.renegotiation_source_ids
                            .map((sourceId) => allReimbursements.find((item) => item.id === sourceId))
                            .filter((item): item is ReimbursementRow => Boolean(item));

                          return (
                            <Fragment key={reimbursement.id}>
                              <tr className={late ? "report-row-late bg-amberRisk-100/45" : ""}>
                                <td className="px-4 py-3 align-top text-ink-600">
                                  <span className={late ? "font-semibold text-amberRisk-500" : ""}>{formatDate(reimbursement.expected_date)}</span>
                                  {reimbursement.received_date ? (
                                    <span className="mt-1 block text-xs text-ink-600">Recebido: {formatDate(reimbursement.received_date)}</span>
                                  ) : null}
                                </td>
                                <td className="px-4 py-3 align-top">
                                  <p className="font-semibold text-ink-950">
                                    {renegotiationSources.length > 0
                                      ? `Renegociação de ${renegotiationSources.length} título(s)`
                                      : reimbursement.description ?? "Reembolso sem descrição"}
                                  </p>
                                  {renegotiationSources.length === 0 && reimbursement.notes ? (
                                    <p className="report-description-meta mt-1 text-xs leading-5 text-ink-600">Obs.: {reimbursement.notes}</p>
                                  ) : null}
                                  {renegotiationSources.length > 0 ? (
                                    <p className="report-description-meta mt-1 text-xs leading-5 text-ink-600">
                                      Valor consolidado da renegociação.
                                    </p>
                                  ) : null}
                                </td>
                                <td className="px-4 py-3 align-top">
                                  <div className="report-description-meta flex flex-col gap-2 text-xs leading-5 text-ink-600">
                                    <CategoryBadge category={category} />
                                    <span>Vínculo: {getLinkedLabel(reimbursement, transactions, accounts, income, invoices, cards)}</span>
                                  </div>
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
                              {renegotiationSources.length > 0 ? (
                                <tr className="bg-amberRisk-100/20">
                                  <td colSpan={7} className="px-4 py-3 align-top">
                                    <div className="report-renegotiation rounded-md border border-amberRisk-500/20 bg-amberRisk-100/35 px-3 py-2">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-amberRisk-500">
                                        Origem da renegociação
                                      </p>
                                      <div className="mt-2 space-y-2">
                                        {renegotiationSources.map((source) => (
                                          <div key={source.id} className="rounded-sm border border-ink-950/10 bg-white/70 px-2 py-1">
                                            <p className="text-xs font-medium text-ink-950">
                                              {source.description ?? "Título original não encontrado"}
                                            </p>
                                            <p className="mt-1 text-[11px] text-ink-600">
                                              Data original: {formatDate(source.expected_date)} · Valor original: {formatCurrency(Number(source.expected_amount))} · Em aberto: {formatCurrency(getOpenAmount(source))}
                                            </p>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              ) : null}
                            </Fragment>
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
            Hub VZ · Relatório de apoio · Reembolsos não são renda livre.
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

function buildReimbursementPdfDocument({
  allReimbursements,
  accounts,
  cards,
  categories,
  generatedAt,
  groups,
  income,
  invoices,
  period,
  personName,
  reimbursements,
  summary,
  transactions,
}: {
  allReimbursements: ReimbursementRow[];
  accounts: ReimbursementAccount[];
  cards: ReimbursementCard[];
  categories: ReimbursementCategory[];
  generatedAt: Date;
  groups: ReturnType<typeof groupReimbursementsByPerson>;
  income: ReimbursementIncome[];
  invoices: ReimbursementInvoice[];
  period: PeriodValue;
  personName: string | null;
  reimbursements: ReimbursementRow[];
  summary: ReturnType<typeof summarizeReportReimbursements>;
  transactions: ReimbursementTransaction[];
}) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 10;
  const marginTop = 10;
  const marginBottom = 10;
  const contentWidth = pageWidth - marginX * 2;
  const footerText = "Hub VZ · Relatório de apoio · Reembolsos não são renda livre.";

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(8, 127, 116);
  doc.text("Hub VZ", marginX, marginTop);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(17, 24, 39);
  doc.text("Relatório de Reembolsos", marginX, marginTop + 8);

  let cursorY = marginTop + 15;

  if (personName) {
    doc.setFontSize(13);
    doc.text(personName, marginX, cursorY);
    cursorY += 6;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(75, 85, 99);
  doc.text(`Período: ${formatPeriodLabel(period)}`, marginX, cursorY);
  cursorY += 5;
  doc.text(`Data de geração: ${formatDateTime(generatedAt)}`, marginX, cursorY);

  const summaryMetrics = [
    { label: "Total esperado", value: formatCurrency(summary.expected) },
    { label: "Total recebido", value: formatCurrency(summary.received) },
    { label: "Total em aberto", value: formatCurrency(summary.open) },
    { label: "Quantidade de reembolsos", value: String(summary.count) },
    { label: "Quantidade de pessoas", value: String(summary.personCount) },
    { label: "Maior valor em aberto", value: formatCurrency(summary.largestOpen) },
    { label: "Próximo recebimento", value: summary.nextExpectedDate ? formatDate(summary.nextExpectedDate) : "-" },
    { label: "Percentual recebido", value: `${summary.receivedPercentage.toFixed(1)}%` },
  ];

  cursorY += 6;
  const cardColumns = 4;
  const cardGap = 4;
  const cardWidth = (contentWidth - cardGap * (cardColumns - 1)) / cardColumns;
  const cardHeight = 16;

  summaryMetrics.forEach((metric, index) => {
    const col = index % cardColumns;
    const row = Math.floor(index / cardColumns);
    const x = marginX + col * (cardWidth + cardGap);
    const y = cursorY + row * (cardHeight + 3);

    doc.setDrawColor(209, 213, 219);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(x, y, cardWidth, cardHeight, 2, 2, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(75, 85, 99);
    doc.text(metric.label.toUpperCase(), x + 3, y + 5);
    doc.setFontSize(10);
    doc.setTextColor(17, 24, 39);
    doc.text(metric.value, x + 3, y + 11);
  });

  cursorY += cardHeight * 2 + 10;

  if (reimbursements.length === 0) {
    doc.setDrawColor(209, 213, 219);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(marginX, cursorY, contentWidth, 24, 2, 2, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(17, 24, 39);
    doc.text("Nenhum reembolso encontrado para os filtros selecionados.", marginX + 4, cursorY + 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(75, 85, 99);
    doc.text("Ajuste período, pessoa ou filtros e gere novamente.", marginX + 4, cursorY + 16);
  } else {
    groups.forEach((group, groupIndex) => {
      if (groupIndex > 0 && cursorY > pageHeight - 80) {
        doc.addPage();
        cursorY = marginTop;
      }

      doc.setDrawColor(209, 213, 219);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(marginX, cursorY, contentWidth, 14, 2, 2, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(17, 24, 39);
      doc.text(group.person.name, marginX + 3, cursorY + 5.5);
      doc.setFontSize(8);
      doc.setTextColor(75, 85, 99);
      doc.text(group.statusLabel.toUpperCase(), marginX + 3, cursorY + 10.5);
      doc.setFont("helvetica", "normal");
      doc.text(
        [
          `Esperado ${formatCurrency(group.summary.expected)}`,
          `Recebido ${formatCurrency(group.summary.received)}`,
          `Em aberto ${formatCurrency(group.summary.open)}`,
          `${group.summary.count} item(ns)`,
        ].join("   ·   "),
        pageWidth - marginX - 3,
        cursorY + 8.2,
        { align: "right" },
      );

      cursorY += 18;

      const bodyRows = group.rows.flatMap((reimbursement) => {
        const openAmount = getOpenAmount(reimbursement);
        const late = isLateReimbursement(reimbursement);
        const category = categories.find((item) => item.id === reimbursement.category_id);
        const linkedLabel = getLinkedLabel(reimbursement, transactions, accounts, income, invoices, cards);
        const renegotiationSources = reimbursement.renegotiation_source_ids
          .map((sourceId) => allReimbursements.find((item) => item.id === sourceId))
          .filter((item): item is ReimbursementRow => Boolean(item));

        const mainRow = [
          `${formatDate(reimbursement.expected_date)}${reimbursement.received_date ? `\nRecebido: ${formatDate(reimbursement.received_date)}` : ""}`,
          renegotiationSources.length > 0
            ? `Renegociação de ${renegotiationSources.length} título(s)\nValor consolidado da renegociação.`
            : [reimbursement.description ?? "Reembolso sem descrição", reimbursement.notes ? `Obs.: ${reimbursement.notes}` : null].filter(Boolean).join("\n"),
          [category?.name ?? "Sem categoria", `Vínculo: ${linkedLabel}`].join("\n"),
          formatCurrency(Number(reimbursement.expected_amount)),
          formatCurrency(Number(reimbursement.received_amount)),
          formatCurrency(openAmount),
          late ? "Atrasado" : optionLabel(reimbursementStatusOptions, reimbursement.status),
        ];

        if (renegotiationSources.length === 0) {
          return [mainRow];
        }

        const renegotiationBlock = [
          "Origem da renegociação",
          ...renegotiationSources.map((source) =>
            [
              `• ${source.description ?? "Título original não encontrado"}`,
              `  Data original: ${formatDate(source.expected_date)}`,
              `  Valor original: ${formatCurrency(Number(source.expected_amount))}`,
              `  Em aberto na renegociação: ${formatCurrency(getOpenAmount(source))}`,
            ].join("\n"),
          ),
        ].join("\n");

        return [
          mainRow,
          [
            {
              content: renegotiationBlock,
              colSpan: 7,
              styles: {
                fillColor: [255, 247, 237] as [number, number, number],
                textColor: [120, 53, 15] as [number, number, number],
                fontSize: 8,
                cellPadding: 2.5,
                lineColor: [251, 191, 36] as [number, number, number],
                lineWidth: 0.1,
              },
            },
          ],
        ];
      });

      autoTable(doc, {
        startY: cursorY,
        margin: { left: marginX, right: marginX, bottom: marginBottom + 8 },
        head: [["Data", "Descrição", "Categoria/Vínculo", "Esperado", "Recebido", "Em aberto", "Status"]],
        body: bodyRows as Parameters<typeof autoTable>[1]["body"],
        theme: "grid",
        styles: {
          font: "helvetica",
          fontSize: 8,
          textColor: [17, 24, 39],
          cellPadding: 2.4,
          lineColor: [229, 231, 235],
          lineWidth: 0.1,
          overflow: "linebreak",
          valign: "top",
        },
        headStyles: {
          fillColor: [248, 250, 252],
          textColor: [75, 85, 99],
          fontStyle: "bold",
        },
        columnStyles: {
          0: { cellWidth: 27 },
          1: { cellWidth: 67 },
          2: { cellWidth: 46 },
          3: { cellWidth: 24, halign: "right" },
          4: { cellWidth: 24, halign: "right" },
          5: { cellWidth: 24, halign: "right" },
          6: { cellWidth: 22, halign: "center" },
        },
        didParseCell(data) {
          if (data.section === "body" && data.column.index >= 3 && data.column.index <= 5) {
            data.cell.styles.fontStyle = data.column.index === 4 ? "normal" : "bold";
          }

          if (
            data.section === "body" &&
            Array.isArray(data.row.raw) &&
            typeof data.row.raw[0] === "string" &&
            String(data.row.raw[6] ?? "").toLowerCase() === "atrasado"
          ) {
            data.cell.styles.fillColor = [255, 247, 237];
          }
        },
        didDrawPage() {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          doc.setTextColor(100, 116, 139);
          doc.text(footerText, pageWidth / 2, pageHeight - 5, { align: "center" });
        },
      });

      cursorY = ((doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? cursorY) + 8;
    });
  }

  return doc;
}

// Legacy helper kept temporarily for local reference while the modal uses direct PDF generation.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildReimbursementPrintDocument(reportHtml: string, fileName: string) {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${fileName}</title>
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

      .report-renegotiation {
        margin-top: 5pt;
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .report-renegotiation p {
        margin: 0;
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

function getCardLabel(card: ReimbursementCard) {
  return card.issuer ? `${card.name} · ${card.issuer}` : card.name;
}

function formatTransactionFinancialOption(
  transaction: ReimbursementTransaction,
  categories: ReimbursementCategory[],
) {
  const category = categories.find((item) => item.id === transaction.category_id);

  return [
    transaction.description,
    formatDate(transaction.transaction_date),
    formatCurrency(Number(transaction.amount)),
    category?.name ? `Categoria: ${category.name}` : null,
    transaction.reimbursement_id ? "já vinculado" : null,
  ]
    .filter(Boolean)
    .join(" · ");
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
  if (["received", "cancelled", "forgiven", "renegotiated"].includes(reimbursement.status)) return 0;
  return Math.max(Number(reimbursement.expected_amount) - Number(reimbursement.received_amount), 0);
}

function isLateReimbursement(reimbursement: ReimbursementRow) {
  return isReimbursementLateByDate(reimbursement);
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

function buildReimbursementReportFileName({
  generatedAt,
  period,
  personName,
}: {
  generatedAt: Date;
  period: PeriodValue;
  personName: string | null;
}) {
  const generatedDate = generatedAt.toISOString().slice(0, 10);
  const segments = ["hub-vz", "reembolsos"];
  const personSegment = sanitizeFileNameSegment(personName);
  const periodSegment = getFilePeriodSegment(period);

  if (personSegment) segments.push(personSegment);
  if (periodSegment) segments.push(periodSegment);
  segments.push(personSegment || periodSegment ? `gerado-${generatedDate}` : generatedDate);

  return `${segments.join("-")}.pdf`;
}

function getFilePeriodSegment(period: PeriodValue) {
  if (!period.startDate || !period.endDate) return null;

  const startMonth = period.startDate.slice(0, 7);
  const endMonth = period.endDate.slice(0, 7);

  if (startMonth === endMonth) return startMonth;
  return `${period.startDate}_a_${period.endDate}`;
}

function sanitizeFileNameSegment(value: string | null | undefined) {
  if (!value) return null;

  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .toLowerCase();
}
