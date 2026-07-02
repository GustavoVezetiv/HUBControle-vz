import { safeLogAction, safeLogCreate } from "@/features/audit/logger";
import {
  buildFinancialLinkFields,
  financialLinkModuleForPaymentType,
  inflowKindForLinkedEntry,
  type CashAvailability,
  type FinancialLinkModule,
  type LinkedEntryContext,
  type LinkedEntryFormValues,
} from "@/features/linked-entries/types";
import type { AppSupabaseClient } from "@/features/shared/types";
import type { Json } from "@/lib/supabase/types";

export async function checkCashAvailabilityForPayment(
  client: AppSupabaseClient,
  userId: string,
  amount: number,
  paymentDate: string,
): Promise<{ data: CashAvailability | null; error: { message: string } | null }> {
  const periodStart = paymentDate.slice(0, 7) + "-01";
  const periodEnd = endOfMonth(paymentDate);

  const [incomesResult, accountsResult, invoicesResult] = await Promise.all([
    client
      .from("income_sources")
      .select("amount")
      .eq("user_id", userId)
      .eq("status", "received")
      .gte("received_date", periodStart)
      .lte("received_date", periodEnd)
      .is("archived_at", null),
    client
      .from("accounts_payable")
      .select("amount")
      .eq("user_id", userId)
      .eq("status", "paid")
      .gte("paid_at", `${periodStart}T00:00:00.000Z`)
      .lte("paid_at", `${periodEnd}T23:59:59.999Z`)
      .is("archived_at", null),
    client
      .from("credit_card_invoices")
      .select("paid_amount")
      .eq("user_id", userId)
      .in("status", ["paid", "partial"])
      .gte("paid_at", `${periodStart}T00:00:00.000Z`)
      .lte("paid_at", `${periodEnd}T23:59:59.999Z`)
      .is("archived_at", null),
  ]);

  if (incomesResult.error) {
    console.error("Erro técnico ao verificar entradas do período:", incomesResult.error);
    return { data: null, error: { message: "Não foi possível verificar as entradas do período." } };
  }
  if (accountsResult.error) {
    console.error("Erro técnico ao verificar contas pagas do período:", accountsResult.error);
    return { data: null, error: { message: "Não foi possível verificar as contas pagas do período." } };
  }
  if (invoicesResult.error) {
    console.error("Erro técnico ao verificar faturas pagas do período:", invoicesResult.error);
    return { data: null, error: { message: "Não foi possível verificar as faturas pagas do período." } };
  }

  const inflows = (incomesResult.data ?? []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const paidAccounts = (accountsResult.data ?? []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const paidInvoices = (invoicesResult.data ?? []).reduce((sum, item) => sum + Number(item.paid_amount || 0), 0);
  const outflows = paidAccounts + paidInvoices;
  const available = inflows - outflows;

  return {
    data: {
      periodStart,
      periodEnd,
      inflows,
      outflows,
      available,
      requiredAmount: amount,
      hasEnough: available >= amount,
    },
    error: null,
  };
}

export async function createLinkedEntry(
  client: AppSupabaseClient,
  userId: string,
  context: LinkedEntryContext,
  values: LinkedEntryFormValues,
) {
  const amount = Number(values.amount || 0);
  const receivedDate = values.date;
  const linkFields = buildFinancialLinkFields(context);

  const result = await client
    .from("income_sources")
    .insert({
      user_id: userId,
      name: values.title.trim(),
      description: `Entrada vinculada a ${linkedPaymentLabel(context.paymentType)}.`,
      source_type: values.type,
      inflow_kind: inflowKindForLinkedEntry(values.type),
      amount,
      expected_date: receivedDate,
      received_date: receivedDate,
      received_at: `${receivedDate}T00:00:00.000Z`,
      person_id: values.person_id || null,
      status: "received",
      confidence: "high",
      notes: values.notes.trim() || null,
      linked_payment_type: context.paymentType,
      linked_payment_id: context.paymentId,
      linked_module: linkFields.linked_module,
      linked_record_id: linkFields.linked_record_id,
      is_generated: true,
      linked_credit_card_invoice_id: context.creditCardInvoiceId ?? null,
      linked_account_payable_id: context.accountPayableId ?? null,
      linked_installment_id: context.installmentId ?? null,
      linked_reimbursement_id: context.reimbursementId ?? null,
    })
    .select("*")
    .single();

  if (result.error) {
    console.error("Erro técnico ao criar entrada vinculada:", result.error);
    return { data: null, error: { message: "Não foi possível registrar a entrada vinculada." } };
  }

  await safeLogCreate(client, userId, "income_sources", result.data.id, result.data, {
    linked_payment_type: context.paymentType,
    linked_payment_id: context.paymentId,
  });

  await safeLogAction(client, {
    user_id: userId,
    module: "income_sources",
    record_id: result.data.id,
    action: "linked_entry_created",
    field_name: null,
    old_value: null,
    new_value: {
      amount,
      source_type: values.type,
      inflow_kind: inflowKindForLinkedEntry(values.type),
    },
    metadata: {
      linked_payment_type: context.paymentType,
      linked_payment_id: context.paymentId,
      ...linkFields,
    },
  });

  await logFinancialLinkCreated(client, userId, "income_sources", result.data.id, linkFields.linked_module, linkFields.linked_record_id, {
    linked_payment_type: context.paymentType,
    linked_payment_id: context.paymentId,
  });

  return { data: result.data, error: null };
}

export async function logFinancialLinkCreated(
  client: AppSupabaseClient,
  userId: string,
  module: FinancialLinkModule,
  recordId: string,
  linkedModule: FinancialLinkModule,
  linkedRecordId: string,
  metadata?: Record<string, Json>,
) {
  await safeLogAction(client, {
    user_id: userId,
    module,
    record_id: recordId,
    action: "financial_link_created",
    field_name: null,
    old_value: null,
    new_value: {
      linked_module: linkedModule,
      linked_record_id: linkedRecordId,
    },
    metadata: metadata ?? {},
  });
}

export async function logFinancialLinkUpdated(
  client: AppSupabaseClient,
  userId: string,
  module: FinancialLinkModule,
  recordId: string,
  linkedModule: FinancialLinkModule,
  linkedRecordId: string,
  metadata?: Record<string, Json>,
) {
  await safeLogAction(client, {
    user_id: userId,
    module,
    record_id: recordId,
    action: "financial_link_updated",
    field_name: null,
    old_value: null,
    new_value: {
      linked_module: linkedModule,
      linked_record_id: linkedRecordId,
    },
    metadata: metadata ?? {},
  });
}

export async function logPaymentContinuedWithoutSufficientEntry(
  client: AppSupabaseClient,
  userId: string,
  context: LinkedEntryContext,
  availability: CashAvailability | null,
) {
  await safeLogAction(client, {
    user_id: userId,
    module: paymentModule(context.paymentType),
    record_id: context.paymentId,
    action: "payment_continued_without_sufficient_entry",
    field_name: null,
    old_value: null,
    new_value: {
      amount: context.amount,
      payment_date: context.date,
    },
    metadata: {
      availability: availability ? { ...availability } : null,
      linked_payment_type: context.paymentType,
    },
  });
}

function linkedPaymentLabel(paymentType: string) {
  if (paymentType === "invoice_payment") return "pagamento de fatura";
  if (paymentType === "installment_payment") return "pagamento de parcela";
  if (paymentType === "reimbursement_receipt") return "recebimento de reembolso";
  return "pagamento";
}

function paymentModule(paymentType: string) {
  return financialLinkModuleForPaymentType(paymentType as LinkedEntryContext["paymentType"]);
}

function endOfMonth(date: string) {
  const [year, month] = date.split("-").map(Number);
  const last = new Date(year, month, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
}
