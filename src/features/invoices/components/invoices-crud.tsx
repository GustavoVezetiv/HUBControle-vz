"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { ActionButton, CrudFeedback, FieldShell, inputClassName, Modal, TitleButton, ViewPreferenceActions } from "@/features/shared/crud-ui";
import { formatCurrency, formatDate } from "@/features/shared/format";
import { invoiceStatusOptions, optionLabel } from "@/features/shared/options";
import { PeriodFilter } from "@/features/shared/period-filter";
import { getPeriodValue, isAnyDateInPeriod, parsePeriodSearchParams, type PeriodValue } from "@/features/shared/period";
import type { FeedbackState } from "@/features/shared/types";
import { clearViewPreference, loadViewPreference, preferenceRecord, preferenceText, saveViewPreference } from "@/features/shared/view-preferences";
import { calculateInvoiceCycleForReferenceMonth, generateFutureInvoicesForCard } from "@/features/invoices/auto-invoices";
import { archiveInvoice, createInvoice, listInvoiceCards, listInvoices, updateInvoice } from "@/features/invoices/queries";
import { emptyInvoiceForm, invoiceToFormValues, type InvoiceCard, type InvoiceFormValues, type InvoiceRow } from "@/features/invoices/types";
import type { InvoicePaymentStatus } from "@/lib/supabase/types";
import { createClient } from "@/lib/supabase/client";

type ModalState =
  | { mode: "create"; invoice: null }
  | { mode: "edit"; invoice: InvoiceRow }
  | { mode: "payment"; invoice: InvoiceRow }
  | null;
type InvoicesViewPreference = {
  search?: string;
  cardFilter?: string;
  statusFilter?: string;
  period?: PeriodValue;
};

const invoicesDefaultViewPreference: Required<InvoicesViewPreference> = {
  search: "",
  cardFilter: "all",
  statusFilter: "all",
  period: parsePeriodSearchParams({}),
};

export function InvoicesCrud() {
  const searchParams = useSearchParams();
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [cards, setCards] = useState<InvoiceCard[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [cardFilter, setCardFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") ?? "all");
  const [period, setPeriod] = useState(() => parsePeriodSearchParams(Object.fromEntries(searchParams.entries())));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generatingInvoices, setGeneratingInvoices] = useState(false);
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());

  const hasActiveFilters = search.trim() !== "" || cardFilter !== "all" || statusFilter !== "all" || period.preset !== "all";

  const periodInvoices = useMemo(() => {
    return invoices.filter((invoice) =>
      isAnyDateInPeriod([invoice.due_date, invoice.reference_month], period),
    );
  }, [invoices, period]);

  const filteredInvoices = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return periodInvoices.filter((invoice) => {
      const card = cards.find((item) => item.id === invoice.credit_card_id);
      return (
        (!needle || (card?.name ?? "").toLowerCase().includes(needle) || invoice.reference_month.includes(needle)) &&
        (cardFilter === "all" || invoice.credit_card_id === cardFilter) &&
        (statusFilter === "all" || invoice.status === statusFilter)
      );
    });
  }, [cardFilter, cards, periodInvoices, search, statusFilter]);

  const summary = useMemo(() => {
    const openTotal = periodInvoices.filter((i) => i.status === "open" || i.status === "closed").reduce((s, i) => s + Number(i.total_amount), 0);
    const overdueTotal = periodInvoices.filter((i) => i.status === "overdue").reduce((s, i) => s + Number(i.total_amount), 0);
    const paidThisMonth = periodInvoices.filter((i) => i.status === "paid").reduce((s, i) => s + Number(i.paid_amount), 0);
    const nextDue = periodInvoices.filter((i) => i.status !== "paid" && i.status !== "cancelled").sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
    return { openTotal, overdueTotal, paidThisMonth, nextDue };
  }, [periodInvoices]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || loading) return;
    console.debug("Diagnóstico da listagem de faturas", {
      totalCarregadas: invoices.length,
      aposPeriodo: periodInvoices.length,
      aposFiltros: filteredInvoices.length,
      filtros: {
        periodo: period,
        cartao: cardFilter,
        status: statusFilter,
        busca: search.trim(),
      },
      observacao: "Faturas arquivadas não são carregadas na listagem principal. Use Arquivados para restaurar.",
    });
  }, [cardFilter, filteredInvoices.length, invoices.length, loading, period, periodInvoices.length, search, statusFilter]);

  const groupedInvoices = useMemo(() => {
    const groups = new Map<string, InvoiceRow[]>();

    filteredInvoices.forEach((invoice) => {
      const key = invoice.reference_month.slice(0, 7);
      groups.set(key, [...(groups.get(key) ?? []), invoice]);
    });

    return Array.from(groups.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([month, rows]) => ({
        month,
        label: formatMonthLabel(month),
        rows: rows.sort((a, b) => a.due_date.localeCompare(b.due_date)),
      }));
  }, [filteredInvoices]);

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
    const [invoiceResult, cardResult] = await Promise.all([listInvoices(client), listInvoiceCards(client)]);
    if (invoiceResult.error) setFeedback({ type: "error", message: invoiceResult.error.message });
    else setInvoices(invoiceResult.data ?? []);
    if (cardResult.error) setFeedback({ type: "error", message: cardResult.error.message });
    else setCards(cardResult.data ?? []);
    setLoading(false);
  }

  useEffect(() => { void loadData(); }, []);

  useEffect(() => {
    if (!userId) return;
    const preference = loadViewPreference<InvoicesViewPreference>("invoices", userId);
    if (!preference) return;

    setSearch(preferenceText(preference.search));
    setCardFilter(preferenceText(preference.cardFilter, "all"));
    if (!searchParams.get("status")) setStatusFilter(preferenceText(preference.statusFilter, "all"));
    if (!searchParams.get("period") && !searchParams.get("start") && !searchParams.get("end")) {
      setPeriod(preferenceRecord(preference.period, invoicesDefaultViewPreference.period));
    }
  }, [searchParams, userId]);

  function handleSaveViewPreference() {
    const saved = saveViewPreference("invoices", userId, {
      search,
      cardFilter,
      statusFilter,
      period,
    });
    setFeedback({
      type: saved ? "success" : "error",
      message: saved ? "Visualização padrão de faturas salva." : "Não foi possível salvar a visualização padrão.",
    });
  }

  function handleRestoreViewPreference() {
    clearViewPreference("invoices", userId);
    handleClearFilters();
    setFeedback({ type: "success", message: "Visualização padrão de faturas restaurada." });
  }

  function handleClearFilters() {
    setSearch(invoicesDefaultViewPreference.search);
    setCardFilter(invoicesDefaultViewPreference.cardFilter);
    setStatusFilter(invoicesDefaultViewPreference.statusFilter);
    setPeriod(invoicesDefaultViewPreference.period);
  }

  async function handleSubmit(values: InvoiceFormValues) {
    if (!values.credit_card_id || !values.reference_month || !values.due_date) {
      setFeedback({ type: "error", message: "Cartão, mês de referência e vencimento são obrigatórios." });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.reference_month) || !/^\d{4}-\d{2}-\d{2}$/.test(values.due_date)) {
      setFeedback({ type: "error", message: "Informe mês de referência e vencimento válidos." });
      return;
    }
    if (values.closing_date && !/^\d{4}-\d{2}-\d{2}$/.test(values.closing_date)) {
      setFeedback({ type: "error", message: "Informe uma data de fechamento válida." });
      return;
    }
    const totalAmount = Number(values.total_amount);
    const paidAmount = Number(values.paid_amount);
    if (Number.isNaN(totalAmount) || Number.isNaN(paidAmount) || totalAmount < 0 || paidAmount < 0) {
      setFeedback({ type: "error", message: "Valores devem ser maiores ou iguais a zero." });
      return;
    }
    if (!invoiceStatusOptions.some((option) => option.value === values.status)) {
      setFeedback({ type: "error", message: "Selecione um status válido para a fatura." });
      return;
    }
    if (!userId) return;
    setSaving(true);
    setFeedback(null);
    try {
      const client = createClient();
      const result = modal?.mode === "edit" ? await updateInvoice(client, modal.invoice.id, values) : await createInvoice(client, userId, values);
      if (result.error) {
        console.error("Erro técnico ao salvar fatura:", result.error);
        setFeedback({ type: "error", message: "Não foi possível salvar a fatura." });
      } else {
        setFeedback({ type: "success", message: modal?.mode === "edit" ? "Fatura atualizada." : "Fatura criada." });
        setModal(null);
        await loadData();
      }
    } catch (error) {
      console.error("Erro técnico ao salvar fatura:", error);
      setFeedback({ type: "error", message: "Não foi possível salvar a fatura." });
    } finally {
      setSaving(false);
    }
  }

  function toggleMonth(month: string) {
    setCollapsedMonths((current) => {
      const next = new Set(current);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });
  }

  function showAllInvoices() {
    setSearch("");
    setCardFilter("all");
    setStatusFilter("all");
    setPeriod(getPeriodValue("all"));
  }

  function clearFieldFilters() {
    setSearch("");
    setCardFilter("all");
    setStatusFilter("all");
  }

  async function handlePayment(invoice: InvoiceRow, paymentAmount: string) {
    const amount = Number(paymentAmount);
    if (Number.isNaN(amount) || amount <= 0) {
      setFeedback({ type: "error", message: "Informe um valor de pagamento maior que zero." });
      return;
    }

    const nextPaidAmount = Number(invoice.paid_amount) + amount;
    const total = Number(invoice.total_amount);
    const values = invoiceToFormValues(invoice);

    setSaving(true);
    setFeedback(null);
    try {
      const result = await updateInvoice(createClient(), invoice.id, {
        ...values,
        paid_amount: String(nextPaidAmount),
        status: nextPaidAmount >= total ? "paid" : "partial",
      });

      if (result.error) {
        console.error("Erro técnico ao registrar pagamento da fatura:", result.error);
        setFeedback({ type: "error", message: "Não foi possível registrar o pagamento." });
        return;
      }

      setFeedback({ type: "success", message: "Pagamento registrado." });
      setModal(null);
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao registrar pagamento da fatura:", error);
      setFeedback({ type: "error", message: "Não foi possível registrar o pagamento." });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(invoice: InvoiceRow) {
    if (!userId) return;
    if (!window.confirm("Arquivar esta fatura?")) return;
    const { error } = await archiveInvoice(createClient(), invoice.id, userId);
    if (error) setFeedback({ type: "error", message: error.message });
    else {
      setFeedback({ type: "success", message: "Fatura arquivada." });
      await loadData();
    }
  }

  async function handleGenerateFutureInvoices(values: { creditCardId: string; months: string }) {
    if (!userId) {
      setFeedback({ type: "error", message: "Sessão não encontrada." });
      return;
    }

    const months = Number(values.months);
    if (!values.creditCardId || Number.isNaN(months) || months < 1 || months > 24) {
      setFeedback({ type: "error", message: "Selecione um cartão e informe entre 1 e 24 meses." });
      return;
    }

    setGeneratingInvoices(true);
    setFeedback(null);

    try {
      const result = await generateFutureInvoicesForCard(createClient(), userId, values.creditCardId, months);
      const errorSuffix = result.errors.length > 0 ? ` Erros: ${result.errors.join(" ")}` : "";

      setFeedback({
        type: result.errors.length > 0 ? "error" : "success",
        message: `${result.created} fatura(s) criada(s). ${result.existing} já existia(m).${errorSuffix}`,
      });

      if (result.created > 0) {
        await loadData();
      }

      if (result.errors.length === 0) {
        setGenerateModalOpen(false);
      }
    } catch (error) {
      console.error("Erro técnico ao gerar faturas futuras:", error);
      setFeedback({ type: "error", message: "Não foi possível gerar as faturas futuras." });
    } finally {
      setGeneratingInvoices(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Pressão mensal"
        title="Faturas"
        description="Controle faturas por cartão e mês."
        action={
          <div className="flex flex-wrap gap-2">
            <ActionButton variant="secondary" onClick={() => setGenerateModalOpen(true)}>Gerar faturas futuras</ActionButton>
            <ActionButton onClick={() => setModal({ mode: "create", invoice: null })}>Nova fatura</ActionButton>
          </div>
        }
      />
      <CrudFeedback feedback={feedback} />
      <PeriodFilter value={period} onChange={setPeriod} syncUrl />
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Faturas abertas" value={formatCurrency(summary.openTotal)} helper="Abertas ou fechadas." tone="warning" />
        <StatCard label="Faturas atrasadas" value={formatCurrency(summary.overdueTotal)} helper="Maior risco." tone="danger" />
        <StatCard label="Pago no período" value={formatCurrency(summary.paidThisMonth)} helper="Faturas pagas no período filtrado." tone="success" />
        <StatCard label="Próximo vencimento" value={summary.nextDue ? formatDate(summary.nextDue.due_date) : "-"} helper={summary.nextDue ? formatCurrency(Number(summary.nextDue.total_amount)) : "Sem fatura aberta."} tone="info" />
      </section>
      <SectionCard title="Filtros">
        <div className="grid gap-3 md:grid-cols-3">
          <input className={inputClassName} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por cartão ou mês" />
          <select className={inputClassName} value={cardFilter} onChange={(e) => setCardFilter(e.target.value)}><option value="all">Todos cartões</option>{cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select className={inputClassName} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">Todos status</option>{invoiceStatusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-ink-950/10 bg-slate-50 px-4 py-3 text-sm text-ink-700 dark:border-slate-700 dark:bg-slate-900/75 dark:text-slate-200">
          <span>
            Mostrando <strong>{filteredInvoices.length}</strong> de <strong>{invoices.length}</strong> faturas carregadas.
            {period.preset !== "all" ? " O período também filtra por vencimento ou mês de referência." : " Período em Todos."}
          </span>
          <div className="flex flex-wrap gap-2">
            <ActionButton type="button" variant="secondary" onClick={clearFieldFilters} disabled={!search.trim() && cardFilter === "all" && statusFilter === "all"}>
              Limpar filtros
            </ActionButton>
            <ActionButton type="button" variant="secondary" onClick={showAllInvoices} disabled={!hasActiveFilters}>
              Mostrar todas
            </ActionButton>
          </div>
        </div>
        <div className="mt-4">
          <ViewPreferenceActions onSave={handleSaveViewPreference} onRestore={handleRestoreViewPreference} onClearFilters={handleClearFilters} />
        </div>
      </SectionCard>
      <SectionCard title="Faturas cadastradas">
        {loading ? (
          <p className="text-sm text-ink-600">Carregando faturas...</p>
        ) : invoices.length === 0 ? (
          <EmptyState title="Nenhuma fatura cadastrada" description="Crie faturas para lançar compras e acompanhar o impacto mensal." />
        ) : filteredInvoices.length === 0 ? (
          <div className="space-y-4">
            <EmptyState title="Nenhuma fatura no período" description="Ajuste o período ou os filtros para ver outras faturas. Faturas arquivadas ficam em Arquivados e podem ser restauradas por lá." />
            <div className="flex justify-center gap-2">
              <ActionButton type="button" variant="secondary" onClick={showAllInvoices}>
                Mostrar todas
              </ActionButton>
              <Link className="hub-action hub-action-secondary rounded-md border border-ink-950/10 px-4 py-2.5 text-sm font-semibold text-ink-950 hover:border-mint-500 hover:text-mint-600" href="/dashboard/archived">
                Ver arquivados
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {groupedInvoices.map((group) => {
              const collapsed = collapsedMonths.has(group.month);
              const total = group.rows.reduce((sum, invoice) => sum + Number(invoice.total_amount), 0);

              return (
                <div key={group.month} className="rounded-md border border-ink-950/10 dark:border-slate-700">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 bg-slate-50 px-4 py-3 text-left transition hover:bg-mint-100 dark:bg-slate-900/75 dark:hover:bg-slate-800"
                    onClick={() => toggleMonth(group.month)}
                    aria-expanded={!collapsed}
                  >
                    <span>
                      <span className="block text-sm font-semibold text-ink-950 dark:text-slate-100">{group.label}</span>
                      <span className="mt-1 block text-xs text-ink-600 dark:text-slate-300">
                        {group.rows.length} fatura(s) · {formatCurrency(total)}
                      </span>
                    </span>
                    <span className="text-sm font-semibold text-mint-600 dark:text-mint-300">{collapsed ? "Expandir" : "Recolher"}</span>
                  </button>
                  {collapsed ? null : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-ink-950/10 text-left text-sm">
                        <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-ink-600">
                          <tr>
                            <th className="px-4 py-3">Cartão</th>
                            <th className="px-4 py-3">Mês</th>
                            <th className="px-4 py-3">Vencimento</th>
                            <th className="px-4 py-3">Total</th>
                            <th className="px-4 py-3">Pago</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3 text-right">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-ink-950/10">
                          {group.rows.map((invoice) => (
                            <tr key={invoice.id}>
                              <td className="px-4 py-3">
                                <TitleButton onClick={() => setModal({ mode: "edit", invoice })}>
                                  {cards.find((card) => card.id === invoice.credit_card_id)?.name ?? "-"}
                                </TitleButton>
                              </td>
                              <td className="px-4 py-3 text-ink-600">{invoice.reference_month.slice(0, 7)}</td>
                              <td className="px-4 py-3 text-ink-600">{formatDate(invoice.due_date)}</td>
                              <td className="px-4 py-3 text-ink-950">{formatCurrency(Number(invoice.total_amount))}</td>
                              <td className="px-4 py-3 text-ink-600">{formatCurrency(Number(invoice.paid_amount))}</td>
                              <td className="px-4 py-3 text-ink-600">{optionLabel(invoiceStatusOptions, invoice.status)}</td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap justify-end gap-2">
                                  <Link
                                    className="hub-action hub-action-secondary rounded-md border border-ink-950/10 px-4 py-2.5 text-sm font-semibold text-ink-950 hover:border-mint-500 hover:text-mint-600"
                                    href={`/dashboard/invoices/${invoice.id}`}
                                  >
                                    Lançamentos
                                  </Link>
                                  <ActionButton variant="secondary" onClick={() => setModal({ mode: "payment", invoice })}>Registrar pagamento</ActionButton>
                                  <ActionButton variant="secondary" onClick={() => setModal({ mode: "edit", invoice })}>Editar</ActionButton>
                                  <ActionButton variant="danger" onClick={() => void handleDelete(invoice)}>Arquivar</ActionButton>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
      {modal?.mode === "create" || modal?.mode === "edit" ? <InvoiceModal modal={modal} cards={cards} saving={saving} onClose={() => setModal(null)} onSubmit={(values) => void handleSubmit(values)} /> : null}
      {modal?.mode === "payment" ? <InvoicePaymentModal invoice={modal.invoice} cards={cards} saving={saving} onClose={() => setModal(null)} onSubmit={(amount) => void handlePayment(modal.invoice, amount)} /> : null}
      {generateModalOpen ? (
        <GenerateFutureInvoicesModal
          cards={cards}
          generating={generatingInvoices}
          onClose={() => setGenerateModalOpen(false)}
          onSubmit={(values) => void handleGenerateFutureInvoices(values)}
        />
      ) : null}
    </div>
  );
}

function InvoiceModal({ modal, cards, saving, onClose, onSubmit }: { modal: Extract<ModalState, { mode: "create" | "edit" }>; cards: InvoiceCard[]; saving: boolean; onClose: () => void; onSubmit: (values: InvoiceFormValues) => void; }) {
  const [values, setValues] = useState<InvoiceFormValues>(modal?.mode === "edit" ? invoiceToFormValues(modal.invoice) : emptyInvoiceForm);
  function applySuggestedDates(nextCardId: string, nextReferenceMonth: string) {
    const card = cards.find((item) => item.id === nextCardId);
    if (!card || !nextReferenceMonth || !card.closing_day || !card.due_day) {
      setValues((current) => ({ ...current, credit_card_id: nextCardId, reference_month: nextReferenceMonth }));
      return;
    }
    try {
      const cycle = calculateInvoiceCycleForReferenceMonth(card, nextReferenceMonth);
      setValues((current) => ({
        ...current,
        credit_card_id: nextCardId,
        reference_month: cycle.reference_month,
        closing_date: cycle.closing_date,
        due_date: cycle.due_date,
      }));
    } catch {
      setValues((current) => ({ ...current, credit_card_id: nextCardId, reference_month: nextReferenceMonth }));
    }
  }
  return <Modal title={modal?.mode === "edit" ? "Editar fatura" : "Nova fatura"} onClose={onClose}><form className="grid gap-4 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); onSubmit(values); }}>
    <FieldShell label="Cartão"><select required className={inputClassName} value={values.credit_card_id} onChange={(e) => applySuggestedDates(e.target.value, values.reference_month)}><option value="">Selecione</option>{cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></FieldShell>
    <FieldShell label="Mês de referência"><input required type="month" className={inputClassName} value={values.reference_month.slice(0, 7)} onChange={(e) => applySuggestedDates(values.credit_card_id, `${e.target.value}-01`)} /></FieldShell>
    <FieldShell label="Fechamento"><input type="date" className={inputClassName} value={values.closing_date} onChange={(e) => setValues({ ...values, closing_date: e.target.value })} /></FieldShell>
    <FieldShell label="Vencimento"><input required type="date" className={inputClassName} value={values.due_date} onChange={(e) => setValues({ ...values, due_date: e.target.value })} /></FieldShell>
    <FieldShell label="Valor total"><input type="number" min="0" step="0.01" className={inputClassName} value={values.total_amount} onChange={(e) => setValues({ ...values, total_amount: e.target.value })} /></FieldShell>
    <FieldShell label="Valor pago"><input type="number" min="0" step="0.01" className={inputClassName} value={values.paid_amount} onChange={(e) => setValues({ ...values, paid_amount: e.target.value })} /></FieldShell>
    <FieldShell label="Status"><select className={inputClassName} value={values.status} onChange={(e) => setValues({ ...values, status: e.target.value as InvoicePaymentStatus })}>{invoiceStatusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></FieldShell>
    <div className="md:col-span-2"><FieldShell label="Notas"><textarea rows={3} className={inputClassName} value={values.notes} onChange={(e) => setValues({ ...values, notes: e.target.value })} /></FieldShell></div>
    <div className="flex justify-end gap-2 md:col-span-2"><ActionButton type="button" variant="secondary" onClick={onClose}>Cancelar</ActionButton><ActionButton type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</ActionButton></div>
  </form></Modal>;
}

function GenerateFutureInvoicesModal({
  cards,
  generating,
  onClose,
  onSubmit,
}: {
  cards: InvoiceCard[];
  generating: boolean;
  onClose: () => void;
  onSubmit: (values: { creditCardId: string; months: string }) => void;
}) {
  const [values, setValues] = useState({ creditCardId: "", months: "12" });

  return (
    <Modal title="Gerar faturas futuras" description="Cria apenas faturas que ainda não existem para o cartão selecionado." onClose={onClose}>
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(values);
        }}
      >
        <FieldShell label="Cartão">
          <select
            required
            className={inputClassName}
            value={values.creditCardId}
            onChange={(event) => setValues({ ...values, creditCardId: event.target.value })}
          >
            <option value="">Selecione</option>
            {cards.map((card) => (
              <option key={card.id} value={card.id}>
                {card.name}{card.issuer ? ` - ${card.issuer}` : ""}
              </option>
            ))}
          </select>
        </FieldShell>
        <FieldShell label="Quantidade de meses">
          <input
            required
            min="1"
            max="24"
            type="number"
            className={inputClassName}
            value={values.months}
            onChange={(event) => setValues({ ...values, months: event.target.value })}
          />
        </FieldShell>
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950 shadow-sm dark:border-amber-400/50 dark:bg-amber-950/35 dark:text-amber-100 md:col-span-2">
          O sistema usa fechamento e vencimento do cartão. Faturas pagas não são alteradas e faturas já existentes não são duplicadas.
        </p>
        <div className="flex justify-end gap-2 md:col-span-2">
          <ActionButton type="button" variant="secondary" onClick={onClose}>Cancelar</ActionButton>
          <ActionButton type="submit" disabled={generating}>{generating ? "Gerando..." : "Gerar faturas"}</ActionButton>
        </div>
      </form>
    </Modal>
  );
}

function InvoicePaymentModal({ invoice, cards, saving, onClose, onSubmit }: { invoice: InvoiceRow; cards: InvoiceCard[]; saving: boolean; onClose: () => void; onSubmit: (amount: string) => void }) {
  const pending = Math.max(Number(invoice.total_amount) - Number(invoice.paid_amount), 0);
  const [amount, setAmount] = useState(String(pending));
  const cardName = cards.find((card) => card.id === invoice.credit_card_id)?.name ?? "Cartão";

  return (
    <Modal title="Registrar pagamento" description="O pagamento soma ao valor já pago da fatura. Não cria parcelamento nem próxima fatura." onClose={onClose}>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); onSubmit(amount); }}>
        <FieldShell label="Cartão"><input className={inputClassName} value={cardName} disabled /></FieldShell>
        <FieldShell label="Mês"><input className={inputClassName} value={invoice.reference_month.slice(0, 7)} disabled /></FieldShell>
        <FieldShell label="Total"><input className={inputClassName} value={formatCurrency(Number(invoice.total_amount))} disabled /></FieldShell>
        <FieldShell label="Pago"><input className={inputClassName} value={formatCurrency(Number(invoice.paid_amount))} disabled /></FieldShell>
        <FieldShell label="Pendente"><input className={inputClassName} value={formatCurrency(pending)} disabled /></FieldShell>
        <FieldShell label="Valor do pagamento"><input required min="0.01" step="0.01" type="number" className={inputClassName} value={amount} onChange={(event) => setAmount(event.target.value)} /></FieldShell>
        <div className="flex justify-end gap-2 md:col-span-2"><ActionButton type="button" variant="secondary" onClick={onClose}>Cancelar</ActionButton><ActionButton type="submit" disabled={saving}>{saving ? "Salvando..." : "Registrar pagamento"}</ActionButton></div>
      </form>
    </Modal>
  );
}

function formatMonthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 1, 1);
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(date);
}
