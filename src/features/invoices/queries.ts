import type { InvoiceFormValues, InvoiceRow } from "@/features/invoices/types";
import { archiveRecord, restoreArchivedRecord } from "@/features/shared/archive";
import type { AppSupabaseClient } from "@/features/shared/types";

export async function listInvoices(client: AppSupabaseClient) {
  return client.from("credit_card_invoices").select("*").is("archived_at", null).order("due_date", { ascending: true });
}

export async function listInvoiceCards(client: AppSupabaseClient) {
  return client.from("credit_cards").select("id,name,issuer,closing_day,due_day").order("name", { ascending: true });
}

export async function createInvoice(client: AppSupabaseClient, userId: string, values: InvoiceFormValues) {
  return client.from("credit_card_invoices").insert(toPayload(userId, values)).select("*").single();
}

export async function updateInvoice(client: AppSupabaseClient, id: string, values: InvoiceFormValues) {
  return client.from("credit_card_invoices").update(toPayload(undefined, values)).eq("id", id).select("*").single();
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
