"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { ActionButton, CrudFeedback, FieldShell, inputClassName, Modal, TitleButton } from "@/features/shared/crud-ui";
import { formatCurrency, formatDate } from "@/features/shared/format";
import { invoiceStatusOptions, optionLabel } from "@/features/shared/options";
import { PeriodFilter } from "@/features/shared/period-filter";
import { isAnyDateInPeriod, parsePeriodSearchParams } from "@/features/shared/period";
import type { FeedbackState } from "@/features/shared/types";
import { archiveInvoice, createInvoice, listInvoiceCards, listInvoices, updateInvoice } from "@/features/invoices/queries";
import { emptyInvoiceForm, invoiceToFormValues, type InvoiceCard, type InvoiceFormValues, type InvoiceRow } from "@/features/invoices/types";
import type { InvoicePaymentStatus } from "@/lib/supabase/types";
import { createClient } from "@/lib/supabase/client";

type ModalState =
  | { mode: "create"; invoice: null }
  | { mode: "edit"; invoice: InvoiceRow }
  | { mode: "payment"; invoice: InvoiceRow }
  | null;

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
  const [modal, setModal] = useState<ModalState>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());

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

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Pressão mensal" title="Faturas" description="Controle faturas por cartão e mês." action={<ActionButton onClick={() => setModal({ mode: "create", invoice: null })}>Nova fatura</ActionButton>} />
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
      </SectionCard>
      <SectionCard title="Faturas cadastradas">
        {loading ? (
          <p className="text-sm text-ink-600">Carregando faturas...</p>
        ) : invoices.length === 0 ? (
          <EmptyState title="Nenhuma fatura cadastrada" description="Crie faturas para lançar compras e acompanhar o impacto mensal." />
        ) : filteredInvoices.length === 0 ? (
          <EmptyState title="Nenhuma fatura no período" description="Ajuste o período ou os filtros para ver outras faturas." />
        ) : (
          <div className="space-y-4">
            {groupedInvoices.map((group) => {
              const collapsed = collapsedMonths.has(group.month);
              const total = group.rows.reduce((sum, invoice) => sum + Number(invoice.total_amount), 0);

              return (
                <div key={group.month} className="rounded-md border border-ink-950/10">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 bg-slate-50 px-4 py-3 text-left transition hover:bg-mint-100"
                    onClick={() => toggleMonth(group.month)}
                    aria-expanded={!collapsed}
                  >
                    <span>
                      <span className="block text-sm font-semibold text-ink-950">{group.label}</span>
                      <span className="mt-1 block text-xs text-ink-600">
                        {group.rows.length} fatura(s) · {formatCurrency(total)}
                      </span>
                    </span>
                    <span className="text-sm font-semibold text-mint-600">{collapsed ? "Expandir" : "Recolher"}</span>
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
    const month = nextReferenceMonth.slice(0, 7);
    const closingDate = buildMonthDate(month, card.closing_day);
    const dueMonth = card.due_day <= card.closing_day ? addMonths(month, 1) : month;
    const dueDate = buildMonthDate(dueMonth, card.due_day);
    setValues((current) => ({ ...current, credit_card_id: nextCardId, reference_month: nextReferenceMonth, closing_date: closingDate, due_date: dueDate }));
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

function buildMonthDate(month: string, day: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return `${month}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function addMonths(month: string, count: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 1 + count, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 1, 1);
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(date);
}
