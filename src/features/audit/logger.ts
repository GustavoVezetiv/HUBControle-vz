import type { AppSupabaseClient } from "@/features/shared/types";
import type { AuditLog, Json } from "@/lib/supabase/types";

export type AuditAction =
  | "create"
  | "update"
  | "archive"
  | "restore"
  | "move_invoice"
  | "status_change"
  | "invoice_paid"
  | "reimbursement_received"
  | "renegotiation"
  | "import_confirmed"
  | "financial_recalculation";

export type AuditLogEntry = Pick<
  AuditLog,
  "user_id" | "module" | "record_id" | "action" | "field_name" | "old_value" | "new_value" | "metadata"
>;

const redactedFields = new Set(["pix_key"]);
const ignoredDiffFields = new Set(["updated_at"]);

export async function safeInsertAuditLogs(
  client: AppSupabaseClient,
  entries: AuditLogEntry[],
) {
  if (entries.length === 0) return;

  const result = await client.from("audit_logs").insert(entries);
  if (result.error) {
    console.error("Erro técnico ao registrar histórico de auditoria:", {
      error: result.error,
      entries,
    });
  }
}

export async function safeLogCreate(
  client: AppSupabaseClient,
  userId: string,
  module: string,
  recordId: string,
  nextValue: Record<string, unknown>,
  metadata?: Record<string, Json>,
) {
  await safeInsertAuditLogs(client, [
    {
      user_id: userId,
      module,
      record_id: recordId,
      action: "create",
      field_name: null,
      old_value: null,
      new_value: sanitizeValue(nextValue),
      metadata: metadata ?? {},
    },
  ]);
}

export async function safeLogFieldDiffs(
  client: AppSupabaseClient,
  userId: string,
  module: string,
  recordId: string,
  previousValue: Record<string, unknown>,
  nextValue: Record<string, unknown>,
  metadata?: Record<string, Json>,
) {
  const entries: AuditLogEntry[] = [];
  const keys = new Set([...Object.keys(previousValue), ...Object.keys(nextValue)]);

  for (const key of keys) {
    if (ignoredDiffFields.has(key)) continue;
    const before = sanitizeFieldValue(key, previousValue[key]);
    const after = sanitizeFieldValue(key, nextValue[key]);
    if (isSameJsonValue(before, after)) continue;

    entries.push({
      user_id: userId,
      module,
      record_id: recordId,
      action: key === "status" ? "status_change" : "update",
      field_name: key,
      old_value: before,
      new_value: after,
      metadata: metadata ?? {},
    });
  }

  await safeInsertAuditLogs(client, entries);
}

export async function safeLogAction(
  client: AppSupabaseClient,
  entry: AuditLogEntry,
) {
  await safeInsertAuditLogs(client, [entry]);
}

function sanitizeValue(value: unknown): Json {
  if (value === null || typeof value === "undefined") return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => [key, sanitizeFieldValue(key, item)]),
    ) as Json;
  }
  return String(value);
}

function sanitizeFieldValue(fieldName: string, value: unknown): Json {
  if (redactedFields.has(fieldName)) return "[redigido]";
  return sanitizeValue(value);
}

function isSameJsonValue(left: Json, right: Json) {
  return JSON.stringify(left) === JSON.stringify(right);
}
