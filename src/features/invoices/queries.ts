import type { InvoiceFormValues, InvoiceRow } from "@/features/invoices/types";
import { safeLogAction, safeLogCreate, safeLogFieldDiffs } from "@/features/audit/logger";
import { logFinancialLinkCreated, logFinancialLinkUpdated } from "@/features/linked-entries/queries";
import { archiveRecord, restoreArchivedRecord } from "@/features/shared/archive";
import type { AppSupabaseClient } from "@/features/shared/types";

export async function listInvoices(client: AppSupabaseClient) {
  return client.from("credit_card_invoices").select("*").is("archived_at", null).order("due_date", { ascending: true });
}

export async function listInvoiceCards(client: AppSupabaseClient) {
  return client.from("credit_cards").select("id,name,issuer,closing_day,due_day").order("name", { ascending: true });
}

export async function createInvoice(client: AppSupabaseClient, userId: string, values: InvoiceFormValues) {
  const result = await client.from("credit_card_invoices").insert(toPayload(userId, values)).select("*").single();
  if (!result.error && result.data) {
    await safeLogCreate(client, userId, "credit_card_invoices", result.data.id, result.data);
  }
  return result;
}

export async function updateInvoice(client: AppSupabaseClient, id: string, values: InvoiceFormValues) {
  const currentResult = await client.from("credit_card_invoices").select("*").eq("id", id).single();
  if (currentResult.error || !currentResult.data) {
    console.error("Erro técnico ao carregar fatura atual para auditoria:", currentResult.error);
    return { data: null, error: { message: "Não foi possível carregar a fatura atual." } };
  }

  const result = await client.from("credit_card_invoices").update(toPayload(undefined, values)).eq("id", id).select("*").single();

  if (!result.error && result.data) {
    await safeLogFieldDiffs(client, result.data.user_id, "credit_card_invoices", result.data.id, currentResult.data, result.data);
    if (currentResult.data.status !== "paid" && result.data.status === "paid") {
      await safeLogAction(client, {
        user_id: result.data.user_id,
        module: "credit_card_invoices",
        record_id: result.data.id,
        action: "invoice_paid",
        field_name: "status",
        old_value: currentResult.data.status,
        new_value: result.data.status,
        metadata: { paid_amount: result.data.paid_amount },
      });
    }
  }

  return result;
}

export async function archiveInvoice(client: AppSupabaseClient, id: string, userId: string, reason?: string) {
  return archiveRecord(client, "credit_card_invoices", id, userId, reason);
}

export async function restoreInvoice(client: AppSupabaseClient, id: string, userId: string) {
  return restoreArchivedRecord(client, "credit_card_invoices", id, userId);
}

export async function getInvoiceDetail(client: AppSupabaseClient, id: string) {
  const [invoice, cards, transactions, reimbursements] = await Promise.all([
    client.from("credit_card_invoices").select("*").eq("id", id).is("archived_at", null).single(),
    listInvoiceCards(client),
    client.from("credit_card_transactions").select("*").eq("invoice_id", id).order("transaction_date", { ascending: false }),
    client.from("reimbursements").select("*").eq("credit_card_invoice_id", id).is("archived_at", null),
  ]);

  return { invoice, cards, transactions, reimbursements };
}

export async function registerInvoicePayment(
  client: AppSupabaseClient,
  userId: string,
  invoice: InvoiceRow,
  amount: number,
  paymentDate: string,
  linkedIncomeSourceId?: string | null,
) {
  const nextPaidAmount = Number(invoice.paid_amount || 0) + amount;
  const total = Number(invoice.total_amount || 0);
  const nextStatus = nextPaidAmount >= total ? "paid" : "partial";
  const paidAt = `${paymentDate}T00:00:00.000Z`;

  const accountResult = await upsertInvoicePaymentAccount(client, userId, invoice, amount, paymentDate);
  if (accountResult.error) {
    return { data: null, error: accountResult.error };
  }

  const result = await client
    .from("credit_card_invoices")
    .update({
      paid_amount: nextPaidAmount,
      status: nextStatus,
      paid_at: paidAt,
    })
    .eq("id", invoice.id)
    .select("*")
    .single();

  if (result.error) {
    console.error("Erro técnico ao registrar pagamento da fatura:", result.error);
    return { data: null, error: { message: "Não foi possível registrar o pagamento da fatura." } };
  }

  await safeLogAction(client, {
    user_id: userId,
    module: "credit_card_invoices",
    record_id: invoice.id,
    action: "payment_registered",
    field_name: null,
    old_value: {
      paid_amount: invoice.paid_amount,
      status: invoice.status,
    },
    new_value: {
      paid_amount: result.data.paid_amount,
      status: result.data.status,
      amount,
      payment_date: paymentDate,
    },
    metadata: {
      account_payable_id: accountResult.data?.id ?? null,
      linked_income_source_id: linkedIncomeSourceId ?? null,
    },
  });

  if (invoice.status !== "paid" && result.data.status === "paid") {
    await safeLogAction(client, {
      user_id: userId,
      module: "credit_card_invoices",
      record_id: invoice.id,
      action: "invoice_paid",
      field_name: "status",
      old_value: invoice.status,
      new_value: result.data.status,
      metadata: { paid_amount: result.data.paid_amount },
    });
  }

  return result;
}

function toPayload(userId: string | undefined, values: InvoiceFormValues): Partial<InvoiceRow> {
  return {
    ...(userId ? { user_id: userId } : {}),
    credit_card_id: values.credit_card_id,
    reference_month: values.reference_month,
    closing_date: values.closing_date || null,
    due_date: values.due_date,
    total_amount: Number(values.total_amount || 0),
    paid_amount: Number(values.paid_amount || 0),
    status: values.status,
    notes: values.notes.trim() || null,
  };
}

async function upsertInvoicePaymentAccount(
  client: AppSupabaseClient,
  userId: string,
  invoice: InvoiceRow,
  amount: number,
  paymentDate: string,
) {
  const existingResult = await client
    .from("accounts_payable")
    .select("*")
    .eq("user_id", userId)
    .eq("credit_card_invoice_id", invoice.id)
    .eq("source_type", "invoice_payment")
    .maybeSingle();

  if (existingResult.error) {
    console.error("Erro técnico ao procurar conta de pagamento da fatura:", existingResult.error);
    return { data: null, error: { message: "Não foi possível verificar a conta vinculada ao pagamento da fatura." } };
  }

  const payload = {
    user_id: userId,
    title: `Pagamento de fatura ${invoice.reference_month.slice(0, 7)}`,
    description: "Conta gerada automaticamente ao registrar pagamento de fatura.",
    amount,
    due_date: paymentDate,
    status: "paid",
    priority: "high",
    risk_level: "high" as const,
    paid_at: `${paymentDate}T00:00:00.000Z`,
    payment_method_planned: "cash",
    can_delay: false,
    delay_risk: "high" as const,
    source_type: "invoice_payment",
    source_id: invoice.id,
    linked_module: "credit_card_invoices",
    linked_record_id: invoice.id,
    is_generated: true,
    credit_card_invoice_id: invoice.id,
    notes: "Pagamento de fatura registrado pelo fluxo de entrada vinculada.",
  };

  if (existingResult.data) {
    const updateResult = await client
      .from("accounts_payable")
      .update({
        amount: Number(existingResult.data.amount || 0) + amount,
        due_date: paymentDate,
        status: "paid",
        paid_at: `${paymentDate}T00:00:00.000Z`,
        source_id: invoice.id,
        linked_module: "credit_card_invoices",
        linked_record_id: invoice.id,
        is_generated: true,
      })
      .eq("id", existingResult.data.id)
      .select("*")
      .single();

    if (updateResult.error) {
      console.error("Erro técnico ao atualizar conta de pagamento da fatura:", updateResult.error);
        return { data: null, error: { message: "Não foi possível atualizar a conta vinculada ao pagamento da fatura." } };
    }

    await logFinancialLinkUpdated(client, userId, "accounts_payable", updateResult.data.id, "credit_card_invoices", invoice.id, {
      source_type: "invoice_payment",
      credit_card_invoice_id: invoice.id,
    });

    return { data: updateResult.data, error: null };
  }

  const insertResult = await client.from("accounts_payable").insert(payload).select("*").single();
  if (insertResult.error) {
    console.error("Erro técnico ao criar conta de pagamento da fatura:", insertResult.error);
    return { data: null, error: { message: "Não foi possível criar a conta vinculada ao pagamento da fatura." } };
  }

  await safeLogCreate(client, userId, "accounts_payable", insertResult.data.id, insertResult.data, {
    source_type: "invoice_payment",
    credit_card_invoice_id: invoice.id,
  });

  await logFinancialLinkCreated(client, userId, "accounts_payable", insertResult.data.id, "credit_card_invoices", invoice.id, {
    source_type: "invoice_payment",
    credit_card_invoice_id: invoice.id,
  });

  return { data: insertResult.data, error: null };
}
