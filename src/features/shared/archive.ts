import type { AppSupabaseClient } from "@/features/shared/types";

export type ArchiveTarget =
  | "reimbursements"
  | "accounts_payable"
  | "income_sources"
  | "credit_card_invoices"
  | "credit_card_transactions"
  | "planned_purchases"
  | "goals";

export async function archiveRecord(
  client: AppSupabaseClient,
  table: ArchiveTarget,
  id: string,
  userId: string,
  reason?: string,
) {
  return client
    .from(table)
    .update({
      archived_at: new Date().toISOString(),
      archived_by: userId,
      archive_reason: reason?.trim() || null,
    })
    .eq("id", id)
    .eq("user_id", userId)
    .is("archived_at", null)
    .select("*")
    .single();
}

export async function restoreArchivedRecord(
  client: AppSupabaseClient,
  table: ArchiveTarget,
  id: string,
  userId: string,
) {
  return client
    .from(table)
    .update({
      archived_at: null,
      archived_by: null,
      archive_reason: null,
    })
    .eq("id", id)
    .eq("user_id", userId)
    .not("archived_at", "is", null)
    .select("*")
    .single();
}
