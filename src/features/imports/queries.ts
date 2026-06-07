import { buildInsertPayload } from "@/features/imports/import-engine";
import { isActiveImportTarget } from "@/features/imports/templates";
import type { ImportTarget, PreviewRow, ReferenceData } from "@/features/imports/types";
import type { AppSupabaseClient } from "@/features/shared/types";
import type { ImportBatch, ImportRow, Json } from "@/lib/supabase/types";

export async function listImportBatches(client: AppSupabaseClient) {
  return client.from("import_batches").select("*").order("created_at", { ascending: false }).limit(20);
}

export async function listImportRows(client: AppSupabaseClient, userId: string, batchId: string): Promise<PreviewRow[]> {
  const result = await client
    .from("import_rows")
    .select("row_number,raw_data,mapped_data,errors,status,target_entity_type")
    .eq("user_id", userId)
    .eq("import_batch_id", batchId)
    .order("row_number", { ascending: true });

  if (result.error) throw result.error;

  return (result.data ?? []).map((row) => {
    const mapped = asRecord(row.mapped_data);
    const errors = Array.isArray(row.errors) ? row.errors.map(String) : [];
    const missingCategoryName = typeof mapped.missing_category_name === "string" ? mapped.missing_category_name : null;
    const duplicate = mapped._import_duplicate === true;

    return {
      rowNumber: row.row_number,
      target: normalizeImportTarget(row.target_entity_type),
      raw: asStringRecord(row.raw_data),
      mapped,
      status: normalizePreviewStatus(row.status),
      errors,
      warnings: [
        duplicate ? "Ignorada por duplicidade. Esta linha não será importada por padrão." : null,
        missingCategoryName ? `Categoria não encontrada: ${missingCategoryName}. O item pode ser importado sem categoria.` : null,
      ].filter((message): message is string => Boolean(message)),
      duplicate,
      missingCategoryName,
    };
  });
}

export async function loadImportReferenceData(client: AppSupabaseClient): Promise<ReferenceData> {
  const [people, categories, accounts, incomeSources, goals, plannedPurchases] = await Promise.all([
    client.from("people").select("id,name").order("name"),
    client.from("categories").select("id,name,type").order("name"),
    client.from("accounts_payable").select("id,title,amount,due_date"),
    client.from("income_sources").select("id,name,amount,expected_date"),
    client.from("goals").select("name,target_date,goal_category,category_id,category_label"),
    client.from("planned_purchases").select("title,external_url,category_id"),
  ]);

  return {
    people: people.data ?? [],
    categories: categories.data ?? [],
    cards: [],
    invoices: [],
    accounts: accounts.data ?? [],
    incomeSources: incomeSources.data ?? [],
    existing: {
      people: people.data ?? [],
      categories: categories.data ?? [],
      accounts_payable: accounts.data ?? [],
      income_sources: incomeSources.data ?? [],
      credit_cards: [],
      credit_card_invoices: [],
      credit_card_transactions: [],
      reimbursements: [],
      planned_purchases:
        plannedPurchases.data?.map((item) => ({
          title: item.title,
          external_url: item.external_url,
          category_id: item.category_id,
          category_name: categories.data?.find((category) => category.id === item.category_id)?.name ?? null,
        })) ?? [],
      goals: goals.data ?? [],
    },
  };
}

export async function saveImportPreview(
  client: AppSupabaseClient,
  userId: string,
  target: ImportTarget,
  file: File,
  rows: PreviewRow[],
) {
  if (!isActiveImportTarget(target)) {
    throw new Error("Importação deste módulo ainda não está disponível.");
  }

  const validRows = rows.filter((row) => row.status === "valid").length;
  const invalidRows = rows.filter((row) => row.status === "invalid").length;
  const fileType = file.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv";

  const batch = await client
    .from("import_batches")
    .insert({
      user_id: userId,
      module: target,
      target_type: target,
      file_name: file.name,
      file_type: fileType,
      status: "parsed",
      total_rows: rows.length,
      valid_rows: validRows,
      invalid_rows: invalidRows,
      mapping_config: null,
    } satisfies Partial<ImportBatch>)
    .select("*")
    .single();

  if (batch.error) return { batch, rows: null };

  const rowPayload = rows.map((row) => ({
    user_id: userId,
    import_batch_id: batch.data.id,
    row_number: row.rowNumber,
    raw_data: row.raw,
    parsed_data: { ...row.mapped, _import_duplicate: row.duplicate ?? false },
    mapped_data: { ...row.mapped, _import_duplicate: row.duplicate ?? false },
    validation_errors: row.errors,
    errors: row.errors,
    status: row.status,
    target_entity_type: row.target ?? target,
  })) satisfies Partial<ImportRow>[];

  const rowResult = await client.from("import_rows").insert(rowPayload).select("*");

  return { batch, rows: rowResult };
}

export async function confirmImportRows(
  client: AppSupabaseClient,
  userId: string,
  batchId: string,
  target: ImportTarget,
  rows: PreviewRow[],
) {
  if (!isActiveImportTarget(target)) {
    throw new Error("Importação deste módulo ainda não está disponível.");
  }

  const results: PreviewRow[] = [];

  for (const row of rows) {
    if (row.status !== "valid") {
      results.push(row);
      await client
        .from("import_rows")
        .update({
          status: row.status,
          errors: row.errors,
          validation_errors: row.errors,
        })
        .eq("import_batch_id", batchId)
        .eq("row_number", row.rowNumber);
      continue;
    }

    try {
      const rowTarget = resolveRowTarget(target, row);
      const payload = buildInsertPayload(rowTarget, userId, {
        ...row.mapped,
        import_batch_id: batchId,
      });
      const insertResult = await insertTargetRow(client, rowTarget, payload);

      if (insertResult.error) {
        const failed = { ...row, status: "failed" as const, errors: [insertResult.error.message] };
        results.push(failed);
        await client
          .from("import_rows")
          .update({
            status: "failed",
            errors: failed.errors,
            validation_errors: failed.errors,
          })
          .eq("import_batch_id", batchId)
          .eq("row_number", row.rowNumber);
        continue;
      }

      const imported = { ...row, status: "imported" as const, errors: [] };
      results.push(imported);
      await client
        .from("import_rows")
        .update({
          status: "imported",
          target_entity_id: insertResult.data?.id ?? null,
          target_entity_type: rowTarget,
        })
        .eq("import_batch_id", batchId)
        .eq("row_number", row.rowNumber);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro inesperado ao importar a linha.";
      const failed = { ...row, status: "failed" as const, errors: [message] };
      results.push(failed);
      await client
        .from("import_rows")
        .update({
          status: "failed",
          errors: failed.errors,
          validation_errors: failed.errors,
        })
        .eq("import_batch_id", batchId)
        .eq("row_number", row.rowNumber);
    }
  }

  const importedCount = results.filter((row) => row.status === "imported").length;
  const failedCount = results.filter((row) => row.status === "failed").length;

  await client
    .from("import_batches")
    .update({
      status: failedCount ? "failed" : "confirmed",
      confirmed_at: new Date().toISOString(),
      imported_at: new Date().toISOString(),
      valid_rows: importedCount,
      invalid_rows: results.filter((row) => ["invalid", "failed"].includes(row.status)).length,
    })
    .eq("id", batchId);

  return results;
}

export async function createMissingImportCategories(
  client: AppSupabaseClient,
  userId: string,
  names: string[],
) {
  const uniqueNames = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
  if (uniqueNames.length === 0) return { created: 0, error: null };

  const existing = await client
    .from("categories")
    .select("name")
    .eq("user_id", userId)
    .in("name", uniqueNames);

  if (existing.error) return { created: 0, error: existing.error };

  const existingNames = new Set((existing.data ?? []).map((item) => item.name.toLowerCase()));
  const namesToCreate = uniqueNames.filter((name) => !existingNames.has(name.toLowerCase()));
  if (namesToCreate.length === 0) return { created: 0, error: null };

  const payload = namesToCreate.map((name) => ({
    user_id: userId,
    name,
    type: "other",
    is_active: true,
  }));

  const result = await client.from("categories").insert(payload).select("id");
  return { created: result.data?.length ?? 0, error: result.error };
}

export async function undoImportBatch(client: AppSupabaseClient, userId: string, batchId: string) {
  const rows = await client
    .from("import_rows")
    .select("target_entity_id,target_entity_type")
    .eq("user_id", userId)
    .eq("import_batch_id", batchId)
    .eq("status", "imported");

  if (rows.error) throw rows.error;

  const importedRows = rows.data ?? [];
  let deleted = 0;

  for (const target of ["goals", "planned_purchases"] as const) {
    const ids = importedRows
      .filter((row) => row.target_entity_type === target && row.target_entity_id)
      .map((row) => row.target_entity_id as string);

    if (ids.length === 0) continue;

    const result = await client
      .from(target)
      .delete()
      .eq("user_id", userId)
      .eq("import_batch_id", batchId)
      .in("id", ids);

    if (result.error) throw result.error;
    deleted += ids.length;
  }

  await client
    .from("import_rows")
    .update({ status: "skipped" })
    .eq("user_id", userId)
    .eq("import_batch_id", batchId)
    .eq("status", "imported");

  await client
    .from("import_batches")
    .update({ status: "cancelled", notes: "Importação desfeita pelo usuário." })
    .eq("user_id", userId)
    .eq("id", batchId);

  return { deleted };
}

function resolveRowTarget(target: ImportTarget, row: PreviewRow) {
  if (target === "system_goals_purchases") {
    if (row.target === "goals" || row.target === "planned_purchases") return row.target;
    throw new Error("Linha sem destino final definido.");
  }
  return target;
}

async function insertTargetRow(client: AppSupabaseClient, target: ImportTarget, payload: Record<string, unknown>) {
  if (target === "people") return client.from("people").insert(payload).select("id").single();
  if (target === "categories") return client.from("categories").insert(payload).select("id").single();
  if (target === "accounts_payable") {
    return client.from("accounts_payable").insert(payload).select("id").single();
  }
  if (target === "income_sources") {
    return client.from("income_sources").insert(payload).select("id").single();
  }
  if (target === "planned_purchases") {
    return client.from("planned_purchases").insert(payload).select("id").single();
  }
  if (target === "goals") {
    return client.from("goals").insert(payload).select("id").single();
  }
  throw new Error("Importação deste módulo ainda não está disponível.");
}

function asRecord(value: unknown): Record<string, Json> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, Json>;
  }
  return {};
}

function asStringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, String(item ?? "")]));
}

function normalizeImportTarget(value: string | null): ImportTarget | undefined {
  const targets: ImportTarget[] = [
    "people",
    "categories",
    "accounts_payable",
    "income_sources",
    "credit_cards",
    "credit_card_invoices",
    "credit_card_transactions",
    "reimbursements",
    "installments",
    "planned_purchases",
    "goals",
    "system_goals_purchases",
  ];
  return targets.includes(value as ImportTarget) ? (value as ImportTarget) : undefined;
}

function normalizePreviewStatus(value: string): PreviewRow["status"] {
  if (["valid", "invalid", "skipped", "imported", "failed"].includes(value)) {
    return value as PreviewRow["status"];
  }
  return "invalid";
}
