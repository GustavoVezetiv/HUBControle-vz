"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { categoryModuleDefinitions, filterCategoriesByScopes, isCategoryOutOfScope } from "@/features/categories/scopes";
import {
  createInstallment,
  deleteInstallment,
  deletePendingGeneratedAccountsForInstallment,
  generateInstallmentAccounts,
  listGeneratedAccountsForInstallment,
  listGeneratedAccountsSummaryForInstallments,
  unlinkKeptGeneratedAccountsForInstallment,
  listInstallments,
  listInstallmentSupportData,
  registerInstallmentPayment,
  type RegisterInstallmentPaymentValues,
  unlinkPaidGeneratedAccountsForInstallment,
  updateInstallment,
} from "@/features/installments/queries";
import {
  emptyInstallmentForm,
  installmentOriginOptions,
  installmentToFormValues,
  type InstallmentCard,
  type InstallmentCategory,
  type InstallmentFormValues,
  type InstallmentInvoice,
  type InstallmentPerson,
  type InstallmentRow,
  type InstallmentTransaction,
} from "@/features/installments/types";
import { ActionButton, CategoryBadge, CategorySelect, CrudFeedback, FieldShell, inputClassName, Modal, QuickEditInput, QuickEditSelect, TextBadge, TitleButton, ViewPreferenceActions } from "@/features/shared/crud-ui";
import { formatCurrency, formatDate } from "@/features/shared/format";
import { installmentStatusOptions, optionLabel, paymentMethodOptions } from "@/features/shared/options";
import { PeriodFilter } from "@/features/shared/period-filter";
import { isDateRangeInPeriod, parsePeriodSearchParams, type PeriodValue } from "@/features/shared/period";
import { getQuickTableEditPreference } from "@/features/shared/quick-edit";
import type { FeedbackState } from "@/features/shared/types";
import { clearViewPreference, loadViewPreference, preferenceRecord, preferenceText, saveViewPreference } from "@/features/shared/view-preferences";
import { InsufficientCashModal, LinkedEntryModal } from "@/features/linked-entries/components";
import { checkCashAvailabilityForPayment, createLinkedEntry, logPaymentContinuedWithoutSufficientEntry } from "@/features/linked-entries/queries";
import type { CashAvailability, LinkedEntryContext, LinkedEntryFormValues } from "@/features/linked-entries/types";
import { createClient } from "@/lib/supabase/client";

type ModalState = { mode: "create"; installment: null } | { mode: "edit"; installment: InstallmentRow } | null;
type InstallmentsViewPreference = {
  search?: string;
  statusFilter?: string;
  cardFilter?: string;
  period?: PeriodValue;
};
type PendingInstallmentPayment = {
  installment: InstallmentRow;
  amount: number;
  values: RegisterInstallmentPaymentValues;
  availability: CashAvailability | null;
  context: LinkedEntryContext;
};
type PaymentModalState = { installment: InstallmentRow; values: RegisterInstallmentPaymentValues } | null;

const installmentsDefaultViewPreference: Required<InstallmentsViewPreference> = {
  search: "",
  statusFilter: "all",
  cardFilter: "all",
  period: parsePeriodSearchParams({}),
};

export function InstallmentsCrud() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const installmentFilter = searchParams.get("installment");
  const [installments, setInstallments] = useState<InstallmentRow[]>([]);
  const [cards, setCards] = useState<InstallmentCard[]>([]);
  const [invoices, setInvoices] = useState<InstallmentInvoice[]>([]);
  const [transactions, setTransactions] = useState<InstallmentTransaction[]>([]);
  const [categories, setCategories] = useState<InstallmentCategory[]>([]);
  const [people, setPeople] = useState<InstallmentPerson[]>([]);
  const [generatedSummaryByInstallment, setGeneratedSummaryByInstallment] = useState<Record<string, { generatedCount: number; paidCount: number; pendingCount: number; nextDueDate: string | null; remainingAmount: number }>>({});
  const [userId, setUserId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") ?? "all");
  const [cardFilter, setCardFilter] = useState("all");
  const [period, setPeriod] = useState(() => parsePeriodSearchParams(Object.fromEntries(searchParams.entries())));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generatingAccountsId, setGeneratingAccountsId] = useState<string | null>(null);
  const [payingInstallmentId, setPayingInstallmentId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [paymentModal, setPaymentModal] = useState<PaymentModalState>(null);
  const [pendingPayment, setPendingPayment] = useState<PendingInstallmentPayment | null>(null);
  const [linkedEntryContext, setLinkedEntryContext] = useState<LinkedEntryContext | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [allowQuickTableEdit, setAllowQuickTableEdit] = useState(false);
  const scopedCategories = useMemo(
    () => filterCategoriesByScopes(categories, categoryModuleDefinitions.accounts.scopes),
    [categories],
  );

  const periodInstallments = useMemo(() => {
    return installments.filter((item) =>
      isDateRangeInPeriod(item.start_date ?? item.due_month, item.end_date ?? item.due_month, period),
    );
  }, [installments, period]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return periodInstallments.filter(
      (item) =>
        (!needle || item.description.toLowerCase().includes(needle)) &&
        (statusFilter === "all" || item.status === statusFilter) &&
        (cardFilter === "all" || item.credit_card_id === cardFilter) &&
        (!installmentFilter || item.id === installmentFilter),
    );
  }, [cardFilter, installmentFilter, periodInstallments, search, statusFilter]);

  const summary = useMemo(() => {
    const active = periodInstallments.filter((item) => item.status === "active");
    const monthlyAmount = active
      .filter((item) => !item.invoice_id)
      .reduce((sum, item) => sum + Number(item.installment_amount), 0);
    const activeTotal = active.reduce((sum, item) => sum + Number(item.total_amount), 0);
    const finishingSoon = active.filter((item) => {
      const current = Number(item.current_installment ?? item.installment_number);
      const total = Number(item.installment_total ?? item.installment_count);
      return total - current <= 2;
    }).length;
    const futureCommitment = active.reduce((sum, item) => {
      const current = Number(item.current_installment ?? item.installment_number);
      const total = Number(item.installment_total ?? item.installment_count);
      return sum + Math.max(total - current + 1, 0) * Number(item.installment_amount);
    }, 0);
    return { activeTotal, monthlyAmount, finishingSoon, futureCommitment };
  }, [periodInstallments]);

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
    const [installmentsResult, support, quickEdit] = await Promise.all([
      listInstallments(client),
      listInstallmentSupportData(client),
      getQuickTableEditPreference(client, auth.user.id),
    ]);
    if (installmentsResult.error) setFeedback({ type: "error", message: installmentsResult.error.message });
    else {
      const nextInstallments = installmentsResult.data ?? [];
      setInstallments(nextInstallments);

      const summaryResult = await listGeneratedAccountsSummaryForInstallments(
        client,
        nextInstallments.map((item) => item.id),
      );

      if (summaryResult.error) {
        setFeedback({ type: "error", message: summaryResult.error.message });
      } else {
        setGeneratedSummaryByInstallment(
          Object.fromEntries(
            nextInstallments.map((item) => {
              const summary = summaryResult.data.find((entry) => entry.installment_id === item.id);
              return [
                item.id,
                {
                  generatedCount: summary?.generatedCount ?? 0,
                  paidCount: summary?.paidCount ?? 0,
                  pendingCount: summary?.pendingCount ?? 0,
                  nextDueDate: summary?.nextDueDate ?? null,
                  remainingAmount: summary?.remainingAmount ?? 0,
                },
              ];
            }),
          ),
        );
      }
    }
    if (!support.cards.error) setCards(support.cards.data ?? []);
    if (!support.invoices.error) setInvoices(support.invoices.data ?? []);
    if (!support.transactions.error) setTransactions(support.transactions.data ?? []);
    if (!support.categories.error) setCategories(support.categories.data ?? []);
    if (!support.people.error) setPeople(support.people.data ?? []);
    setAllowQuickTableEdit(quickEdit);
    setLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (!userId) return;
    const preference = loadViewPreference<InstallmentsViewPreference>("installments", userId);
    if (!preference) return;

    setSearch(preferenceText(preference.search));
    if (!searchParams.get("status")) setStatusFilter(preferenceText(preference.statusFilter, "all"));
    setCardFilter(preferenceText(preference.cardFilter, "all"));
    if (!searchParams.get("period") && !searchParams.get("start") && !searchParams.get("end")) {
      setPeriod(preferenceRecord(preference.period, installmentsDefaultViewPreference.period));
    }
  }, [searchParams, userId]);

  function handleSaveViewPreference() {
    const saved = saveViewPreference("installments", userId, {
      search,
      statusFilter,
      cardFilter,
      period,
    });
    setFeedback({
      type: saved ? "success" : "error",
      message: saved ? "Visualização padrão de parcelamentos salva." : "Não foi possível salvar a visualização padrão.",
    });
  }

  function handleRestoreViewPreference() {
    clearViewPreference("installments", userId);
    handleClearFilters();
    setFeedback({ type: "success", message: "Visualização padrão de parcelamentos restaurada." });
  }

  function handleClearFilters() {
    setSearch(installmentsDefaultViewPreference.search);
    setStatusFilter(installmentsDefaultViewPreference.statusFilter);
    setCardFilter(installmentsDefaultViewPreference.cardFilter);
    setPeriod(installmentsDefaultViewPreference.period);
    if (installmentFilter) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("installment");
      router.replace(`/dashboard/installments${params.toString() ? `?${params.toString()}` : ""}`);
    }
  }

  async function handleSubmit(values: InstallmentFormValues) {
    if (!values.description.trim() || !values.start_date) {
      setFeedback({ type: "error", message: "Descrição e data inicial são obrigatórias." });
      return;
    }
    if (
      Number(values.total_amount) < 0 ||
      Number(values.installment_amount) < 0 ||
      Number(values.current_installment) > Number(values.installment_total)
    ) {
      setFeedback({ type: "error", message: "Valores e parcelas precisam ser válidos." });
      return;
    }
    if (!userId) {
      setFeedback({ type: "error", message: "Sessão não encontrada. Entre novamente para salvar." });
      return;
    }
    setSaving(true);
    try {
      const client = createClient();
      const result =
        modal?.mode === "edit"
          ? await updateInstallment(client, modal.installment.id, values)
          : await createInstallment(client, userId, values);
      if (result.error) {
        console.error("Erro ao salvar parcelamento:", result.error);
        setFeedback({
          type: "error",
          message: "Não foi possível salvar o parcelamento. Verifique os dados e tente novamente.",
        });
        return;
      }

      let generationMessage = "";
      const savedInstallment = result.data as InstallmentRow | null;

      if (savedInstallment && values.generate_accounts && !isCardControlledInstallment(savedInstallment)) {
        const generation = await generateInstallmentAccounts(client, userId, savedInstallment);

        if (generation.error) {
          setFeedback({ type: "error", message: generation.error.message });
          return;
        }

        generationMessage = ` ${generation.created} conta(s) mensal(is) gerada(s). ${generation.skipped} duplicada(s) ignorada(s).`;
      } else if (savedInstallment && values.generate_accounts) {
        generationMessage = " Contas não foram geradas porque este parcelamento é controlado pelas faturas do cartão.";
      }

      setFeedback({
        type: "success",
        message: `${modal?.mode === "edit" ? "Parcelamento atualizado." : "Parcelamento criado."}${generationMessage}`,
      });
      setModal(null);
      await loadData();
    } catch (error) {
      console.error("Erro inesperado ao salvar parcelamento:", error);
      setFeedback({
        type: "error",
        message: "Ocorreu um erro inesperado ao salvar o parcelamento. Tente novamente.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateAccounts(item: InstallmentRow) {
    if (!userId) {
      setFeedback({ type: "error", message: "Sessão não encontrada. Entre novamente para gerar contas." });
      return;
    }

    if (isCardControlledInstallment(item)) {
      setFeedback({ type: "error", message: "Este parcelamento é controlado pelas faturas do cartão." });
      return;
    }

    if (!window.confirm("Parcelamentos geram obrigações mensais em Contas. Não cadastre a mesma parcela manualmente em Contas para evitar duplicidade. Deseja gerar as contas deste parcelamento?")) {
      return;
    }

    setGeneratingAccountsId(item.id);
    setFeedback(null);

    try {
      const result = await generateInstallmentAccounts(createClient(), userId, item);

      if (result.error) {
        setFeedback({ type: "error", message: result.error.message });
        return;
      }

      setFeedback({
        type: "success",
        message: `${result.created} conta(s) mensal(is) gerada(s). ${result.skipped} duplicada(s) ignorada(s).`,
      });
      await loadData();
    } catch (error) {
      console.error("Erro inesperado ao gerar contas do parcelamento:", error);
      setFeedback({ type: "error", message: "Não foi possível gerar as contas mensais do parcelamento." });
    } finally {
      setGeneratingAccountsId(null);
    }
  }

  async function handleRegisterPayment(item: InstallmentRow) {
    if (!userId) {
      setFeedback({ type: "error", message: "Sessão não encontrada. Entre novamente para registrar o pagamento." });
      return;
    }

    if (isCardControlledInstallment(item)) {
      setFeedback({ type: "error", message: "Este parcelamento é controlado pelas faturas do cartão." });
      return;
    }

    setPaymentModal({
      installment: item,
      values: {
        installmentNumber: Number(item.current_installment ?? item.installment_number ?? 1),
        paymentDate: new Date().toISOString().slice(0, 10),
        paymentMethod: "pix",
        paidAmount: Number(item.installment_amount || 0),
        notes: "",
      },
    });
  }

  async function handleSubmitPayment(values: RegisterInstallmentPaymentValues) {
    if (!userId || !paymentModal) return;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.paymentDate)) {
      setFeedback({ type: "error", message: "Informe uma data de pagamento válida no formato AAAA-MM-DD." });
      return;
    }

    const amount = Number(values.paidAmount || 0);
    if (amount <= 0) {
      setFeedback({ type: "error", message: "A parcela precisa ter valor maior que zero." });
      return;
    }

    const total = Number(paymentModal.installment.installment_total ?? paymentModal.installment.installment_count);
    if (values.installmentNumber <= 0 || values.installmentNumber > total) {
      setFeedback({ type: "error", message: "Escolha uma parcela válida para este parcelamento." });
      return;
    }

    setPayingInstallmentId(paymentModal.installment.id);
    setFeedback(null);
    try {
      const client = createClient();
      const availability = await checkCashAvailabilityForPayment(client, userId, amount, values.paymentDate);
      if (availability.error) {
        setFeedback({ type: "error", message: availability.error.message });
        return;
      }

      const context = buildInstallmentPaymentContext(paymentModal.installment, amount, values.paymentDate, values.installmentNumber);
      if (!availability.data?.hasEnough) {
        setPendingPayment({ installment: paymentModal.installment, amount, values, availability: availability.data, context });
        setPaymentModal(null);
        return;
      }

      await executeInstallmentPayment(paymentModal.installment, values, null);
      setPaymentModal(null);
    } catch (error) {
      console.error("Erro técnico ao registrar pagamento do parcelamento:", error);
      setFeedback({ type: "error", message: "Não foi possível registrar o pagamento da parcela." });
    } finally {
      setPayingInstallmentId(null);
    }
  }

  async function executeInstallmentPayment(item: InstallmentRow, values: RegisterInstallmentPaymentValues, linkedIncomeSourceId: string | null) {
    if (!userId) return;
    const result = await registerInstallmentPayment(createClient(), userId, item, values, linkedIncomeSourceId);
    if (result.error) {
      setFeedback({ type: "error", message: result.error.message });
      return;
    }

    setFeedback({ type: "success", message: "Pagamento da parcela registrado." });
    setPendingPayment(null);
    setLinkedEntryContext(null);
    await loadData();
  }

  async function handleContinuePaymentWithoutEntry() {
    if (!pendingPayment || !userId) return;
    setPayingInstallmentId(pendingPayment.installment.id);
    setFeedback(null);
    try {
      const client = createClient();
      await logPaymentContinuedWithoutSufficientEntry(client, userId, pendingPayment.context, pendingPayment.availability);
      const result = await registerInstallmentPayment(client, userId, pendingPayment.installment, pendingPayment.values, null);
      if (result.error) {
        setFeedback({ type: "error", message: result.error.message });
        return;
      }
      setFeedback({ type: "success", message: "Pagamento da parcela registrado sem entrada suficiente vinculada." });
      setPendingPayment(null);
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao continuar pagamento de parcela sem entrada suficiente:", error);
      setFeedback({ type: "error", message: "Não foi possível registrar o pagamento da parcela." });
    } finally {
      setPayingInstallmentId(null);
    }
  }

  async function handleSubmitLinkedEntry(values: LinkedEntryFormValues) {
    const context = linkedEntryContext ?? pendingPayment?.context;
    if (!context || !pendingPayment || !userId) return;

    setPayingInstallmentId(pendingPayment.installment.id);
    setFeedback(null);
    try {
      const client = createClient();
      const entry = await createLinkedEntry(client, userId, context, values);
      if (entry.error || !entry.data) {
        setFeedback({ type: "error", message: entry.error?.message ?? "Não foi possível registrar a entrada vinculada." });
        return;
      }
      await executeInstallmentPayment(pendingPayment.installment, pendingPayment.values, entry.data.id);
    } catch (error) {
      console.error("Erro técnico ao registrar entrada vinculada da parcela:", error);
      setFeedback({ type: "error", message: "Não foi possível registrar a entrada vinculada." });
    } finally {
      setPayingInstallmentId(null);
    }
  }

  async function handleDelete(item: InstallmentRow) {
    if (!window.confirm("Excluir este parcelamento?")) return;

    const client = createClient();
    const generated = await listGeneratedAccountsForInstallment(client, item.id);

    if (generated.error) {
      console.error("Erro técnico ao verificar contas geradas:", generated.error);
      setFeedback({ type: "error", message: "Não foi possível verificar contas geradas por este parcelamento." });
      return;
    }

    const generatedAccounts = generated.data ?? [];
    const pendingCount = generatedAccounts.filter((account) => account.status !== "paid").length;
    const paidCount = generatedAccounts.filter((account) => account.status === "paid").length;

    if (pendingCount > 0) {
      const shouldDeletePending = window.confirm(
        `Este parcelamento gerou ${pendingCount} conta(s) pendente(s). Deseja excluir também essas contas?`,
      );

      if (shouldDeletePending) {
        const deleteAccountsResult = await deletePendingGeneratedAccountsForInstallment(client, item.id);
        if (deleteAccountsResult.error) {
          console.error("Erro técnico ao excluir contas geradas pendentes:", deleteAccountsResult.error);
          setFeedback({ type: "error", message: "Não foi possível excluir as contas pendentes geradas." });
          return;
        }
      } else {
        const unlinkResult = await unlinkKeptGeneratedAccountsForInstallment(client, item.id);
        if (unlinkResult.error) {
          console.error("Erro técnico ao desvincular contas geradas mantidas:", unlinkResult.error);
          setFeedback({ type: "error", message: "Não foi possível manter as contas geradas como histórico manual." });
          return;
        }
      }
    }

    if (paidCount > 0) {
      const shouldUnlinkPaid = window.confirm(
        "Existem contas geradas já pagas. Elas podem ficar no histórico, desvinculadas do parcelamento. Deseja continuar com essa alteração?",
      );
      if (!shouldUnlinkPaid) {
        return;
      }
      const unlinkResult = await unlinkPaidGeneratedAccountsForInstallment(client, item.id);
      if (unlinkResult.error) {
        console.error("Erro técnico ao desvincular contas pagas:", unlinkResult.error);
        setFeedback({ type: "error", message: "Não foi possível preservar o histórico das contas pagas." });
        return;
      }
    }

    const { error } = await deleteInstallment(client, item.id);
    if (error) setFeedback({ type: "error", message: error.message });
    else {
      setFeedback({ type: "success", message: "Parcelamento excluído." });
      await loadData();
    }
  }

  async function handleQuickUpdate(item: InstallmentRow, patch: Partial<InstallmentFormValues>) {
    const values = { ...installmentToFormValues(item), ...patch };
    const result = await updateInstallment(createClient(), item.id, values);

    if (result.error) {
      console.error("Erro técnico ao atualizar parcelamento:", result.error);
      setFeedback({ type: "error", message: "Não foi possível atualizar o parcelamento." });
      return;
    }

    setFeedback({ type: "success", message: "Parcelamento atualizado." });
    await loadData();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Compromissos futuros"
        title="Parcelamentos"
        description="Parcelamentos representam compromissos futuros divididos em parcelas. Eles podem estar ligados a um cartão, fatura ou existir fora do cartão, como financiamento, boleto parcelado ou dívida informal."
        action={<ActionButton onClick={() => setModal({ mode: "create", installment: null })}>Novo parcelamento</ActionButton>}
      />
      <CrudFeedback feedback={feedback} />
      <SectionCard title="Como usar" description="Parcelamentos geram obrigações mensais em Contas.">
        <p className="text-sm leading-6 text-ink-600">
          Cadastre o compromisso inteiro aqui e gere as parcelas mensais em Contas. Não cadastre a mesma parcela manualmente em Contas para evitar duplicidade.
        </p>
      </SectionCard>
      <PeriodFilter value={period} onChange={setPeriod} description="Escolha o período de impacto dos parcelamentos." syncUrl />
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Parcelamentos ativos" value={formatCurrency(summary.activeTotal)} helper="Valor total original dos ativos." tone="info" />
        <StatCard label="Impacto mensal" value={formatCurrency(summary.monthlyAmount)} helper="Parcelas ativas fora de faturas." tone="warning" />
        <StatCard label="Terminando em breve" value={String(summary.finishingSoon)} helper="Faltam até 2 parcelas." tone="success" />
        <StatCard label="Compromisso futuro" value={formatCurrency(summary.futureCommitment)} helper="Valor ainda previsto nas próximas faturas." tone="danger" />
      </section>
      <SectionCard title="Filtros">
        <div className="grid gap-3 md:grid-cols-3">
          <input className={inputClassName} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por descrição" />
          <select className={inputClassName} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">Todos status</option>
            {installmentStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select className={inputClassName} value={cardFilter} onChange={(event) => setCardFilter(event.target.value)}>
            <option value="all">Todos cartões</option>
            {cards.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}
          </select>
        </div>
        {installmentFilter ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-mint-500/20 bg-mint-50 px-4 py-3 text-sm text-mint-900 dark:border-mint-400/20 dark:bg-mint-500/10 dark:text-mint-100">
            <span>
              Filtrando pelo parcelamento de origem.
            </span>
            <ActionButton variant="secondary" onClick={handleClearFilters}>Limpar filtro do parcelamento</ActionButton>
          </div>
        ) : null}
        <div className="mt-4">
          <ViewPreferenceActions onSave={handleSaveViewPreference} onRestore={handleRestoreViewPreference} onClearFilters={handleClearFilters} />
        </div>
      </SectionCard>
      <SectionCard title="Parcelamentos cadastrados">
        {loading ? (
          <p className="text-sm text-ink-600">Carregando parcelamentos...</p>
        ) : installments.length === 0 ? (
          <EmptyState title="Nenhum parcelamento" description="Cadastre parcelamentos para enxergar o impacto futuro antes de assumir novas decisões." />
        ) : filtered.length === 0 ? (
          <EmptyState title="Nenhum parcelamento no período" description="Ajuste o período ou os filtros para ver outros parcelamentos." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-ink-950/10 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-ink-600">
                <tr>
                  <th className="px-4 py-3">Descrição</th>
                  <th className="px-4 py-3">Valor mensal</th>
                  <th className="px-4 py-3">Categoria</th>
                  <th className="px-4 py-3">Parcela</th>
                  <th className="px-4 py-3">Origem</th>
                  <th className="px-4 py-3">Vínculo</th>
                  <th className="px-4 py-3">Contas geradas</th>
                  <th className="px-4 py-3">Início</th>
                  <th className="px-4 py-3">Fim</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-950/10">
                {filtered.map((item) => {
                  const generatedSummary = generatedSummaryByInstallment[item.id] ?? {
                    generatedCount: 0,
                    paidCount: 0,
                    pendingCount: 0,
                    nextDueDate: null,
                    remainingAmount: 0,
                  };

                  return (
                  <tr key={item.id}>
                    <td className="px-4 py-3">
                      {allowQuickTableEdit ? (
                        <QuickEditInput value={item.description} onCommit={(value) => void handleQuickUpdate(item, { description: value })} />
                      ) : (
                        <TitleButton onClick={() => setModal({ mode: "edit", installment: item })}>
                          {item.description}
                        </TitleButton>
                      )}
                      {item.invoice_id ? (
                        <p className="mt-1 max-w-72 text-xs leading-5 text-amberRisk-500">
                          Este parcelamento está vinculado a uma fatura. Verifique se o valor já está sendo contado na fatura.
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-ink-950">
                      {allowQuickTableEdit ? (
                        <QuickEditInput type="number" value={String(item.installment_amount)} onCommit={(value) => void handleQuickUpdate(item, { installment_amount: value })} />
                      ) : formatCurrency(Number(item.installment_amount))}
                    </td>
                    <td className="px-4 py-3">
                      {allowQuickTableEdit ? (
                        <QuickEditSelect value={item.category_id ?? ""} options={[{ value: "", label: "Sem categoria" }, ...scopedCategories.map((category) => ({ value: category.id, label: category.name }))]} onCommit={(value) => void handleQuickUpdate(item, { category_id: value })} />
                      ) : (
                        <CategoryBadge category={categories.find((category) => category.id === item.category_id)} />
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-600">{item.current_installment ?? item.installment_number}/{item.installment_total ?? item.installment_count}</td>
                    <td className="px-4 py-3">
                      <TextBadge tone={item.invoice_id || item.credit_card_id ? "info" : "neutral"}>
                        {getInstallmentOriginLabel(item)}
                      </TextBadge>
                    </td>
                    <td className="px-4 py-3 text-ink-600">{getInstallmentLinkLabel(item, cards, invoices, transactions)}</td>
                    <td className="px-4 py-3">
                      <div className="space-y-1 text-xs text-ink-600 dark:text-slate-300">
                        <p>{generatedSummary.generatedCount} gerada(s)</p>
                        <p>{generatedSummary.paidCount} paga(s)</p>
                        <p>{generatedSummary.pendingCount} pendente(s)</p>
                        <p>Próximo vencimento: {generatedSummary.nextDueDate ? formatDate(generatedSummary.nextDueDate) : "-"}</p>
                        <p>Restante: {formatCurrency(generatedSummary.remainingAmount)}</p>
                        {isCardControlledInstallment(item) ? (
                          <p className="max-w-56 text-amberRisk-600 dark:text-amberRisk-300">
                            Este parcelamento é controlado pelas faturas do cartão.
                          </p>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {allowQuickTableEdit ? (
                        <QuickEditInput type="date" value={item.start_date ?? item.due_month ?? ""} onCommit={(value) => void handleQuickUpdate(item, { start_date: value })} />
                      ) : formatDate(item.start_date ?? item.due_month)}
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {allowQuickTableEdit ? (
                        <QuickEditInput type="date" value={item.end_date ?? item.due_month ?? ""} onCommit={(value) => void handleQuickUpdate(item, { end_date: value })} />
                      ) : formatDate(item.end_date ?? item.due_month)}
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {allowQuickTableEdit ? (
                        <QuickEditSelect value={item.status} options={installmentStatusOptions} onCommit={(value) => void handleQuickUpdate(item, { status: value })} />
                      ) : optionLabel(installmentStatusOptions, item.status)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <ActionButton variant="secondary" onClick={() => setModal({ mode: "edit", installment: item })}>Editar</ActionButton>
                        <ActionButton
                          variant="secondary"
                          disabled={generatingAccountsId === item.id || isCardControlledInstallment(item)}
                          onClick={() => void handleGenerateAccounts(item)}
                          title={isCardControlledInstallment(item) ? "Este parcelamento é controlado pelas faturas do cartão." : undefined}
                        >
                          {generatingAccountsId === item.id ? "Gerando..." : "Gerar contas"}
                        </ActionButton>
                        <ActionButton
                          variant="secondary"
                          onClick={() => router.push(`/dashboard/accounts?installment=${item.id}`)}
                        >
                          Ver contas geradas
                        </ActionButton>
                        <ActionButton
                          variant="secondary"
                          disabled={payingInstallmentId === item.id || isCardControlledInstallment(item)}
                          onClick={() => void handleRegisterPayment(item)}
                          title={isCardControlledInstallment(item) ? "Este parcelamento é controlado pelas faturas do cartão." : undefined}
                        >
                          {payingInstallmentId === item.id ? "Pagando..." : "Registrar pagamento"}
                        </ActionButton>
                        <ActionButton variant="danger" onClick={() => void handleDelete(item)}>Excluir</ActionButton>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
      {modal ? (
        <InstallmentModal
          cards={cards}
          categories={categories}
          invoices={invoices}
          modal={modal}
          people={people}
          saving={saving}
          transactions={transactions}
          onClose={() => setModal(null)}
          onSubmit={(values) => void handleSubmit(values)}
        />
      ) : null}
      {paymentModal ? (
        <InstallmentPaymentModal
          modal={paymentModal}
          saving={payingInstallmentId === paymentModal.installment.id}
          onClose={() => setPaymentModal(null)}
          onSubmit={(values) => void handleSubmitPayment(values)}
        />
      ) : null}
      {pendingPayment && !linkedEntryContext ? (
        <InsufficientCashModal
          availability={pendingPayment.availability}
          onCancel={() => setPendingPayment(null)}
          onContinue={() => void handleContinuePaymentWithoutEntry()}
          onRegisterEntry={() => setLinkedEntryContext(pendingPayment.context)}
        />
      ) : null}
      {linkedEntryContext ? (
        <LinkedEntryModal
          context={linkedEntryContext}
          people={people}
          saving={payingInstallmentId !== null}
          onClose={() => setLinkedEntryContext(null)}
          onSubmit={(values) => void handleSubmitLinkedEntry(values)}
        />
      ) : null}
    </div>
  );
}

function InstallmentModal({
  cards,
  categories,
  invoices,
  modal,
  people,
  saving,
  transactions,
  onClose,
  onSubmit,
}: {
  cards: InstallmentCard[];
  categories: InstallmentCategory[];
  invoices: InstallmentInvoice[];
  modal: ModalState;
  people: InstallmentPerson[];
  saving: boolean;
  transactions: InstallmentTransaction[];
  onClose: () => void;
  onSubmit: (values: InstallmentFormValues) => void;
}) {
  const [values, setValues] = useState<InstallmentFormValues>(
    modal?.mode === "edit" ? installmentToFormValues(modal.installment) : emptyInstallmentForm,
  );
  const scopedCategories = useMemo(
    () => filterCategoriesByScopes(categories, categoryModuleDefinitions.accounts.scopes),
    [categories],
  );
  const selectedCategory = categories.find((category) => category.id === values.category_id);
  const selectedCategoryOutOfScope = isCategoryOutOfScope(selectedCategory, categoryModuleDefinitions.accounts.scopes);
  const filteredInvoices = values.credit_card_id
    ? invoices.filter((invoice) => invoice.credit_card_id === values.credit_card_id)
    : [];
  const filteredTransactions = transactions.filter((transaction) =>
    (!values.credit_card_id || transaction.credit_card_id === values.credit_card_id) &&
    (!values.invoice_id || transaction.invoice_id === values.invoice_id),
  );

  return (
    <Modal title={modal?.mode === "edit" ? "Editar parcelamento" : "Novo parcelamento"} onClose={onClose}>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); onSubmit(values); }}>
        <div className="rounded-md border border-ink-950/10 bg-slate-50 p-4 text-sm leading-6 text-ink-700 md:col-span-2">
          Use parcelamento para compromissos divididos em várias parcelas. Parcelamentos geram obrigações mensais em Contas. Não cadastre a mesma parcela manualmente em Contas para evitar duplicidade.
        </div>
        <div className="md:col-span-2"><FieldShell label="Descrição"><input required className={inputClassName} value={values.description} onChange={(event) => setValues({ ...values, description: event.target.value })} /></FieldShell></div>
        <FieldShell label="Valor total"><input min="0" step="0.01" type="number" className={inputClassName} value={values.total_amount} onChange={(event) => setValues({ ...values, total_amount: event.target.value })} /></FieldShell>
        <FieldShell label="Valor da parcela"><input min="0" step="0.01" type="number" className={inputClassName} value={values.installment_amount} onChange={(event) => setValues({ ...values, installment_amount: event.target.value })} /></FieldShell>
        <FieldShell label="Parcela atual"><input min="1" type="number" className={inputClassName} value={values.current_installment} onChange={(event) => setValues({ ...values, current_installment: event.target.value })} /></FieldShell>
        <FieldShell label="Total de parcelas"><input min="1" type="number" className={inputClassName} value={values.installment_total} onChange={(event) => setValues({ ...values, installment_total: event.target.value })} /></FieldShell>
        <FieldShell label="Início"><input required type="date" className={inputClassName} value={values.start_date} onChange={(event) => setValues({ ...values, start_date: event.target.value })} /></FieldShell>
        <FieldShell label="Fim"><input type="date" className={inputClassName} value={values.end_date} onChange={(event) => setValues({ ...values, end_date: event.target.value })} /></FieldShell>
        <FieldShell label="Origem">
          <select className={inputClassName} value={values.installment_origin} onChange={(event) => setValues({ ...values, installment_origin: event.target.value as InstallmentFormValues["installment_origin"] })}>
            {installmentOriginOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FieldShell>
        <FieldShell label="Cartão"><select className={inputClassName} value={values.credit_card_id} onChange={(event) => setValues({ ...values, credit_card_id: event.target.value, invoice_id: "", credit_card_transaction_id: "", installment_origin: event.target.value ? "card" : values.installment_origin })}><option value="">Sem cartão</option>{cards.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}</select></FieldShell>
        <FieldShell label="Fatura">
          <select className={inputClassName} value={values.invoice_id} disabled={!values.credit_card_id} onChange={(event) => setValues({ ...values, invoice_id: event.target.value, credit_card_transaction_id: "", installment_origin: event.target.value ? "invoice" : values.installment_origin })}>
            <option value="">{values.credit_card_id ? "Sem fatura" : "Selecione um cartão primeiro"}</option>
            {filteredInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{cards.find((card) => card.id === invoice.credit_card_id)?.name ?? "Cartão"} - {invoice.reference_month.slice(0, 7)} - vence {formatDate(invoice.due_date)} - {invoice.status}</option>)}
          </select>
          {!values.credit_card_id ? <p className="mt-2 text-xs text-ink-600">Selecione um cartão para listar as faturas correspondentes.</p> : null}
        </FieldShell>
        <FieldShell label="Lançamento de origem">
          <select className={inputClassName} value={values.credit_card_transaction_id} disabled={!values.credit_card_id} onChange={(event) => setValues({ ...values, credit_card_transaction_id: event.target.value })}>
            <option value="">{values.credit_card_id ? "Sem lançamento vinculado" : "Selecione um cartão primeiro"}</option>
            {filteredTransactions.map((transaction) => (
              <option key={transaction.id} value={transaction.id}>
                {transaction.description} · {formatDate(transaction.transaction_date)} · {formatCurrency(Number(transaction.amount))}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs leading-5 text-ink-600">
            Use este vínculo quando o parcelamento nasceu de um lançamento específico da fatura. O vínculo é rastreio e não duplica o valor.
          </p>
        </FieldShell>
        {values.invoice_id ? (
          <div className="rounded-md border border-amberRisk-500/20 bg-amberRisk-100 p-4 text-sm leading-6 text-ink-800 md:col-span-2">
            Este parcelamento está vinculado a uma fatura. Verifique se o valor já está sendo contado na fatura.
          </div>
        ) : null}
        <FieldShell label="Categoria"><CategorySelect categories={scopedCategories} value={selectedCategoryOutOfScope ? "" : values.category_id} onChange={(category_id) => setValues({ ...values, category_id })} />{selectedCategoryOutOfScope ? <p className="mt-2 text-xs text-amber-700">Categoria atual: <strong>{selectedCategory?.name}</strong>. Categoria fora do escopo desta tela.</p> : null}</FieldShell>
        <FieldShell label="Pessoa"><select className={inputClassName} value={values.person_id} onChange={(event) => setValues({ ...values, person_id: event.target.value })}><option value="">Sem pessoa</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></FieldShell>
        <FieldShell label="Status"><select className={inputClassName} value={values.status} onChange={(event) => setValues({ ...values, status: event.target.value })}>{installmentStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></FieldShell>
        <FieldShell label="Gerar parcelas em Contas?">
          <select
            className={inputClassName}
            value={String(values.generate_accounts)}
            disabled={Boolean(values.credit_card_id || values.invoice_id)}
            onChange={(event) => setValues({ ...values, generate_accounts: event.target.value === "true" })}
          >
            <option value="false">Não gerar agora</option>
            <option value="true">Gerar contas mensais</option>
          </select>
          {values.credit_card_id || values.invoice_id ? (
            <p className="mt-2 text-xs leading-5 text-amberRisk-600 dark:text-amberRisk-300">
              Este parcelamento é controlado pelas faturas do cartão.
            </p>
          ) : null}
        </FieldShell>
        <div className="md:col-span-2"><FieldShell label="Notas"><textarea rows={3} className={inputClassName} value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} /></FieldShell></div>
        <div className="flex justify-end gap-2 md:col-span-2"><ActionButton type="button" variant="secondary" onClick={onClose}>Cancelar</ActionButton><ActionButton type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</ActionButton></div>
      </form>
    </Modal>
  );
}

function InstallmentPaymentModal({
  modal,
  saving,
  onClose,
  onSubmit,
}: {
  modal: NonNullable<PaymentModalState>;
  saving: boolean;
  onClose: () => void;
  onSubmit: (values: RegisterInstallmentPaymentValues) => void;
}) {
  const [values, setValues] = useState<RegisterInstallmentPaymentValues>(modal.values);
  const total = Number(modal.installment.installment_total ?? modal.installment.installment_count);
  const current = Number(modal.installment.current_installment ?? modal.installment.installment_number ?? 1);
  const installmentNumbers = Array.from({ length: total }, (_, index) => index + 1);

  return (
    <Modal title="Registrar pagamento de parcela" onClose={onClose}>
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(values);
        }}
      >
        <div className="rounded-md border border-ink-950/10 bg-slate-50 p-4 text-sm leading-6 text-ink-700 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200 md:col-span-2">
          <strong>{modal.installment.description}</strong>
          <p>
            Escolha a parcela paga. Se a conta ainda não existir em Contas, o Hub cria uma conta vinculada e já marca como paga.
          </p>
        </div>
        <FieldShell label="Parcela">
          <select
            className={inputClassName}
            value={values.installmentNumber}
            onChange={(event) => setValues({ ...values, installmentNumber: Number(event.target.value) })}
          >
            {installmentNumbers.map((number) => (
              <option key={number} value={number}>
                Parcela {number}/{total}{number === current ? " - atual" : ""}
              </option>
            ))}
          </select>
        </FieldShell>
        <FieldShell label="Data do pagamento">
          <input
            required
            type="date"
            className={inputClassName}
            value={values.paymentDate}
            onChange={(event) => setValues({ ...values, paymentDate: event.target.value })}
          />
        </FieldShell>
        <FieldShell label="Valor pago">
          <input
            required
            min="0"
            step="0.01"
            type="number"
            className={inputClassName}
            value={values.paidAmount}
            onChange={(event) => setValues({ ...values, paidAmount: Number(event.target.value) })}
          />
        </FieldShell>
        <FieldShell label="Forma de pagamento">
          <select
            className={inputClassName}
            value={values.paymentMethod}
            onChange={(event) => setValues({ ...values, paymentMethod: event.target.value })}
          >
            {paymentMethodOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </FieldShell>
        <div className="md:col-span-2">
          <FieldShell label="Observação">
            <textarea
              rows={3}
              className={inputClassName}
              value={values.notes ?? ""}
              onChange={(event) => setValues({ ...values, notes: event.target.value })}
            />
          </FieldShell>
        </div>
        <div className="flex justify-end gap-2 md:col-span-2">
          <ActionButton type="button" variant="secondary" onClick={onClose}>Cancelar</ActionButton>
          <ActionButton type="submit" disabled={saving}>{saving ? "Registrando..." : "Registrar pagamento"}</ActionButton>
        </div>
      </form>
    </Modal>
  );
}

function getInstallmentOriginLabel(item: InstallmentRow) {
  if (item.invoice_id) return "Fatura";
  if (item.credit_card_id) return "Cartão";

  return installmentOriginOptions.find((option) => option.value === item.installment_origin)?.label ?? "Outro";
}

function getInstallmentLinkLabel(
  item: InstallmentRow,
  cards: InstallmentCard[],
  invoices: InstallmentInvoice[],
  transactions: InstallmentTransaction[],
) {
  if (item.credit_card_transaction_id) {
    const transaction = transactions.find((transactionItem) => transactionItem.id === item.credit_card_transaction_id);
    return transaction ? `Lançamento: ${transaction.description}` : "Lançamento vinculado";
  }

  if (item.invoice_id) {
    const invoice = invoices.find((invoiceItem) => invoiceItem.id === item.invoice_id);
    return invoice ? `Fatura ${invoice.reference_month.slice(0, 7)}` : "Fatura vinculada";
  }

  if (item.credit_card_id) {
    const card = cards.find((cardItem) => cardItem.id === item.credit_card_id);
    return card?.name ?? "Cartão vinculado";
  }

  return "Fora do cartão";
}

function buildInstallmentPaymentContext(item: InstallmentRow, amount: number, paymentDate: string, installmentNumber: number): LinkedEntryContext {
  const total = item.installment_total ?? item.installment_count;
  return {
    paymentType: "installment_payment",
    paymentId: item.id,
    title: `Entrada para parcela ${installmentNumber}/${total} - ${item.description}`,
    amount,
    date: paymentDate,
    defaultType: "available_cash",
    personId: item.person_id,
    notes: "Entrada criada para justificar pagamento de parcela.",
    installmentId: item.id,
  };
}

function isCardControlledInstallment(item: InstallmentRow) {
  return Boolean(item.credit_card_id || item.invoice_id || item.credit_card_transaction_id);
}
