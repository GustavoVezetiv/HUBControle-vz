"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { calculateInvoiceSummary, type InvoiceCard, type InvoiceReimbursementRow, type InvoiceRow } from "@/features/invoices/types";
import { ActionButton, BooleanBadge, CategoryBadge, CategorySelect, CrudFeedback, FieldShell, inputClassName, Modal, QuickEditInput, QuickEditSelect, TextBadge } from "@/features/shared/crud-ui";
import { formatCurrency, formatDate } from "@/features/shared/format";
import { optionLabel, ownershipTypeOptions } from "@/features/shared/options";
import { getQuickTableEditPreference } from "@/features/shared/quick-edit";
import type { FeedbackState } from "@/features/shared/types";
import {
  createExpectedReimbursementForTransaction,
  createTransaction,
  archiveTransaction,
  generateInstallmentTransactions,
  generateRecurringTransactions,
  listTransactionSupportData,
  updateTransaction,
} from "@/features/transactions/queries";
import {
  emptyTransactionForm,
  transactionToFormValues,
  type TransactionCategory,
  type TransactionFormValues,
  type TransactionInvoice,
  type TransactionPerson,
  type TransactionRow,
} from "@/features/transactions/types";
import { createClient } from "@/lib/supabase/client";
import type { OwnershipType } from "@/lib/supabase/types";

type ModalState = { mode: "create"; transaction: null } | { mode: "edit"; transaction: TransactionRow } | null;

export function InvoiceTransactionsCrud({ invoiceId }: { invoiceId: string }) {
  const [invoice, setInvoice] = useState<InvoiceRow | null>(null);
  const [cards, setCards] = useState<InvoiceCard[]>([]);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [reimbursements, setReimbursements] = useState<InvoiceReimbursementRow[]>([]);
  const [categories, setCategories] = useState<TransactionCategory[]>([]);
  const [people, setPeople] = useState<TransactionPerson[]>([]);
  const [invoices, setInvoices] = useState<TransactionInvoice[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [personFilter, setPersonFilter] = useState("all");
  const [ownershipFilter, setOwnershipFilter] = useState("all");
  const [reimbursableFilter, setReimbursableFilter] = useState("all");
  const [installmentFilter, setInstallmentFilter] = useState("all");
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [allowQuickTableEdit, setAllowQuickTableEdit] = useState(false);

  const cardName = cards.find((card) => card.id === invoice?.credit_card_id)?.name ?? "Cartão";
  const filteredTransactions = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return transactions.filter((transaction) => {
      const isInstallment = Boolean(transaction.installment_number && transaction.installment_total);

      return (
        (!needle || transaction.description.toLowerCase().includes(needle)) &&
        (categoryFilter === "all" || transaction.category_id === categoryFilter) &&
        (personFilter === "all" || transaction.person_id === personFilter) &&
        (ownershipFilter === "all" || transaction.ownership_type === ownershipFilter) &&
        (reimbursableFilter === "all" || String(transaction.is_reimbursable) === reimbursableFilter) &&
        (installmentFilter === "all" || String(isInstallment) === installmentFilter)
      );
    });
  }, [categoryFilter, installmentFilter, ownershipFilter, personFilter, reimbursableFilter, search, transactions]);
  const summary = useMemo(
    () => (invoice ? calculateInvoiceSummary(invoice, filteredTransactions, reimbursements) : null),
    [filteredTransactions, invoice, reimbursements],
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    const client = createClient();
    const { data: auth } = await client.auth.getUser();
    if (!auth.user) {
      setFeedback({ type: "error", message: "Sessão não encontrada." });
      setLoading(false);
      return;
    }

    setUserId(auth.user.id);
    const [invoiceResult, cardsResult, transactionsResult, reimbursementsResult, support, quickEdit] =
      await Promise.all([
        client.from("credit_card_invoices").select("*").eq("id", invoiceId).single(),
        client.from("credit_cards").select("id,name,issuer,closing_day,due_day").order("name", { ascending: true }),
        client
          .from("credit_card_transactions")
          .select("*")
          .eq("invoice_id", invoiceId)
          .is("archived_at", null)
          .order("transaction_date", { ascending: false }),
        client.from("reimbursements").select("*").eq("credit_card_invoice_id", invoiceId).is("archived_at", null),
        listTransactionSupportData(client),
        getQuickTableEditPreference(client, auth.user.id),
      ]);

    if (invoiceResult.error) setFeedback({ type: "error", message: invoiceResult.error.message });
    else setInvoice(invoiceResult.data);
    if (cardsResult.error) setFeedback({ type: "error", message: cardsResult.error.message });
    else setCards(cardsResult.data ?? []);
    if (transactionsResult.error) setFeedback({ type: "error", message: transactionsResult.error.message });
    else setTransactions(transactionsResult.data ?? []);
    if (reimbursementsResult.error) setFeedback({ type: "error", message: reimbursementsResult.error.message });
    else setReimbursements(reimbursementsResult.data ?? []);
    if (!support.categories.error) setCategories(support.categories.data ?? []);
    if (!support.people.error) setPeople(support.people.data ?? []);
    if (!support.invoices.error) setInvoices(support.invoices.data ?? []);
    setAllowQuickTableEdit(quickEdit);
    setLoading(false);
  }, [invoiceId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleSubmit(values: TransactionFormValues) {
    if (!values.credit_card_id || !values.transaction_date || !values.description.trim()) {
      setFeedback({ type: "error", message: "Cartão, data e descrição são obrigatórios." });
      return;
    }
    if (Number(values.amount) < 0) {
      setFeedback({ type: "error", message: "O valor deve ser maior ou igual a zero." });
      return;
    }
    const requiresPerson = values.ownership_type !== "personal";
    if (requiresPerson && !values.person_id) {
      setFeedback({ type: "error", message: "Informe a pessoa responsável quando a despesa não for pessoal." });
      return;
    }
    if (values.ownership_type === "personal" && (values.person_id || values.is_reimbursable)) {
      setFeedback({ type: "error", message: "Despesa pessoal não precisa de pessoa responsável nem reembolso." });
      return;
    }
    if (values.is_installment_purchase) {
      const current = Number(values.installment_number);
      const total = Number(values.installment_total);
      if (!values.installment_number || !values.installment_total || current < 1 || total < 1 || current > total) {
        setFeedback({ type: "error", message: "Informe parcela atual e total, com parcela atual menor ou igual ao total." });
        return;
      }
    }
    if (values.is_recurring) {
      const recurrenceStart = values.recurrence_start_date || values.transaction_date;

      if (!recurrenceStart) {
        setFeedback({ type: "error", message: "Informe a data inicial da recorrência." });
        return;
      }

      if (values.recurrence_end_date && values.recurrence_end_date < recurrenceStart) {
        setFeedback({ type: "error", message: "A data final da recorrência deve ser depois da data inicial." });
        return;
      }

      const occurrences = Number(values.recurrence_occurrences || 0);
      if (Number.isNaN(occurrences) || occurrences < 0 || occurrences > 24) {
        setFeedback({ type: "error", message: "A quantidade de ocorrências deve ficar entre 0 e 24." });
        return;
      }
    }
    if (values.is_reimbursable && !values.person_id) {
      setFeedback({ type: "error", message: "Informe a pessoa responsável pelo reembolso." });
      return;
    }
    if (!userId) return;

    setSaving(true);
    setFeedback(null);
    try {
      const client = createClient();
      const result =
        modal?.mode === "edit"
          ? await updateTransaction(client, modal.transaction.id, values)
          : await createTransaction(client, userId, values);

      if (result.error) {
        console.error("Erro técnico ao salvar lançamento:", result.error);
        setFeedback({ type: "error", message: "Não foi possível salvar o lançamento." });
        return;
      }

      if (modal?.mode === "create" && values.create_reimbursement && values.is_reimbursable) {
        const reimbursementResult = await createExpectedReimbursementForTransaction(
          client,
          userId,
          result.data,
          values.reimbursement_expected_date,
        );
        if (reimbursementResult.error) {
          console.error("Erro técnico ao criar reembolso esperado:", reimbursementResult.error);
          setFeedback({ type: "error", message: "Lançamento salvo, mas não foi possível criar o reembolso esperado." });
          return;
        }
      }
      let generationMessage = "";
      if (result.data && modal?.mode === "create" && values.is_installment_purchase) {
        const installmentGeneration = await generateInstallmentTransactions(client, userId, result.data);

        if (installmentGeneration.error) {
          setFeedback({ type: "error", message: installmentGeneration.error.message });
          return;
        }

        if (installmentGeneration.created || installmentGeneration.skipped) {
          generationMessage += ` ${installmentGeneration.created} parcela(s) futura(s) criada(s), ${installmentGeneration.skipped} já existia(m).`;
        }
      }

      const occurrences = Number(values.recurrence_occurrences || 0);

      if (result.data && values.is_recurring && occurrences > 0) {
        const generation = await generateRecurringTransactions(client, userId, result.data, occurrences);

        if (generation.error) {
          setFeedback({ type: "error", message: generation.error.message });
          return;
        }

        generationMessage = ` ${generation.created} lançamento(s) recorrente(s) criado(s), ${generation.skipped} já existia(m).`;
        if (generation.reimbursementCreated || generation.reimbursementSkipped) {
          generationMessage += ` ${generation.reimbursementCreated} reembolso(s) vinculado(s) criado(s), ${generation.reimbursementSkipped} já existia(m).`;
        }
      }
      setFeedback({
        type: "success",
        message: `${modal?.mode === "edit" ? "Lançamento atualizado." : "Lançamento criado."}${generationMessage}`,
      });
      setModal(null);
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao salvar lançamento:", error);
      setFeedback({ type: "error", message: "Não foi possível salvar o lançamento." });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(transaction: TransactionRow) {
    if (!userId) return;
    if (!window.confirm("Arquivar este lançamento?")) return;
    const { error } = await archiveTransaction(createClient(), transaction.id, userId);
    if (error) setFeedback({ type: "error", message: error.message });
    else {
      setFeedback({ type: "success", message: "Lançamento arquivado." });
      await loadData();
    }
  }

  async function handleQuickUpdate(transaction: TransactionRow, patch: Partial<TransactionFormValues>) {
    const result = await updateTransaction(createClient(), transaction.id, {
      ...transactionToFormValues(transaction),
      ...patch,
    });

    if (result.error) {
      console.error("Erro técnico ao editar lançamento rapidamente:", result.error);
      setFeedback({ type: "error", message: "Não foi possível salvar a edição rápida." });
      return;
    }

    setFeedback({ type: "success", message: "Lançamento atualizado." });
    await loadData();
  }

  async function handleGenerateRecurring(transaction: TransactionRow) {
    if (!userId) {
      setFeedback({ type: "error", message: "Sessão não encontrada." });
      return;
    }

    const raw = window.prompt("Quantas próximas ocorrências deseja gerar? Máximo 24.", "12");
    if (!raw) return;

    const occurrences = Number(raw);
    if (Number.isNaN(occurrences) || occurrences < 1 || occurrences > 24) {
      setFeedback({ type: "error", message: "Informe uma quantidade entre 1 e 24." });
      return;
    }

    setGeneratingId(transaction.id);
    setFeedback(null);

    try {
      const result = await generateRecurringTransactions(createClient(), userId, transaction, occurrences);

      if (result.error) {
        setFeedback({ type: "error", message: result.error.message });
        return;
      }

      let message = `${result.created} lançamento(s) criado(s). ${result.skipped} já existia(m).`;
      if (result.reimbursementCreated || result.reimbursementSkipped) {
        message += ` ${result.reimbursementCreated} reembolso(s) vinculado(s) criado(s). ${result.reimbursementSkipped} já existia(m).`;
      }

      setFeedback({ type: "success", message });
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao gerar lançamentos recorrentes:", error);
      setFeedback({ type: "error", message: "Não foi possível gerar os próximos lançamentos recorrentes." });
    } finally {
      setGeneratingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Fatura"
        title={invoice ? `${cardName} - ${invoice.reference_month.slice(0, 7)}` : "Lançamentos"}
        description="Separe despesa pessoal, despesa de terceiro e valores reembolsáveis dentro da fatura."
        action={<ActionButton onClick={() => setModal({ mode: "create", transaction: null })}>Novo lançamento</ActionButton>}
      />
      <CrudFeedback feedback={feedback} />

      {summary ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total filtrado" value={formatCurrency(summary.transactionTotal)} helper="Soma dos lançamentos visíveis." tone="info" />
          <StatCard label="Pendente da fatura" value={formatCurrency(summary.pendingAmount)} helper="Total declarado da fatura menos valor pago." tone="warning" />
          <StatCard label="Reembolsável filtrado" value={formatCurrency(summary.reimbursableAmount)} helper="Parte visível vinculada a terceiros ou família." tone="warning" />
          <StatCard label="Custo pessoal líquido" value={formatCurrency(summary.netPersonalCost)} helper="Lançamentos filtrados menos reembolsos esperados." tone="success" />
        </section>
      ) : null}

      <SectionCard title="Filtros" description="Refine os lançamentos desta fatura.">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <input className={inputClassName} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar descrição" />
          <CategorySelect
            categories={categories}
            value={categoryFilter === "all" ? "" : categoryFilter}
            placeholder="Todas categorias"
            onChange={(value) => setCategoryFilter(value || "all")}
          />
          <select className={inputClassName} value={personFilter} onChange={(event) => setPersonFilter(event.target.value)}>
            <option value="all">Todas pessoas</option>
            {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
          <select className={inputClassName} value={ownershipFilter} onChange={(event) => setOwnershipFilter(event.target.value)}>
            <option value="all">Todos tipos</option>
            {ownershipTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select className={inputClassName} value={reimbursableFilter} onChange={(event) => setReimbursableFilter(event.target.value)}>
            <option value="all">Reembolsável: todos</option>
            <option value="true">Sim</option>
            <option value="false">Não</option>
          </select>
          <select className={inputClassName} value={installmentFilter} onChange={(event) => setInstallmentFilter(event.target.value)}>
            <option value="all">Parcelada: todas</option>
            <option value="true">Sim</option>
            <option value="false">Não</option>
          </select>
        </div>
      </SectionCard>

      <SectionCard
        title="Aviso financeiro"
        description="Reembolso reduz impacto de caixa, mas não é renda livre."
      >
        <p className="text-sm leading-6 text-ink-600">
          Use reembolsos para rastrear quem deve cobrir a despesa. O dinheiro recebido por Pix deve
          ficar ligado ao lançamento original para não inflar a renda real.
        </p>
      </SectionCard>

      <SectionCard title="Lançamentos da fatura">
        {loading ? (
          <p className="text-sm text-ink-600">Carregando lançamentos...</p>
        ) : transactions.length === 0 ? (
          <EmptyState title="Nenhum lançamento" description="Cadastre compras da fatura e marque o que é reembolsável." />
        ) : filteredTransactions.length === 0 ? (
          <EmptyState title="Nenhum lançamento encontrado" description="Ajuste os filtros para ver outros lançamentos desta fatura." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-ink-950/10 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-ink-600">
                <tr>
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">Descrição</th>
                  <th className="px-4 py-3">Valor</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Categoria</th>
                  <th className="px-4 py-3">Pessoa</th>
                  <th className="px-4 py-3">Reembolsável</th>
                  <th className="px-4 py-3">Recorrência</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-950/10">
                {filteredTransactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td className="px-4 py-3 text-ink-600">
                      {allowQuickTableEdit ? (
                        <QuickEditInput type="date" value={transaction.transaction_date} onCommit={(value) => void handleQuickUpdate(transaction, { transaction_date: value })} />
                      ) : formatDate(transaction.transaction_date)}
                    </td>
                    <td className="px-4 py-3 font-medium text-ink-950">
                      {allowQuickTableEdit ? (
                        <QuickEditInput value={transaction.description} onCommit={(value) => void handleQuickUpdate(transaction, { description: value })} />
                      ) : transaction.description}
                    </td>
                    <td className="px-4 py-3 text-ink-950">
                      {allowQuickTableEdit ? (
                        <QuickEditInput type="number" value={String(transaction.amount)} onCommit={(value) => void handleQuickUpdate(transaction, { amount: value })} />
                      ) : formatCurrency(Number(transaction.amount))}
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {allowQuickTableEdit ? (
                        <QuickEditSelect value={transaction.ownership_type} options={ownershipTypeOptions} onCommit={(value) => void handleQuickUpdate(transaction, { ownership_type: value as OwnershipType })} />
                      ) : optionLabel(ownershipTypeOptions, transaction.ownership_type)}
                    </td>
                    <td className="px-4 py-3">
                      {allowQuickTableEdit ? (
                        <QuickEditSelect value={transaction.category_id ?? ""} options={[{ value: "", label: "Sem categoria" }, ...categories.map((category) => ({ value: category.id, label: category.name }))]} onCommit={(value) => void handleQuickUpdate(transaction, { category_id: value })} />
                      ) : (
                        <CategoryBadge category={categories.find((category) => category.id === transaction.category_id)} />
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {people.find((person) => person.id === transaction.person_id)?.name ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      {allowQuickTableEdit && !transaction.reimbursement_id ? (
                        <QuickEditSelect value={String(transaction.is_reimbursable)} options={[{ value: "false", label: "Não" }, { value: "true", label: "Sim" }]} onCommit={(value) => void handleQuickUpdate(transaction, { is_reimbursable: value === "true" })} />
                      ) : (
                        <div className="flex flex-col items-start gap-1">
                          <BooleanBadge value={transaction.is_reimbursable} />
                          {transaction.reimbursement_id ? <TextBadge tone="info">Reembolso vinculado</TextBadge> : null}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {transaction.is_recurring ? (transaction.recurrence_parent_id ? "Ocorrência" : "Recorrente") : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {transaction.is_recurring && !transaction.recurrence_parent_id ? (
                          <ActionButton
                            variant="secondary"
                            disabled={generatingId === transaction.id}
                            onClick={() => void handleGenerateRecurring(transaction)}
                          >
                            {generatingId === transaction.id ? "Gerando..." : "Gerar próximas"}
                          </ActionButton>
                        ) : null}
                        <ActionButton variant="secondary" onClick={() => setModal({ mode: "edit", transaction })}>
                          Editar
                        </ActionButton>
                        <ActionButton variant="danger" onClick={() => void handleDelete(transaction)}>
                          Arquivar
                        </ActionButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <Link className="text-sm font-semibold text-mint-600 hover:text-mint-700" href="/dashboard/invoices">
        Voltar para faturas
      </Link>

      {modal ? (
        <TransactionModal
          categories={categories}
          cards={cards}
          invoices={invoices}
          modal={modal}
          people={people}
          saving={saving}
          selectedInvoiceId={invoiceId}
          onClose={() => setModal(null)}
          onSubmit={(values) => void handleSubmit(values)}
        />
      ) : null}
    </div>
  );
}

function TransactionModal({
  categories,
  cards,
  invoices,
  modal,
  people,
  saving,
  selectedInvoiceId,
  onClose,
  onSubmit,
}: {
  categories: TransactionCategory[];
  cards: InvoiceCard[];
  invoices: TransactionInvoice[];
  modal: ModalState;
  people: TransactionPerson[];
  saving: boolean;
  selectedInvoiceId: string;
  onClose: () => void;
  onSubmit: (values: TransactionFormValues) => void;
}) {
  const selectedInvoice = invoices.find((item) => item.id === selectedInvoiceId);
  const initialValues =
    modal?.mode === "edit"
      ? transactionToFormValues(modal.transaction)
      : {
          ...emptyTransactionForm,
          invoice_id: selectedInvoiceId,
          credit_card_id: selectedInvoice?.credit_card_id ?? "",
          transaction_date: new Date().toISOString().slice(0, 10),
        };
  const [values, setValues] = useState<TransactionFormValues>(initialValues);
  const requiresPerson = values.ownership_type !== "personal";
  const canCreateReimbursement = values.is_reimbursable && values.person_id && requiresPerson;
  const filteredInvoices = values.credit_card_id
    ? invoices.filter((invoice) => invoice.credit_card_id === values.credit_card_id)
    : [];

  return (
    <Modal
      title={modal?.mode === "edit" ? "Editar lançamento" : "Novo lançamento"}
      description="Marque como reembolsável quando a compra foi feita para outra pessoa ou família."
      onClose={onClose}
    >
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
            value={values.credit_card_id}
            onChange={(event) => setValues({ ...values, credit_card_id: event.target.value, invoice_id: "" })}
          >
            <option value="">Selecione</option>
            {cards.map((card) => (
              <option key={card.id} value={card.id}>{card.name}</option>
            ))}
          </select>
        </FieldShell>
        <FieldShell label="Fatura">
          <select
            className={inputClassName}
            value={values.invoice_id}
            onChange={(event) => setValues({ ...values, invoice_id: event.target.value })}
            disabled={!values.credit_card_id}
          >
            <option value="">
              {values.credit_card_id
                ? "Criar/encontrar automaticamente pela data"
                : "Selecione um cartão primeiro"}
            </option>
            {filteredInvoices.map((invoice) => (
              <option key={invoice.id} value={invoice.id}>
                {cards.find((card) => card.id === invoice.credit_card_id)?.name ?? "Cartão"} - {invoice.reference_month.slice(0, 7)} - vence {formatDate(invoice.due_date)} - {invoice.status}
              </option>
            ))}
          </select>
          {!values.credit_card_id ? (
            <p className="mt-2 text-xs text-ink-600">Selecione um cartão para listar as faturas correspondentes.</p>
          ) : (
            <p className="mt-2 text-xs text-ink-600 dark:text-slate-300">Sem fatura selecionada, o sistema cria ou encontra a fatura correta pela data do lançamento.</p>
          )}
        </FieldShell>
        <FieldShell label="Data">
          <input
            required
            type="date"
            className={inputClassName}
            value={values.transaction_date}
            onChange={(event) => setValues({ ...values, transaction_date: event.target.value })}
          />
        </FieldShell>
        <FieldShell label="Valor">
          <input
            required
            min="0"
            step="0.01"
            type="number"
            className={inputClassName}
            value={values.amount}
            onChange={(event) => setValues({ ...values, amount: event.target.value })}
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
        <FieldShell label="Categoria">
          <CategorySelect categories={categories} value={values.category_id} onChange={(category_id) => setValues({ ...values, category_id })} />
        </FieldShell>
        <FieldShell label="Pessoa responsável">
          <select
            className={inputClassName}
            required={requiresPerson}
            disabled={!requiresPerson}
            value={values.person_id}
            onChange={(event) => setValues({ ...values, person_id: event.target.value })}
          >
            <option value="">Sem pessoa</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>{person.name}</option>
            ))}
          </select>
        </FieldShell>
        <FieldShell label="Tipo de despesa">
          <select
            className={inputClassName}
            value={values.ownership_type}
            onChange={(event) => {
              const ownershipType = event.target.value as OwnershipType;
              setValues({
                ...values,
                ownership_type: ownershipType,
                person_id: ownershipType === "personal" ? "" : values.person_id,
                is_reimbursable: ownershipType !== "personal" ? values.is_reimbursable : false,
                create_reimbursement: ownershipType !== "personal" ? values.create_reimbursement : false,
              });
            }}
          >
            {ownershipTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </FieldShell>
        <div className="md:col-span-2 rounded-md border border-ink-950/10 bg-slate-50 px-4 py-3 text-sm leading-6 text-ink-600">
          Despesa pessoal não exige pessoa nem reembolso. Para despesa de terceiro, família ou compartilhada, informe a pessoa responsável e marque reembolso quando alguém for devolver por Pix.
        </div>
        <FieldShell label="Reembolsável">
          <select
            className={inputClassName}
            disabled={!requiresPerson}
            value={String(values.is_reimbursable)}
            onChange={(event) => setValues({ ...values, is_reimbursable: event.target.value === "true" })}
          >
            <option value="false">Não</option>
            <option value="true">Sim</option>
          </select>
        </FieldShell>
        <FieldShell label="Compra parcelada?">
          <select
            className={inputClassName}
            value={String(values.is_installment_purchase)}
            onChange={(event) => {
              const isInstallmentPurchase = event.target.value === "true";
              setValues({
                ...values,
                is_installment_purchase: isInstallmentPurchase,
                installment_number: isInstallmentPurchase ? values.installment_number : "",
                installment_total: isInstallmentPurchase ? values.installment_total : "",
              });
            }}
          >
            <option value="false">Não</option>
            <option value="true">Sim</option>
          </select>
        </FieldShell>
        <FieldShell label="Parcela atual">
          <input
            min="1"
            type="number"
            className={inputClassName}
            disabled={!values.is_installment_purchase}
            value={values.installment_number}
            onChange={(event) => setValues({ ...values, installment_number: event.target.value })}
          />
        </FieldShell>
        <FieldShell label="Total de parcelas">
          <input
            min="1"
            type="number"
            className={inputClassName}
            disabled={!values.is_installment_purchase}
            value={values.installment_total}
            onChange={(event) => setValues({ ...values, installment_total: event.target.value })}
          />
        </FieldShell>
        <FieldShell label="Lançamento recorrente?">
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
              <select
                className={inputClassName}
                value={values.recurrence_frequency}
                onChange={(event) => setValues({ ...values, recurrence_frequency: event.target.value as "monthly" })}
              >
                <option value="monthly">Mensal</option>
              </select>
            </FieldShell>
            <FieldShell label="Data inicial">
              <input
                type="date"
                className={inputClassName}
                value={values.recurrence_start_date}
                onChange={(event) => setValues({ ...values, recurrence_start_date: event.target.value })}
              />
            </FieldShell>
            <FieldShell label="Data final opcional">
              <input
                type="date"
                className={inputClassName}
                value={values.recurrence_end_date}
                onChange={(event) => setValues({ ...values, recurrence_end_date: event.target.value })}
              />
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
              As próximas ocorrências serão criadas nas faturas correspondentes do mesmo cartão. Se a fatura do mês não existir, o sistema tentará criá-la automaticamente com base no fechamento e vencimento do cartão.
            </p>
          </>
        ) : null}
        {modal?.mode === "create" ? (
          <>
            <FieldShell label="Criar reembolso esperado">
              <select
                className={inputClassName}
                disabled={!canCreateReimbursement}
                value={String(values.create_reimbursement)}
                onChange={(event) =>
                  setValues({ ...values, create_reimbursement: event.target.value === "true" })
                }
              >
                <option value="false">Não</option>
                <option value="true">Sim</option>
              </select>
            </FieldShell>
            <FieldShell label="Data prevista do Pix">
              <input
                type="date"
                className={inputClassName}
                disabled={!values.create_reimbursement}
                value={values.reimbursement_expected_date}
                onChange={(event) =>
                  setValues({ ...values, reimbursement_expected_date: event.target.value })
                }
              />
            </FieldShell>
          </>
        ) : null}
        <div className="md:col-span-2">
          <FieldShell label="Notas">
            <textarea
              rows={3}
              className={inputClassName}
              value={values.notes}
              onChange={(event) => setValues({ ...values, notes: event.target.value })}
            />
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
