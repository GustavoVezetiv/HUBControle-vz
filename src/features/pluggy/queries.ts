import type { AppSupabaseClient } from "../shared/types";
import type { Json } from "@/lib/supabase/types";
import { allReferencePages } from "../organizze/references";
import { matchRules } from "./reconciliation";
import type {
  PluggySnapshot,
  ClassificationRule,
  LedgerEntry,
  InboxReview,
} from "./types";
import type { PluggyPreview } from "./preview";
import type { HubCategory } from "../organizze/types";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export async function loadPluggyLedger(client: AppSupabaseClient, owner: string) {
  const [rows, batches, readiness] = await Promise.all([
    allReferencePages((from, to) =>
      client
        .from("import_rows")
        .select("raw_data,mapped_data,target_entity_type,target_entity_id,updated_at", {
          count: "exact",
        })
        .eq("user_id", owner)
        .eq("mapped_data->>source", "pluggy")
        .order("id")
        .range(from, to),
    ),
    allReferencePages((from, to) =>
      client
        .from("import_batches")
        .select("id,mapping_config", { count: "exact" })
        .eq("user_id", owner)
        .eq("mapping_config->>source", "pluggy")
        .eq("mapping_config->>kind", "classification_rule")
        .order("id")
        .range(from, to),
    ),
    client.rpc("pluggy_inbox_ready"),
  ]);
  if (
    readiness.error &&
    readiness.error.code !== "PGRST202" &&
    readiness.error.code !== "42883"
  )
    throw new Error("Não foi possível conferir a disponibilidade da conciliação.");
  const ledger: LedgerEntry[] = rows.map((row) => {
    const metadata = record(row.mapped_data);
    return {
      sourceKey: String(metadata.source_key),
      raw: record(record(row.raw_data).raw),
      latest: record(metadata.latest_raw),
      linkedRaw: metadata.linked_raw ? record(metadata.linked_raw) : undefined,
      review: {
        state: (metadata.state ?? "pending") as InboxReview["state"],
        categoryId:
          typeof metadata.category_id === "string" ? metadata.category_id : null,
        ownership: (metadata.ownership ?? null) as InboxReview["ownership"],
        target: row.target_entity_id ? row.target_entity_type : null,
        targetId: row.target_entity_id,
        updatedAt: row.updated_at,
        reviewed: metadata.reviewed === true,
      },
    };
  });
  const rules: ClassificationRule[] = batches.map((row) => {
    const data = record(row.mapping_config);
    return {
      id: row.id,
      pattern: String(data.pattern ?? ""),
      categoryId: String(data.categoryId ?? ""),
      ownership: (data.ownership ?? null) as ClassificationRule["ownership"],
      active: data.active === true,
    };
  });
  return { ledger, rules, ready: !readiness.error && readiness.data === true };
}

export function stageRows(
  snapshot: PluggySnapshot,
  preview: PluggyPreview,
  rules: ClassificationRule[],
  categories: HubCategory[],
) {
  return preview.movements.map((row) => {
    const classification = matchRules(row.description, row.kind, rules, categories);
    return {
      sourceKey: row.sourceKey,
      institution: snapshot.institution,
      itemId: snapshot.itemId,
      accountId: row.accountId,
      accountType: row.accountType,
      fetchedAt: snapshot.fetchedAt,
      raw: snapshot.transactions.find(
        (raw) => raw.id === row.id && raw.accountId === row.accountId,
      ),
      categoryId: classification.categoryId,
      ownership: classification.ownership,
      ruleIds: classification.ruleIds,
      pending:
        row.candidates.length > 0 ||
        row.bankStatus !== "POSTED" ||
        !["expense", "income"].includes(row.kind),
    };
  });
}
export async function stagePluggy(
  client: AppSupabaseClient,
  rows: ReturnType<typeof stageRows>,
) {
  const response = await client.rpc("stage_pluggy_rows", {
    p_rows: rows as unknown as Json,
  });
  if (response.error)
    throw new Error(
      "Falha ao guardar a caixa de entrada. O backup foi preservado; nenhum lançamento financeiro foi criado.",
    );
  return response.data;
}
