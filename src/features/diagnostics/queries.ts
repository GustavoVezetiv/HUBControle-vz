import {
  calculateInvoiceCycleForTransactionDate,
  findOrCreateInvoiceForTransactionDate,
  recalculateInvoiceTotal,
} from "@/features/invoices/auto-invoices";
import type { AppSupabaseClient } from "@/features/shared/types";
import { formatCurrency, formatDate } from "@/features/shared/format";
import type {
  Category,
  CreditCardInvoice,
  CreditCardTransaction,
  DiagnosticAlertIgnore,
  Installment,
  Reimbursement,
} from "@/lib/supabase/types";

import type {
  FinancialDiagnosticItem,
  FinancialDiagnosticsData,
  FinancialDiagnosticsSourceData,
  FinancialDiagnosticSection,
} from "@/features/diagnostics/types";

const OPEN_INVOICE_STATUSES = new Set(["open", "closed", "partial", "overdue"]);
const PURCHASE_CATEGORY_TYPES = new Set(["purchase", "planned_purchase", "wishlist", "shopping", "general"]);
const GOAL_CATEGORY_TYPES = new Set(["goal", "general"]);
const REIMBURSEMENT_CATEGORY_TYPES = new Set(["reimbursement", "expense", "general"]);

export async function buildFinancialDiagnostics(
  client: AppSupabaseClient,
  userId: string,
): Promise<{ data: FinancialDiagnosticsData | null; error: { message: string } | null }> {
  const sourceResult = await loadFinancialDiagnosticsSourceData(client, userId);

  if (sourceResult.error || !sourceResult.data) {
    return { data: null, error: sourceResult.error ?? { message: "Não foi possível carregar os dados do diagnóstico." } };
  }

  return { data: buildFinancialDiagnosticsFromSource(sourceResult.data), error: null };
}

export async function loadFinancialDiagnosticsSourceData(
  client: AppSupabaseClient,
  userId: string,
): Promise<{ data: FinancialDiagnosticsSourceData | null; error: { message: string } | null }> {
  const [
    categoriesResult,
    cardsResult,
    invoicesResult,
    transactionsResult,
    reimbursementsResult,
    installmentsResult,
    purchasesResult,
    goalsResult,
    ignoredResult,
  ] = await Promise.all([
    client.from("categories").select("*").eq("user_id", userId).order("name", { ascending: true }),
    client.from("credit_cards").select("*").eq("user_id", userId).order("name", { ascending: true }),
    client.from("credit_card_invoices").select("*").eq("user_id", userId),
    client.from("credit_card_transactions").select("*").eq("user_id", userId),
    client.from("reimbursements").select("*").eq("user_id", userId),
    client.from("installments").select("*").eq("user_id", userId),
    client.from("planned_purchases").select("id,title,category_id").eq("user_id", userId).is("archived_at", null),
    client.from("goals").select("id,name,category_id").eq("user_id", userId).is("archived_at", null),
    client.from("diagnostic_alert_ignores").select("*").eq("user_id", userId),
  ]);

  const error =
    categoriesResult.error ||
    cardsResult.error ||
    invoicesResult.error ||
    transactionsResult.error ||
    reimbursementsResult.error ||
    installmentsResult.error ||
    purchasesResult.error ||
    goalsResult.error ||
    ignoredResult.error;

  if (error) {
    console.error("Erro técnico ao carregar dados para o diagnóstico financeiro:", error);
    return { data: null, error: { message: "Não foi possível carregar os dados do diagnóstico financeiro." } };
  }

  return {
    data: {
      categories: categoriesResult.data ?? [],
      cards: cardsResult.data ?? [],
      invoices: invoicesResult.data ?? [],
      transactions: transactionsResult.data ?? [],
      reimbursements: reimbursementsResult.data ?? [],
      installments: installmentsResult.data ?? [],
      purchases: purchasesResult.data ?? [],
      goals: goalsResult.data ?? [],
      ignoredAlerts: (ignoredResult.data ?? []) as DiagnosticAlertIgnore[],
    },
    error: null,
  };
}

export function buildFinancialDiagnosticsFromSource(source: FinancialDiagnosticsSourceData): FinancialDiagnosticsData {
  const categoryById = new Map(source.categories.map((category) => [category.id, category]));
  const cardById = new Map(source.cards.map((card) => [card.id, card]));
  const invoiceById = new Map(source.invoices.map((invoice) => [invoice.id, invoice]));
  const transactionById = new Map(source.transactions.map((transaction) => [transaction.id, transaction]));
  const reimbursementById = new Map(source.reimbursements.map((reimbursement) => [reimbursement.id, reimbursement]));
  const ignoredKeys = new Set(source.ignoredAlerts.map((item) => item.alert_key));

  const sections: FinancialDiagnosticSection[] = [
    buildTransactionsWithoutInvoiceSection(source.transactions, source.invoices, cardById, ignoredKeys),
    buildInvoiceTotalMismatchSection(source.invoices, source.transactions, cardById, ignoredKeys),
    buildBrokenReimbursementLinkSection(source.reimbursements, invoiceById, transactionById, ignoredKeys),
    buildInvalidRenegotiationSection(source.reimbursements, reimbursementById, ignoredKeys),
    buildEmptyOpenInvoiceSection(source.invoices, source.transactions, cardById, ignoredKeys),
    buildIncompleteInstallmentSection(source.installments, source.transactions, cardById, transactionById, ignoredKeys),
    buildOutOfScopeCategorySection(source.purchases, source.goals, source.reimbursements, categoryById, ignoredKeys),
  ];

  return {
    generatedAt: new Date().toISOString(),
    totalAlerts: sections.reduce((sum, section) => sum + section.count, 0),
    totalIgnored: sections.reduce((sum, section) => sum + section.ignoredCount, 0),
    sections,
  };
}

export async function ignoreFinancialDiagnosticAlert(
  client: AppSupabaseClient,
  userId: string,
  payload: {
    alertKey: string;
    alertType: string;
    subjectType: string;
    subjectId: string;
    reason?: string | null;
  },
) {
  const result = await client.from("diagnostic_alert_ignores").upsert(
    {
      user_id: userId,
      alert_key: payload.alertKey,
      alert_type: payload.alertType,
      subject_type: payload.subjectType,
      subject_id: payload.subjectId,
      reason: payload.reason ?? null,
    },
    { onConflict: "user_id,alert_key" },
  );

  if (result.error) {
    console.error("Erro técnico ao ignorar alerta do diagnóstico financeiro:", result.error);
    return { error: { message: "Não foi possível ignorar este alerta." } };
  }

  return { error: null };
}

export async function recalculateInvoiceFromDiagnostic(
  client: AppSupabaseClient,
  userId: string,
  invoiceId: string,
) {
  const invoiceResult = await client
    .from("credit_card_invoices")
    .select("id,total_amount,personal_amount,reimbursable_amount,third_party_amount,status")
    .eq("user_id", userId)
    .eq("id", invoiceId)
    .single();

  if (invoiceResult.error || !invoiceResult.data) {
    console.error("Erro técnico ao buscar fatura para recálculo via diagnóstico:", invoiceResult.error);
    return { data: null, error: { message: "Não foi possível buscar a fatura." } };
  }

  const before = {
    totalAmount: Number(invoiceResult.data.total_amount || 0),
    personalAmount: Number(invoiceResult.data.personal_amount || 0),
    reimbursableAmount: Number(invoiceResult.data.reimbursable_amount || 0),
    thirdPartyAmount: Number(invoiceResult.data.third_party_amount || 0),
  };

  const recalculateResult = await recalculateInvoiceTotal(client, userId, invoiceId, {
    includePaid: invoiceResult.data.status === "paid",
  });

  if (recalculateResult.error) {
    return { data: null, error: { message: "Não foi possível recalcular a fatura." } };
  }

  const afterResult = await client
    .from("credit_card_invoices")
    .select("id,total_amount,personal_amount,reimbursable_amount,third_party_amount")
    .eq("user_id", userId)
    .eq("id", invoiceId)
    .single();

  if (afterResult.error || !afterResult.data) {
    console.error("Erro técnico ao buscar fatura após recálculo via diagnóstico:", afterResult.error);
    return {
      data: {
        before,
        after: before,
      },
      error: { message: "A fatura foi recalculada, mas o retorno atualizado não pôde ser carregado." },
    };
  }

  return {
    data: {
      before,
      after: {
        totalAmount: Number(afterResult.data.total_amount || 0),
        personalAmount: Number(afterResult.data.personal_amount || 0),
        reimbursableAmount: Number(afterResult.data.reimbursable_amount || 0),
        thirdPartyAmount: Number(afterResult.data.third_party_amount || 0),
      },
    },
    error: null,
  };
}

export async function fixTransactionInvoiceFromDiagnostic(
  client: AppSupabaseClient,
  userId: string,
  transactionId: string,
) {
  const transactionResult = await client
    .from("credit_card_transactions")
    .select("id,credit_card_id,invoice_id,transaction_date,description")
    .eq("user_id", userId)
    .eq("id", transactionId)
    .single();

  if (transactionResult.error || !transactionResult.data) {
    console.error("Erro técnico ao buscar lançamento para corrigir fatura:", transactionResult.error);
    return { data: null, error: { message: "Não foi possível carregar o lançamento." } };
  }

  const transaction = transactionResult.data;
  const invoiceResult = await findOrCreateInvoiceForTransactionDate(
    client,
    userId,
    transaction.credit_card_id,
    transaction.transaction_date,
  );

  if (invoiceResult.error || !invoiceResult.invoice) {
    return { data: null, error: invoiceResult.error ?? { message: "Não foi possível preparar a fatura correta." } };
  }

  const previousInvoiceId = transaction.invoice_id;
  const nextInvoiceId = invoiceResult.invoice.id;

  if (previousInvoiceId === nextInvoiceId) {
    return {
      data: {
        previousInvoiceId,
        nextInvoiceId,
        createdInvoice: invoiceResult.created,
        invoiceReferenceMonth: invoiceResult.invoice.reference_month,
      },
      error: null,
    };
  }

  const updateResult = await client
    .from("credit_card_transactions")
    .update({ invoice_id: nextInvoiceId })
    .eq("user_id", userId)
    .eq("id", transactionId);

  if (updateResult.error) {
    console.error("Erro técnico ao corrigir fatura do lançamento via diagnóstico:", updateResult.error);
    return { data: null, error: { message: "Não foi possível vincular o lançamento à fatura correta." } };
  }

  const reimbursementResult = await client
    .from("reimbursements")
    .update({ credit_card_invoice_id: nextInvoiceId })
    .eq("user_id", userId)
    .eq("credit_card_transaction_id", transactionId)
    .is("archived_at", null);

  if (reimbursementResult.error) {
    console.error("Erro técnico ao atualizar reembolso vinculado após correção de fatura:", reimbursementResult.error);
    return { data: null, error: { message: "Lançamento atualizado, mas o reembolso vinculado não pôde ser ajustado." } };
  }

  if (previousInvoiceId) {
    await recalculateInvoiceTotal(client, userId, previousInvoiceId, { includePaid: true });
  }
  await recalculateInvoiceTotal(client, userId, nextInvoiceId, { includePaid: true });

  return {
    data: {
      previousInvoiceId,
      nextInvoiceId,
      createdInvoice: invoiceResult.created,
      invoiceReferenceMonth: invoiceResult.invoice.reference_month,
    },
    error: null,
  };
}

function buildTransactionsWithoutInvoiceSection(
  transactions: CreditCardTransaction[],
  invoices: CreditCardInvoice[],
  cardById: Map<string, { id: string; name: string; closing_day: number | null; due_day: number | null }>,
  ignoredKeys: Set<string>,
): FinancialDiagnosticSection {
  const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const allItems = transactions
    .filter((transaction) => !transaction.archived_at)
    .flatMap((transaction) => {
      const reasons: string[] = [];
      if (!transaction.invoice_id) {
        reasons.push("Lançamento sem `invoice_id`.");
      } else {
        const invoice = invoiceById.get(transaction.invoice_id);
        if (!invoice) reasons.push("`invoice_id` aponta para uma fatura inexistente.");
        else if (invoice.archived_at) reasons.push("`invoice_id` aponta para uma fatura arquivada.");
      }

      if (reasons.length === 0) return [];

      const card = cardById.get(transaction.credit_card_id);
      const preview =
        card && card.closing_day && card.due_day
          ? (() => {
              const cycle = calculateInvoiceCycleForTransactionDate(card, transaction.transaction_date);
              const existingInvoice = invoices.find(
                (invoice) =>
                  invoice.credit_card_id === transaction.credit_card_id &&
                  invoice.reference_month === cycle.reference_month &&
                  !invoice.archived_at,
              );
              return {
                referenceMonth: cycle.reference_month,
                closingDate: cycle.closing_date,
                dueDate: cycle.due_date,
                existingInvoiceId: existingInvoice?.id ?? null,
              };
            })()
          : null;

      return [{
        alertKey: `transaction-without-invoice:${transaction.id}`,
        alertType: "transactions_without_invoice",
        subjectType: "credit_card_transaction",
        subjectId: transaction.id,
        title: transaction.description,
        description: reasons.join(" "),
        details: [
          `Valor: ${formatCurrency(Number(transaction.amount || 0))}`,
          `Data: ${formatDate(transaction.transaction_date)}`,
          `Cartão: ${card?.name ?? "Cartão não encontrado"}`,
        ],
        references: [{ label: "Abrir faturas", href: "/dashboard/invoices" }],
        actions: ["open_transaction", "create_correct_invoice", "ignore_alert"],
        transactionId: transaction.id,
        invoiceId: transaction.invoice_id,
        creditCardId: transaction.credit_card_id,
        transactionDate: transaction.transaction_date,
        suggestedInvoicePreview: preview,
      } satisfies FinancialDiagnosticItem];
    });

  return finalizeSection(
    {
      key: "transactions_without_invoice",
      title: "Lançamentos sem fatura",
      description: "Transações de cartão sem fatura válida vinculada.",
    },
    allItems,
    ignoredKeys,
  );
}

function buildInvoiceTotalMismatchSection(
  invoices: CreditCardInvoice[],
  transactions: CreditCardTransaction[],
  cardById: Map<string, { id: string; name: string }>,
  ignoredKeys: Set<string>,
): FinancialDiagnosticSection {
  const transactionGroups = new Map<string, CreditCardTransaction[]>();
  for (const transaction of transactions) {
    if (transaction.archived_at || !transaction.invoice_id) continue;
    const current = transactionGroups.get(transaction.invoice_id) ?? [];
    current.push(transaction);
    transactionGroups.set(transaction.invoice_id, current);
  }

  const items = invoices
    .filter((invoice) => !invoice.archived_at)
    .flatMap((invoice) => {
      const linkedTransactions = transactionGroups.get(invoice.id) ?? [];
      const calculatedTotal = roundMoney(linkedTransactions.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0));
      const currentTotal = roundMoney(Number(invoice.total_amount || 0));
      if (Math.abs(currentTotal - calculatedTotal) < 0.01) return [];

      return [{
        alertKey: `invoice-total-mismatch:${invoice.id}`,
        alertType: "invoice_total_mismatch",
        subjectType: "credit_card_invoice",
        subjectId: invoice.id,
        title: `${cardById.get(invoice.credit_card_id)?.name ?? "Cartão"} · ${invoice.reference_month.slice(0, 7)}`,
        description: "O total salvo da fatura diverge da soma dos lançamentos não arquivados.",
        details: [
          `Atual: ${formatCurrency(currentTotal)}`,
          `Recalculado: ${formatCurrency(calculatedTotal)}`,
          `Diferença: ${formatCurrency(roundMoney(calculatedTotal - currentTotal))}`,
          `Lançamentos vinculados: ${linkedTransactions.length}`,
        ],
        references: [{ label: "Abrir fatura", href: `/dashboard/invoices/${invoice.id}` }],
        actions: ["open_invoice", "recalculate_invoice", "ignore_alert"],
        invoiceId: invoice.id,
      } satisfies FinancialDiagnosticItem];
    });

  return finalizeSection(
    {
      key: "invoice_total_mismatch",
      title: "Faturas com total divergente",
      description: "Compara o total salvo com a soma dos lançamentos vinculados.",
    },
    items,
    ignoredKeys,
  );
}

function buildBrokenReimbursementLinkSection(
  reimbursements: Reimbursement[],
  invoiceById: Map<string, CreditCardInvoice>,
  transactionById: Map<string, CreditCardTransaction>,
  ignoredKeys: Set<string>,
): FinancialDiagnosticSection {
  const items = reimbursements
    .filter((reimbursement) => !reimbursement.archived_at)
    .flatMap((reimbursement) => {
      const reasons: string[] = [];
      if (reimbursement.credit_card_transaction_id) {
        const transaction = transactionById.get(reimbursement.credit_card_transaction_id);
        if (!transaction) reasons.push("O lançamento vinculado não existe.");
        else if (transaction.archived_at) reasons.push("O lançamento vinculado está arquivado.");
      }
      if (reimbursement.credit_card_invoice_id) {
        const invoice = invoiceById.get(reimbursement.credit_card_invoice_id);
        if (!invoice) reasons.push("A fatura vinculada não existe.");
        else if (invoice.archived_at) reasons.push("A fatura vinculada está arquivada.");
      }

      if (reasons.length === 0) return [];

      return [{
        alertKey: `broken-reimbursement-link:${reimbursement.id}`,
        alertType: "broken_reimbursement_link",
        subjectType: "reimbursement",
        subjectId: reimbursement.id,
        title: reimbursement.description?.trim() || "Reembolso sem descrição",
        description: reasons.join(" "),
        details: [
          `Esperado: ${formatCurrency(Number(reimbursement.expected_amount || 0))}`,
          `Recebido: ${formatCurrency(Number(reimbursement.received_amount || 0))}`,
          `Status: ${reimbursement.status}`,
        ],
        references: [
          { label: "Abrir reembolsos", href: "/dashboard/reimbursements" },
          ...(reimbursement.credit_card_invoice_id ? [{ label: "Abrir fatura", href: `/dashboard/invoices/${reimbursement.credit_card_invoice_id}` }] : []),
        ],
        actions: ["open_item", "manual_link", "ignore_alert"],
        reimbursementId: reimbursement.id,
        invoiceId: reimbursement.credit_card_invoice_id,
        transactionId: reimbursement.credit_card_transaction_id,
      } satisfies FinancialDiagnosticItem];
    });

  return finalizeSection(
    {
      key: "broken_reimbursement_link",
      title: "Reembolsos com vínculo quebrado",
      description: "Reembolsos que apontam para lançamento ou fatura inexistente/arquivada.",
    },
    items,
    ignoredKeys,
  );
}

function buildInvalidRenegotiationSection(
  reimbursements: Reimbursement[],
  reimbursementById: Map<string, Reimbursement>,
  ignoredKeys: Set<string>,
): FinancialDiagnosticSection {
  const items = reimbursements
    .filter((reimbursement) => !reimbursement.archived_at)
    .flatMap((reimbursement) => {
      const reasons: string[] = [];
      if (reimbursement.status === "renegotiated" && !reimbursement.renegotiated_into_id) {
        reasons.push("Marcado como renegociado, mas sem `renegotiated_into_id`.");
      }
      if (reimbursement.renegotiated_into_id && !reimbursementById.get(reimbursement.renegotiated_into_id)) {
        reasons.push("`renegotiated_into_id` aponta para um reembolso inexistente.");
      }
      if (reimbursement.source_type === "reimbursement_renegotiation" && reimbursement.renegotiation_source_ids.length === 0) {
        reasons.push("Originado de renegociação, mas sem `renegotiation_source_ids`.");
      }

      if (reasons.length === 0) return [];

      return [{
        alertKey: `invalid-renegotiation:${reimbursement.id}`,
        alertType: "invalid_renegotiation",
        subjectType: "reimbursement",
        subjectId: reimbursement.id,
        title: reimbursement.description?.trim() || "Reembolso renegociado",
        description: reasons.join(" "),
        details: [
          `Status: ${reimbursement.status}`,
          `Origens da renegociação: ${reimbursement.renegotiation_source_ids.length}`,
          `Renegociado em: ${reimbursement.renegotiated_at ? formatDate(reimbursement.renegotiated_at.slice(0, 10)) : "-"}`,
        ],
        references: [{ label: "Abrir reembolsos", href: "/dashboard/reimbursements" }],
        actions: ["open_item", "manual_link", "ignore_alert"],
        reimbursementId: reimbursement.id,
      } satisfies FinancialDiagnosticItem];
    });

  return finalizeSection(
    {
      key: "invalid_renegotiation",
      title: "Reembolsos renegociados inconsistentes",
      description: "Conferência dos vínculos e origens de renegociação.",
    },
    items,
    ignoredKeys,
  );
}

function buildEmptyOpenInvoiceSection(
  invoices: CreditCardInvoice[],
  transactions: CreditCardTransaction[],
  cardById: Map<string, { id: string; name: string }>,
  ignoredKeys: Set<string>,
): FinancialDiagnosticSection {
  const transactionCountByInvoice = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.archived_at || !transaction.invoice_id) continue;
    transactionCountByInvoice.set(transaction.invoice_id, (transactionCountByInvoice.get(transaction.invoice_id) ?? 0) + 1);
  }

  const items = invoices
    .filter((invoice) => !invoice.archived_at && OPEN_INVOICE_STATUSES.has(invoice.status) && (transactionCountByInvoice.get(invoice.id) ?? 0) === 0)
    .map((invoice) => ({
      alertKey: `empty-open-invoice:${invoice.id}`,
      alertType: "empty_open_invoice",
      subjectType: "credit_card_invoice",
      subjectId: invoice.id,
      title: `${cardById.get(invoice.credit_card_id)?.name ?? "Cartão"} · ${invoice.reference_month.slice(0, 7)}`,
      description: "Fatura aberta sem lançamentos vinculados.",
      details: [
        `Status: ${invoice.status}`,
        `Vence em: ${formatDate(invoice.due_date)}`,
        `Total salvo: ${formatCurrency(Number(invoice.total_amount || 0))}`,
      ],
      references: [{ label: "Abrir fatura", href: `/dashboard/invoices/${invoice.id}` }],
      actions: ["open_invoice", "ignore_alert"],
      invoiceId: invoice.id,
    } satisfies FinancialDiagnosticItem));

  return finalizeSection(
    {
      key: "empty_open_invoice",
      title: "Faturas vazias",
      description: "Faturas abertas que não possuem nenhum lançamento não arquivado.",
    },
    items,
    ignoredKeys,
  );
}

function buildIncompleteInstallmentSection(
  installments: Installment[],
  transactions: CreditCardTransaction[],
  cardById: Map<string, { id: string; name: string }>,
  transactionById: Map<string, CreditCardTransaction>,
  ignoredKeys: Set<string>,
): FinancialDiagnosticSection {
  const transactionGroups = new Map<string, CreditCardTransaction[]>();
  for (const transaction of transactions) {
    if (transaction.archived_at || !transaction.installment_group_id) continue;
    const current = transactionGroups.get(transaction.installment_group_id) ?? [];
    current.push(transaction);
    transactionGroups.set(transaction.installment_group_id, current);
  }

  const items = installments
    .filter((installment) => installment.status === "active")
    .flatMap((installment) => {
      const expectedTotal = Number(installment.installment_total ?? installment.installment_count ?? 0);
      if (expectedTotal <= 1) return [];

      const originTransaction = installment.credit_card_transaction_id
        ? transactionById.get(installment.credit_card_transaction_id)
        : undefined;
      const groupId = originTransaction?.installment_group_id;
      const groupCount = groupId ? (transactionGroups.get(groupId) ?? []).length : 0;
      const missingCount = groupId ? Math.max(expectedTotal - groupCount, 0) : Math.max(expectedTotal - Number(installment.current_installment ?? installment.installment_number ?? 1), 0);

      if (missingCount <= 0) return [];

      return [{
        alertKey: `incomplete-installment:${installment.id}`,
        alertType: "incomplete_installment",
        subjectType: "installment",
        subjectId: installment.id,
        title: installment.description,
        description: "O parcelamento indica parcelas futuras, mas faltam lançamentos correspondentes.",
        details: [
          `Parcela atual: ${installment.current_installment ?? installment.installment_number ?? 1}/${expectedTotal}`,
          `Parcelas faltantes estimadas: ${missingCount}`,
          `Valor da parcela: ${formatCurrency(Number(installment.installment_amount || 0))}`,
          `Cartão: ${installment.credit_card_id ? cardById.get(installment.credit_card_id)?.name ?? "Cartão não encontrado" : "Fora do cartão"}`,
        ],
        references: [
          { label: "Abrir parcelamentos", href: "/dashboard/installments" },
          ...(installment.invoice_id ? [{ label: "Abrir fatura", href: `/dashboard/invoices/${installment.invoice_id}` }] : []),
        ],
        actions: ["open_item", "open_invoice", "ignore_alert"],
        installmentId: installment.id,
        invoiceId: installment.invoice_id,
        transactionId: installment.credit_card_transaction_id,
      } satisfies FinancialDiagnosticItem];
    });

  return finalizeSection(
    {
      key: "incomplete_installment",
      title: "Parcelamentos incompletos",
      description: "Parcelamentos cujo total indica parcelas futuras ainda não refletidas em lançamentos.",
    },
    items,
    ignoredKeys,
  );
}

function buildOutOfScopeCategorySection(
  purchases: Array<{ id: string; title: string; category_id: string | null }>,
  goals: Array<{ id: string; name: string; category_id: string | null }>,
  reimbursements: Reimbursement[],
  categoryById: Map<string, Category>,
  ignoredKeys: Set<string>,
): FinancialDiagnosticSection {
  const items: FinancialDiagnosticItem[] = [];

  for (const purchase of purchases) {
    if (!purchase.category_id) continue;
    const category = categoryById.get(purchase.category_id);
    if (!category || PURCHASE_CATEGORY_TYPES.has(category.type)) continue;
    items.push({
      alertKey: `out-of-scope-category:purchase:${purchase.id}`,
      alertType: "out_of_scope_category",
      subjectType: "planned_purchase",
      subjectId: purchase.id,
      title: purchase.title,
      description: "Compra usando categoria fora do escopo de compras e desejos.",
      details: [`Categoria atual: ${category.name}`, `Tipo da categoria: ${category.type}`],
      references: [{ label: "Abrir compras", href: "/dashboard/purchases" }],
      actions: ["open_item", "manual_link", "ignore_alert"],
    });
  }

  for (const goal of goals) {
    if (!goal.category_id) continue;
    const category = categoryById.get(goal.category_id);
    if (!category || GOAL_CATEGORY_TYPES.has(category.type)) continue;
    items.push({
      alertKey: `out-of-scope-category:goal:${goal.id}`,
      alertType: "out_of_scope_category",
      subjectType: "goal",
      subjectId: goal.id,
      title: goal.name,
      description: "Meta usando categoria fora do escopo de metas.",
      details: [`Categoria atual: ${category.name}`, `Tipo da categoria: ${category.type}`],
      references: [{ label: "Abrir metas", href: "/dashboard/goals" }],
      actions: ["open_item", "manual_link", "ignore_alert"],
    });
  }

  for (const reimbursement of reimbursements) {
    if (reimbursement.archived_at || !reimbursement.category_id) continue;
    const category = categoryById.get(reimbursement.category_id);
    if (!category || REIMBURSEMENT_CATEGORY_TYPES.has(category.type)) continue;
    items.push({
      alertKey: `out-of-scope-category:reimbursement:${reimbursement.id}`,
      alertType: "out_of_scope_category",
      subjectType: "reimbursement",
      subjectId: reimbursement.id,
      title: reimbursement.description?.trim() || "Reembolso sem descrição",
      description: "Reembolso usando categoria fora do escopo de reembolsos.",
      details: [`Categoria atual: ${category.name}`, `Tipo da categoria: ${category.type}`],
      references: [{ label: "Abrir reembolsos", href: "/dashboard/reimbursements" }],
      actions: ["open_item", "manual_link", "ignore_alert"],
      reimbursementId: reimbursement.id,
    });
  }

  return finalizeSection(
    {
      key: "out_of_scope_category",
      title: "Categorias fora do escopo",
      description: "Itens de compras, metas e reembolsos usando categoria incompatível com a tela.",
    },
    items,
    ignoredKeys,
  );
}

function finalizeSection(
  base: Pick<FinancialDiagnosticSection, "key" | "title" | "description">,
  allItems: FinancialDiagnosticItem[],
  ignoredKeys: Set<string>,
): FinancialDiagnosticSection {
  const items = allItems.filter((item) => !ignoredKeys.has(item.alertKey));
  return {
    ...base,
    count: items.length,
    ignoredCount: allItems.length - items.length,
    items,
  };
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}
