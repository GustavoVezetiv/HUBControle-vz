import type { AppSupabaseClient } from "@/features/shared/types";
import { safeLogAction } from "@/features/audit/logger";
import type {
  CreditCard,
  CreditCardInvoice,
  CreditCardTransaction,
  PlannedPurchase,
  Reimbursement,
} from "@/lib/supabase/types";

const reimbursementTerminalStatuses = new Set(["received", "cancelled", "forgiven", "renegotiated", "carried_over"]);

type InvoicePreviewSource = Pick<
  CreditCardInvoice,
  | "id"
  | "credit_card_id"
  | "reference_month"
  | "due_date"
  | "status"
  | "total_amount"
  | "personal_amount"
  | "reimbursable_amount"
  | "third_party_amount"
  | "paid_amount"
>;

type InvoicePreviewTransaction = Pick<
  CreditCardTransaction,
  "id" | "invoice_id" | "amount" | "is_reimbursable" | "ownership_type"
>;

type PurchasePreviewSource = Pick<
  PlannedPurchase,
  "id" | "title" | "estimated_amount" | "paid_amount" | "purchase_date" | "decision_status"
>;

type ReimbursementPreviewSource = Pick<
  Reimbursement,
  "id" | "description" | "expected_amount" | "received_amount" | "status" | "expected_date" | "received_date"
>;

type CreditCardLabel = Pick<CreditCard, "id" | "name">;

export type FinancialRecalculationPreview = {
  generatedAt: string;
  invoiceCount: number;
  invoiceDivergenceCount: number;
  paidInvoiceDivergenceCount: number;
  reimbursementCount: number;
  reimbursementSuggestedStatusCount: number;
  invoiceRows: FinancialInvoiceRecalculationRow[];
  reimbursementRows: FinancialReimbursementRecalculationRow[];
  purchaseSummary: FinancialPurchaseRecalculationSummary;
};

export type FinancialInvoiceRecalculationRow = {
  invoiceId: string;
  cardName: string;
  referenceMonth: string;
  dueDate: string;
  status: string;
  isPaid: boolean;
  changed: boolean;
  current: FinancialInvoiceDerivedTotals;
  recalculated: FinancialInvoiceDerivedTotals;
};

export type FinancialInvoiceDerivedTotals = {
  totalAmount: number;
  personalAmount: number;
  reimbursableAmount: number;
  thirdPartyAmount: number;
};

export type FinancialReimbursementRecalculationRow = {
  reimbursementId: string;
  description: string;
  expectedAmount: number;
  receivedAmount: number;
  openAmount: number;
  currentStatus: string;
  suggestedStatus: string;
  statusWillChange: boolean;
  isLateByDate: boolean;
  expectedDate: string | null;
  receivedDate: string | null;
};

export type FinancialPurchaseRecalculationSummary = {
  itemCount: number;
  purchasedCount: number;
  pendingCount: number;
  totalEstimated: number;
  totalPaid: number;
  economy: number;
  overrun: number;
};

export type ExecuteFinancialRecalculationOptions = {
  updateDerivedReimbursementStatuses: boolean;
  allowPaidInvoiceUpdates: boolean;
};

export type ExecuteFinancialRecalculationResult = {
  executedAt: string;
  updatedInvoices: number;
  updatedReimbursements: number;
  skippedPaidInvoices: number;
  failures: string[];
};

export async function buildFinancialRecalculationPreview(
  client: AppSupabaseClient,
  userId: string,
  today = new Date().toISOString().slice(0, 10),
): Promise<{ data: FinancialRecalculationPreview | null; error: { message: string } | null }> {
  const [invoiceResult, transactionResult, reimbursementResult, purchaseResult, cardsResult] = await Promise.all([
    client
      .from("credit_card_invoices")
      .select("id,credit_card_id,reference_month,due_date,status,total_amount,personal_amount,reimbursable_amount,third_party_amount,paid_amount")
      .eq("user_id", userId)
      .is("archived_at", null),
    client
      .from("credit_card_transactions")
      .select("id,invoice_id,amount,is_reimbursable,ownership_type")
      .eq("user_id", userId)
      .is("archived_at", null),
    client
      .from("reimbursements")
      .select("id,description,expected_amount,received_amount,status,expected_date,received_date")
      .eq("user_id", userId)
      .is("archived_at", null),
    client
      .from("planned_purchases")
      .select("id,title,estimated_amount,paid_amount,purchase_date,decision_status")
      .eq("user_id", userId)
      .is("archived_at", null),
    client.from("credit_cards").select("id,name").eq("user_id", userId),
  ]);

  if (invoiceResult.error || transactionResult.error || reimbursementResult.error || purchaseResult.error || cardsResult.error) {
    console.error("Erro técnico ao gerar prévia de recálculo financeiro:", {
      invoiceError: invoiceResult.error,
      transactionError: transactionResult.error,
      reimbursementError: reimbursementResult.error,
      purchaseError: purchaseResult.error,
      cardsError: cardsResult.error,
    });
    return { data: null, error: { message: "Não foi possível gerar a prévia do recálculo financeiro." } };
  }

  const cardsById = new Map((cardsResult.data ?? []).map((card: CreditCardLabel) => [card.id, card.name]));
  const transactionsByInvoiceId = groupTransactionsByInvoice(invoiceResult.data ?? [], transactionResult.data ?? []);

  const invoiceRows = (invoiceResult.data ?? []).map((invoice: InvoicePreviewSource) => {
    const transactions = transactionsByInvoiceId.get(invoice.id) ?? [];
    const recalculated = deriveInvoiceTotals(transactions);
    const current = {
      totalAmount: Number(invoice.total_amount || 0),
      personalAmount: Number(invoice.personal_amount || 0),
      reimbursableAmount: Number(invoice.reimbursable_amount || 0),
      thirdPartyAmount: Number(invoice.third_party_amount || 0),
    };

    return {
      invoiceId: invoice.id,
      cardName: cardsById.get(invoice.credit_card_id) ?? "Cartão",
      referenceMonth: invoice.reference_month,
      dueDate: invoice.due_date,
      status: invoice.status,
      isPaid: invoice.status === "paid",
      changed: !sameInvoiceTotals(current, recalculated),
      current,
      recalculated,
    };
  });

  const reimbursementRows = (reimbursementResult.data ?? []).map((reimbursement: ReimbursementPreviewSource) => {
    const openAmount = getReimbursementOpenAmount(reimbursement.expected_amount, reimbursement.received_amount, reimbursement.status);
    const suggestedStatus = deriveReimbursementStatus(reimbursement, today);
    const statusWillChange = suggestedStatus !== reimbursement.status;

    return {
      reimbursementId: reimbursement.id,
      description: reimbursement.description?.trim() || "Sem descrição",
      expectedAmount: Number(reimbursement.expected_amount || 0),
      receivedAmount: Number(reimbursement.received_amount || 0),
      openAmount,
      currentStatus: reimbursement.status,
      suggestedStatus,
      statusWillChange,
      isLateByDate: Boolean(
        reimbursement.expected_date &&
          reimbursement.expected_date < today &&
          openAmount > 0 &&
          !reimbursementTerminalStatuses.has(reimbursement.status),
      ),
      expectedDate: reimbursement.expected_date,
      receivedDate: reimbursement.received_date,
    };
  });

  const purchaseSummary = summarizePurchases(purchaseResult.data ?? []);

  return {
    data: {
      generatedAt: new Date().toISOString(),
      invoiceCount: invoiceRows.length,
      invoiceDivergenceCount: invoiceRows.filter((row) => row.changed).length,
      paidInvoiceDivergenceCount: invoiceRows.filter((row) => row.changed && row.isPaid).length,
      reimbursementCount: reimbursementRows.length,
      reimbursementSuggestedStatusCount: reimbursementRows.filter((row) => row.statusWillChange).length,
      invoiceRows,
      reimbursementRows,
      purchaseSummary,
    },
    error: null,
  };
}

export async function executeFinancialRecalculation(
  client: AppSupabaseClient,
  userId: string,
  preview: FinancialRecalculationPreview,
  options: ExecuteFinancialRecalculationOptions,
): Promise<{ data: ExecuteFinancialRecalculationResult | null; error: { message: string } | null }> {
  const paidInvoiceRows = preview.invoiceRows.filter((row) => row.changed && row.isPaid);

  if (paidInvoiceRows.length > 0 && !options.allowPaidInvoiceUpdates) {
    return {
      data: null,
      error: { message: "Há faturas pagas com divergência. Confirme explicitamente para recalculá-las." },
    };
  }

  let updatedInvoices = 0;
  let updatedReimbursements = 0;
  let skippedPaidInvoices = 0;
  const failures: string[] = [];

  for (const row of preview.invoiceRows) {
    if (!row.changed) continue;
    if (row.isPaid && !options.allowPaidInvoiceUpdates) {
      skippedPaidInvoices += 1;
      continue;
    }

    const updateResult = await client
      .from("credit_card_invoices")
      .update({
        total_amount: row.recalculated.totalAmount,
        personal_amount: row.recalculated.personalAmount,
        reimbursable_amount: row.recalculated.reimbursableAmount,
        third_party_amount: row.recalculated.thirdPartyAmount,
      })
      .eq("user_id", userId)
      .eq("id", row.invoiceId)
      .is("archived_at", null);

    if (updateResult.error) {
      console.error("Erro técnico ao atualizar fatura no recálculo financeiro:", updateResult.error);
      failures.push(`Fatura ${row.cardName} ${row.referenceMonth.slice(0, 7)}: ${updateResult.error.message}`);
      continue;
    }

    updatedInvoices += 1;
  }

  if (options.updateDerivedReimbursementStatuses) {
    for (const row of preview.reimbursementRows) {
      if (!row.statusWillChange) continue;
      if (reimbursementTerminalStatuses.has(row.currentStatus)) continue;

      const updateResult = await client
        .from("reimbursements")
        .update({ status: row.suggestedStatus })
        .eq("user_id", userId)
        .eq("id", row.reimbursementId)
        .is("archived_at", null);

      if (updateResult.error) {
        console.error("Erro técnico ao atualizar status derivado do reembolso:", updateResult.error);
        failures.push(`Reembolso ${row.description}: ${updateResult.error.message}`);
        continue;
      }

      updatedReimbursements += 1;
    }
  }

  const result = {
    executedAt: new Date().toISOString(),
    updatedInvoices,
    updatedReimbursements,
    skippedPaidInvoices,
    failures,
  };

  console.info("Log do recálculo financeiro", result);
  await safeLogAction(client, {
    user_id: userId,
    module: "financial_recalculation",
    record_id: null,
    action: "financial_recalculation",
    field_name: null,
    old_value: null,
    new_value: result,
    metadata: {
      updateDerivedReimbursementStatuses: options.updateDerivedReimbursementStatuses,
      allowPaidInvoiceUpdates: options.allowPaidInvoiceUpdates,
    },
  });

  return { data: result, error: null };
}

function groupTransactionsByInvoice(
  invoices: InvoicePreviewSource[],
  transactions: InvoicePreviewTransaction[],
) {
  const validInvoiceIds = new Set(invoices.map((invoice) => invoice.id));
  const grouped = new Map<string, InvoicePreviewTransaction[]>();

  for (const transaction of transactions) {
    if (!transaction.invoice_id || !validInvoiceIds.has(transaction.invoice_id)) continue;
    const current = grouped.get(transaction.invoice_id) ?? [];
    current.push(transaction);
    grouped.set(transaction.invoice_id, current);
  }

  return grouped;
}

function deriveInvoiceTotals(transactions: InvoicePreviewTransaction[]): FinancialInvoiceDerivedTotals {
  const totals = transactions.reduce(
    (acc, transaction) => {
      const amount = Number(transaction.amount || 0);
      acc.totalAmount += amount;

      if (transaction.ownership_type === "personal") {
        acc.personalAmount += amount;
      }

      if (transaction.is_reimbursable) {
        acc.reimbursableAmount += amount;
      }

      if (["third_party", "shared", "family"].includes(transaction.ownership_type)) {
        acc.thirdPartyAmount += amount;
      }

      return acc;
    },
    { totalAmount: 0, personalAmount: 0, reimbursableAmount: 0, thirdPartyAmount: 0 },
  );

  return {
    totalAmount: normalizeMoney(totals.totalAmount),
    personalAmount: normalizeMoney(totals.personalAmount),
    reimbursableAmount: normalizeMoney(totals.reimbursableAmount),
    thirdPartyAmount: normalizeMoney(totals.thirdPartyAmount),
  };
}

function sameInvoiceTotals(current: FinancialInvoiceDerivedTotals, recalculated: FinancialInvoiceDerivedTotals) {
  return (
    sameMoney(current.totalAmount, recalculated.totalAmount) &&
    sameMoney(current.personalAmount, recalculated.personalAmount) &&
    sameMoney(current.reimbursableAmount, recalculated.reimbursableAmount) &&
    sameMoney(current.thirdPartyAmount, recalculated.thirdPartyAmount)
  );
}

function summarizePurchases(purchases: PurchasePreviewSource[]): FinancialPurchaseRecalculationSummary {
  const totalEstimated = purchases.reduce((sum, item) => sum + Number(item.estimated_amount || 0), 0);
  const totalPaid = purchases.reduce((sum, item) => sum + Number(item.paid_amount || 0), 0);
  const purchasedCount = purchases.filter((item) => Boolean(item.purchase_date)).length;
  const pendingCount = purchases.filter((item) => !item.purchase_date && item.decision_status !== "canceled").length;
  const difference = totalEstimated - totalPaid;

  return {
    itemCount: purchases.length,
    purchasedCount,
    pendingCount,
    totalEstimated: normalizeMoney(totalEstimated),
    totalPaid: normalizeMoney(totalPaid),
    economy: normalizeMoney(Math.max(difference, 0)),
    overrun: normalizeMoney(Math.max(totalPaid - totalEstimated, 0)),
  };
}

function deriveReimbursementStatus(reimbursement: ReimbursementPreviewSource, today: string) {
  if (reimbursementTerminalStatuses.has(reimbursement.status)) {
    return reimbursement.status;
  }

  const openAmount = getReimbursementOpenAmount(
    reimbursement.expected_amount,
    reimbursement.received_amount,
    reimbursement.status,
  );

  if (openAmount <= 0) return "received";
  if (reimbursement.expected_date && reimbursement.expected_date < today) return "late";
  if (Number(reimbursement.received_amount || 0) > 0) return "partial";
  return "expected";
}

function getReimbursementOpenAmount(expectedAmount: number, receivedAmount: number, status: string) {
  if (reimbursementTerminalStatuses.has(status)) return 0;
  return normalizeMoney(Math.max(Number(expectedAmount || 0) - Number(receivedAmount || 0), 0));
}

function sameMoney(left: number, right: number) {
  return Math.abs(normalizeMoney(left) - normalizeMoney(right)) < 0.01;
}

function normalizeMoney(value: number) {
  return Number(Number(value || 0).toFixed(2));
}
