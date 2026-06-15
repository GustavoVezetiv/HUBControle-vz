import type { PlannedPurchaseFormValues, PlannedPurchaseRow } from "@/features/planned-purchases/types";
import { archiveRecord, restoreArchivedRecord } from "@/features/shared/archive";
import type { AppSupabaseClient } from "@/features/shared/types";

export async function listPlannedPurchases(client: AppSupabaseClient) {
  return client.from("planned_purchases").select("*").is("archived_at", null).order("purchase_date", { ascending: false });
}

export async function listPlannedPurchaseSupportData(client: AppSupabaseClient) {
  const categories = await client.from("categories").select("id,name,type,color,icon").in("type", ["purchase", "expense", "other"]).order("name", { ascending: true });
  return { categories };
}

export async function createPlannedPurchase(client: AppSupabaseClient, userId: string, values: PlannedPurchaseFormValues) {
  return client.from("planned_purchases").insert(toPayload(userId, values)).select("*").single();
}

export async function updatePlannedPurchase(client: AppSupabaseClient, id: string, values: PlannedPurchaseFormValues) {
  return client.from("planned_purchases").update(toPayload(undefined, values)).eq("id", id).select("*").single();
}

export async function archivePlannedPurchase(client: AppSupabaseClient, id: string, userId: string, reason?: string) {
  return archiveRecord(client, "planned_purchases", id, userId, reason);
}

export async function restorePlannedPurchase(client: AppSupabaseClient, id: string, userId: string) {
  return restoreArchivedRecord(client, "planned_purchases", id, userId);
}

function toPayload(userId: string | undefined, values: PlannedPurchaseFormValues): Partial<PlannedPurchaseRow> {
  const installmentCount = values.installment_count ? Number(values.installment_count) : null;

  return {
    ...(userId ? { user_id: userId } : {}),
    title: values.title.trim(),
    description: values.description.trim() || null,
    estimated_amount: Number(values.estimated_amount || 0),
    paid_amount: Number(values.paid_amount || 0),
    target_date: values.target_date || null,
    purchase_date: values.purchase_date || null,
    category_id: values.category_id || null,
    project: values.project.trim() || null,
    payment_method: values.payment_method,
    installment_count: installmentCount,
    decision_status: values.decision_status,
    risk_level: values.risk_level,
    notes: values.notes.trim() || null,
  };
}
