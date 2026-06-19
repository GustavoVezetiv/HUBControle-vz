import { utils, writeFileXLSX } from "xlsx";

import type { AppSupabaseClient } from "@/features/shared/types";
import type {
  AccountPayable,
  CreditCardInvoice,
  CreditCardTransaction,
  Goal,
  ImportBatch,
  ImportRow,
  IncomeSource,
  Json,
  PlannedPurchase,
  Reimbursement,
} from "@/lib/supabase/types";

export type ExportModule =
  | "accounts_payable"
  | "income_sources"
  | "people"
  | "categories"
  | "credit_cards"
  | "credit_card_invoices"
  | "credit_card_transactions"
  | "reimbursements"
  | "installments"
  | "planned_purchases"
  | "goals"
  | "archived"
  | "imports";

export type ExportMetadata = {
  version: string;
  exportedAt: string;
  user: {
    id: string;
    email: string | null;
  };
  scope: "all" | ExportModule;
};

type ExportBundle = {
  metadata: ExportMetadata;
  modules: Record<ExportModule, unknown[]>;
};

type ArchivedRow = {
  module: string;
  id: string;
  title: string;
  archived_at: string | null;
  archive_reason: string | null;
  raw: Json;
};

const appVersion = "0.1.0";
const lastExportStoragePrefix = "hubvz:last-export";

export type LastExportSummary = {
  fileName: string;
  format: "xlsx" | "json";
  scope: "all" | ExportModule;
  exportedAt: string;
  user: {
    id: string;
    email: string | null;
  };
};

export const exportModuleOptions: Array<{ value: ExportModule; label: string }> = [
  { value: "accounts_payable", label: "Contas" },
  { value: "income_sources", label: "Receitas" },
  { value: "people", label: "Pessoas" },
  { value: "categories", label: "Categorias" },
  { value: "credit_cards", label: "Cartões" },
  { value: "credit_card_invoices", label: "Faturas" },
  { value: "credit_card_transactions", label: "Lançamentos" },
  { value: "reimbursements", label: "Reembolsos" },
  { value: "installments", label: "Parcelamentos" },
  { value: "planned_purchases", label: "Compras e desejos" },
  { value: "goals", label: "Metas" },
  { value: "archived", label: "Arquivados" },
  { value: "imports", label: "Importações" },
];

const moduleSheetNames: Record<ExportModule, string> = {
  accounts_payable: "Contas",
  income_sources: "Receitas",
  people: "Pessoas",
  categories: "Categorias",
  credit_cards: "Cartoes",
  credit_card_invoices: "Faturas",
  credit_card_transactions: "Lancamentos",
  reimbursements: "Reembolsos",
  installments: "Parcelamentos",
  planned_purchases: "Compras",
  goals: "Metas",
  archived: "Arquivados",
  imports: "Importacoes",
};

export async function fetchExportBundle(
  client: AppSupabaseClient,
  userId: string,
  email: string | null,
  scope: "all" | ExportModule,
): Promise<ExportBundle> {
  const exportedAt = new Date().toISOString();

  const [
    accountsResult,
    incomeResult,
    peopleResult,
    categoriesResult,
    cardsResult,
    invoicesResult,
    transactionsResult,
    reimbursementsResult,
    installmentsResult,
    purchasesResult,
    goalsResult,
    importBatchesResult,
    importRowsResult,
    archivedAccountsResult,
    archivedIncomeResult,
    archivedInvoicesResult,
    archivedTransactionsResult,
    archivedReimbursementsResult,
    archivedPurchasesResult,
    archivedGoalsResult,
  ] = await Promise.all([
    client.from("accounts_payable").select("*").eq("user_id", userId).order("due_date", { ascending: true }),
    client.from("income_sources").select("*").eq("user_id", userId).order("expected_date", { ascending: true }),
    client.from("people").select("*").eq("user_id", userId).order("name", { ascending: true }),
    client.from("categories").select("*").eq("user_id", userId).order("name", { ascending: true }),
    client.from("credit_cards").select("*").eq("user_id", userId).order("name", { ascending: true }),
    client.from("credit_card_invoices").select("*").eq("user_id", userId).order("due_date", { ascending: true }),
    client.from("credit_card_transactions").select("*").eq("user_id", userId).order("transaction_date", { ascending: true }),
    client.from("reimbursements").select("*").eq("user_id", userId).order("expected_date", { ascending: true }),
    client.from("installments").select("*").eq("user_id", userId).order("start_date", { ascending: true }),
    client.from("planned_purchases").select("*").eq("user_id", userId).order("created_at", { ascending: true }),
    client.from("goals").select("*").eq("user_id", userId).order("target_date", { ascending: true }),
    client.from("import_batches").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    client.from("import_rows").select("*").eq("user_id", userId).order("import_batch_id", { ascending: false }).order("row_number", { ascending: true }),
    client.from("accounts_payable").select("*").eq("user_id", userId).not("archived_at", "is", null),
    client.from("income_sources").select("*").eq("user_id", userId).not("archived_at", "is", null),
    client.from("credit_card_invoices").select("*").eq("user_id", userId).not("archived_at", "is", null),
    client.from("credit_card_transactions").select("*").eq("user_id", userId).not("archived_at", "is", null),
    client.from("reimbursements").select("*").eq("user_id", userId).not("archived_at", "is", null),
    client.from("planned_purchases").select("*").eq("user_id", userId).not("archived_at", "is", null),
    client.from("goals").select("*").eq("user_id", userId).not("archived_at", "is", null),
  ]);

  const error =
    accountsResult.error ??
    incomeResult.error ??
    peopleResult.error ??
    categoriesResult.error ??
    cardsResult.error ??
    invoicesResult.error ??
    transactionsResult.error ??
    reimbursementsResult.error ??
    installmentsResult.error ??
    purchasesResult.error ??
    goalsResult.error ??
    importBatchesResult.error ??
    importRowsResult.error ??
    archivedAccountsResult.error ??
    archivedIncomeResult.error ??
    archivedInvoicesResult.error ??
    archivedTransactionsResult.error ??
    archivedReimbursementsResult.error ??
    archivedPurchasesResult.error ??
    archivedGoalsResult.error;

  if (error) {
    console.error("Erro técnico ao carregar dados para exportação:", error);
    throw new Error("Não foi possível carregar os dados para exportação.");
  }

  const importsRows = buildImportsExportRows(importBatchesResult.data ?? [], importRowsResult.data ?? []);
  const archivedRows = buildArchivedRows({
    accounts: archivedAccountsResult.data ?? [],
    income: archivedIncomeResult.data ?? [],
    invoices: archivedInvoicesResult.data ?? [],
    transactions: archivedTransactionsResult.data ?? [],
    reimbursements: archivedReimbursementsResult.data ?? [],
    purchases: archivedPurchasesResult.data ?? [],
    goals: archivedGoalsResult.data ?? [],
  });

  const modules: Record<ExportModule, unknown[]> = {
    accounts_payable: accountsResult.data ?? [],
    income_sources: incomeResult.data ?? [],
    people: peopleResult.data ?? [],
    categories: categoriesResult.data ?? [],
    credit_cards: cardsResult.data ?? [],
    credit_card_invoices: invoicesResult.data ?? [],
    credit_card_transactions: transactionsResult.data ?? [],
    reimbursements: reimbursementsResult.data ?? [],
    installments: installmentsResult.data ?? [],
    planned_purchases: purchasesResult.data ?? [],
    goals: goalsResult.data ?? [],
    archived: archivedRows,
    imports: importsRows,
  };

  if (scope !== "all") {
    return {
      metadata: {
        version: appVersion,
        exportedAt,
        user: { id: userId, email },
        scope,
      },
      modules: {
        ...emptyModules(),
        [scope]: modules[scope],
      },
    };
  }

  return {
    metadata: {
      version: appVersion,
      exportedAt,
      user: { id: userId, email },
      scope: "all",
    },
    modules,
  };
}

export async function exportBundleAsJson(
  client: AppSupabaseClient,
  userId: string,
  email: string | null,
  scope: "all" | ExportModule,
) {
  const bundle = await fetchExportBundle(client, userId, email, scope);
  const fileName = buildFileName("json", scope, email, bundle.metadata.exportedAt);
  const payload = {
    metadata: {
      versao: bundle.metadata.version,
      data_exportacao: bundle.metadata.exportedAt,
      usuario: bundle.metadata.user,
      escopo: bundle.metadata.scope,
    },
    modules: bundle.modules,
  };

  downloadBlob(JSON.stringify(payload, null, 2), fileName, "application/json;charset=utf-8");
  saveLastExportSummary(userId, {
    fileName,
    format: "json",
    scope,
    exportedAt: bundle.metadata.exportedAt,
    user: bundle.metadata.user,
  });
}

export async function exportBundleAsXlsx(
  client: AppSupabaseClient,
  userId: string,
  email: string | null,
  scope: "all" | ExportModule,
) {
  const bundle = await fetchExportBundle(client, userId, email, scope);
  const workbook = utils.book_new();
  const fileName = buildFileName("xlsx", scope, email, bundle.metadata.exportedAt);

  const metadataRows = [
    {
      versao: bundle.metadata.version,
      data_exportacao: formatDateTime(bundle.metadata.exportedAt),
      usuario_id: bundle.metadata.user.id,
      usuario_email: bundle.metadata.user.email ?? "",
      escopo: bundle.metadata.scope,
    },
  ];

  utils.book_append_sheet(workbook, utils.json_to_sheet(metadataRows), "Metadata");

  const modulesToExport = scope === "all" ? exportModuleOptions.map((option) => option.value) : [scope];

  for (const moduleName of modulesToExport) {
    const rows = normalizeRowsForSheet(moduleName, bundle.modules[moduleName], bundle.metadata.exportedAt);
    const sheet = utils.json_to_sheet(rows);
    utils.book_append_sheet(workbook, sheet, moduleSheetNames[moduleName]);
  }

  writeFileXLSX(workbook, fileName);
  saveLastExportSummary(userId, {
    fileName,
    format: "xlsx",
    scope,
    exportedAt: bundle.metadata.exportedAt,
    user: bundle.metadata.user,
  });
}

export function loadLastExportSummary(userId: string | null) {
  if (typeof window === "undefined" || !userId) return null;

  try {
    const raw = window.localStorage.getItem(buildLastExportKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastExportSummary;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    console.error("Erro técnico ao carregar último backup/exportação:", error);
    return null;
  }
}

function emptyModules(): Record<ExportModule, unknown[]> {
  return {
    accounts_payable: [],
    income_sources: [],
    people: [],
    categories: [],
    credit_cards: [],
    credit_card_invoices: [],
    credit_card_transactions: [],
    reimbursements: [],
    installments: [],
    planned_purchases: [],
    goals: [],
    archived: [],
    imports: [],
  };
}

function buildImportsExportRows(batches: ImportBatch[], rows: ImportRow[]) {
  const batchesById = new Map(batches.map((batch) => [batch.id, batch]));

  return rows.map((row) => {
    const batch = batchesById.get(row.import_batch_id);
    return {
      lote_id: row.import_batch_id,
      arquivo: batch?.file_name ?? "",
      modulo: batch?.target_type ?? batch?.module ?? "",
      status_lote: batch?.status ?? "",
      linha: row.row_number,
      status_linha: row.status,
      target_entity_type: row.target_entity_type,
      target_entity_id: row.target_entity_id,
      raw_data: stringifyJson(row.raw_data),
      mapped_data: stringifyJson(row.mapped_data),
      errors: stringifyJson(row.errors),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  });
}

function buildArchivedRows({
  accounts,
  income,
  invoices,
  transactions,
  reimbursements,
  purchases,
  goals,
}: {
  accounts: AccountPayable[];
  income: IncomeSource[];
  invoices: CreditCardInvoice[];
  transactions: CreditCardTransaction[];
  reimbursements: Reimbursement[];
  purchases: PlannedPurchase[];
  goals: Goal[];
}): ArchivedRow[] {
  return [
    ...accounts.map((row) => toArchivedRow("accounts_payable", row.id, row.title, row.archived_at, row.archive_reason, row)),
    ...income.map((row) => toArchivedRow("income_sources", row.id, row.name, row.archived_at, row.archive_reason, row)),
    ...invoices.map((row) => toArchivedRow("credit_card_invoices", row.id, row.reference_month, row.archived_at, row.archive_reason, row)),
    ...transactions.map((row) => toArchivedRow("credit_card_transactions", row.id, row.description, row.archived_at, row.archive_reason, row)),
    ...reimbursements.map((row) => toArchivedRow("reimbursements", row.id, row.description ?? "Sem descrição", row.archived_at, row.archive_reason, row)),
    ...purchases.map((row) => toArchivedRow("planned_purchases", row.id, row.title, row.archived_at, row.archive_reason, row)),
    ...goals.map((row) => toArchivedRow("goals", row.id, row.name, row.archived_at, row.archive_reason, row)),
  ].sort((left, right) => (left.archived_at ?? "").localeCompare(right.archived_at ?? ""));
}

function toArchivedRow(
  module: string,
  id: string,
  title: string,
  archivedAt: string | null,
  archiveReason: string | null,
  raw: Json,
): ArchivedRow {
  return {
    module,
    id,
    title,
    archived_at: archivedAt,
    archive_reason: archiveReason,
    raw,
  };
}

function normalizeRowsForSheet(moduleName: ExportModule, rows: unknown[], exportedAt: string) {
  return rows.map((row) => {
    const record = row as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(record)) {
      normalized[humanizeKey(key)] = normalizeCellValue(key, value);
    }

    normalized.exportado_em = formatDateTime(exportedAt);
    normalized.modulo = exportModuleOptions.find((option) => option.value === moduleName)?.label ?? moduleName;
    return normalized;
  });
}

function normalizeCellValue(key: string, value: unknown) {
  if (value === null || typeof value === "undefined") return "";
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value) || (typeof value === "object" && value !== null)) return stringifyJson(value as Json);
  if (typeof value === "string" && isDateValue(key, value)) {
    return formatDate(value);
  }
  return value;
}

function buildFileName(
  extension: "xlsx" | "json",
  scope: "all" | ExportModule,
  email: string | null,
  exportedAt: string,
) {
  const date = exportedAt.slice(0, 10);
  const suffix = scope === "all" ? "" : `-${scope}`;
  const userSuffix = scope === "all" ? "" : sanitizeFileNamePart(email ?? "");
  const specificSuffix = userSuffix ? `${suffix}-${userSuffix}` : suffix;
  return `hub-vz-backup${specificSuffix}-${date}.${extension}`;
}

function downloadBlob(content: string, fileName: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function saveLastExportSummary(userId: string, summary: LastExportSummary) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(buildLastExportKey(userId), JSON.stringify(summary));
  } catch (error) {
    console.error("Erro técnico ao salvar último backup/exportação:", error);
  }
}

function buildLastExportKey(userId: string) {
  return `${lastExportStoragePrefix}:${userId}`;
}

function sanitizeFileNamePart(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function humanizeKey(value: string) {
  return value;
}

function isDateValue(key: string, value: string) {
  return /date|_at|month/i.test(key) && /^\d{4}-\d{2}-\d{2}/.test(value);
}

function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return new Intl.DateTimeFormat("pt-BR").format(date);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function stringifyJson(value: Json | null | undefined) {
  if (value === null || typeof value === "undefined") return "";
  return JSON.stringify(value);
}
