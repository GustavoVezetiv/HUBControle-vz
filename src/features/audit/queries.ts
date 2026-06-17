import type { AppSupabaseClient } from "@/features/shared/types";
import type { AuditLog } from "@/lib/supabase/types";

export type AuditLogFilters = {
  module?: string;
  action?: string;
  text?: string;
  recordId?: string;
  dateFrom?: string;
  dateTo?: string;
};

export async function listAuditLogs(
  client: AppSupabaseClient,
  userId: string,
  filters: AuditLogFilters = {},
) {
  let query = client
    .from("audit_logs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (filters.module && filters.module !== "all") query = query.eq("module", filters.module);
  if (filters.action && filters.action !== "all") query = query.eq("action", filters.action);
  if (filters.recordId?.trim()) query = query.eq("record_id", filters.recordId.trim());
  if (filters.dateFrom) query = query.gte("created_at", `${filters.dateFrom}T00:00:00.000Z`);
  if (filters.dateTo) query = query.lte("created_at", `${filters.dateTo}T23:59:59.999Z`);
  if (filters.text?.trim()) {
    const term = filters.text.trim();
    query = query.or(`field_name.ilike.%${term}%,action.ilike.%${term}%,module.ilike.%${term}%`);
  }

  return query;
}

export async function listRecordAuditLogs(
  client: AppSupabaseClient,
  userId: string,
  module: string,
  recordId: string,
) {
  return client
    .from("audit_logs")
    .select("*")
    .eq("user_id", userId)
    .eq("module", module)
    .eq("record_id", recordId)
    .order("created_at", { ascending: false })
    .limit(20);
}

export function normalizeAuditLogs(rows: AuditLog[] | null | undefined) {
  return rows ?? [];
}
