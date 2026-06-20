import { utils, writeFileXLSX } from "xlsx";

import { safeLogAction } from "@/features/audit/logger";
import { buildFinancialDiagnosticsFromSource, loadFinancialDiagnosticsSourceData } from "@/features/diagnostics/queries";
import type { AppSupabaseClient } from "@/features/shared/types";
import type {
  AuditLog,
  ImportBatch,
  ImportRow,
  Json,
  RoutineAiSummary,
  RoutineCategory,
  RoutineSyncRun,
  RoutineTask,
  RoutineTaskEvent,
  RoutineTaskList,
  RoutineTaskSnapshot,
  RoutineWeeklyReport,
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
  | "weekly_review"
  | "history"
  | "diagnostics"
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

type SafeRoutineConnectionRow = {
  id: string;
  user_id: string;
  provider: string;
  status: string;
  scope: string;
  token_expires_at: string | null;
  connected_at: string | null;
  last_sync_at: string | null;
  last_sync_attempt_at: string | null;
  last_successful_sync_at: string | null;
  last_sync_error: string | null;
  auto_sync_enabled: boolean;
  created_at: string;
  updated_at: string;
};

const appVersion = "0.1.0";
const lastExportStoragePrefix = "hubvz:last-export";

export type LastExportSummary = {
  fileName: string;
  format: "xlsx" | "json";
  scope: "all" | ExportModule;
  exportedAt: string;
  modulesExported?: string[];
  rowsExported?: number;
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
  { value: "weekly_review", label: "Revisão semanal" },
  { value: "history", label: "Histórico" },
  { value: "diagnostics", label: "Diagnóstico" },
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
  weekly_review: "Revisao semanal",
  history: "Historico",
  diagnostics: "Diagnostico",
  imports: "Importacoes",
};

const keyLabels: Record<string, string> = {
  id: "ID",
  user_id: "Usuário ID",
  created_at: "Criado em",
  updated_at: "Atualizado em",
  archived_at: "Arquivado em",
  archived: "Arquivado",
  archive_reason: "Motivo do arquivamento",
  status: "Status",
  title: "Título",
  name: "Nome",
  description: "Descrição",
  notes: "Observações",
  amount: "Valor",
  total_amount: "Valor total",
  expected_amount: "Valor esperado",
  received_amount: "Valor recebido",
  paid_amount: "Valor pago",
  target_date: "Data alvo",
  expected_date: "Data prevista",
  received_date: "Data recebida",
  due_date: "Vencimento",
  reference_month: "Mês de referência",
  transaction_date: "Data da compra",
  completed_at: "Concluído em",
  week_start: "Início da semana",
  week_end: "Fim da semana",
  week_start_date: "Início da semana",
  week_end_date: "Fim da semana",
  generated_at: "Gerado em",
  exported_at: "Exportado em",
  exported_em: "Exportado em",
  modulo: "Módulo",
  module: "Módulo",
  scope: "Escopo",
  type: "Tipo",
  category_id: "Categoria ID",
  person_id: "Pessoa ID",
  credit_card_id: "Cartão ID",
  invoice_id: "Fatura ID",
  import_batch_id: "Lote de importação",
  row_number: "Linha",
  file_name: "Arquivo",
  error_message: "Erro",
  action: "Ação",
  field_name: "Campo",
  old_value: "Valor anterior",
  new_value: "Novo valor",
  metadata: "Metadados",
  tipo_registro: "Tipo de registro",
  secao: "Seção",
  resumo: "Resumo",
  detalhes: "Detalhes",
  referencias: "Referências",
  origem: "Origem",
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
    auditLogsResult,
    routineConnectionsResult,
    routineCategoriesResult,
    routineTaskListsResult,
    routineTasksResult,
    routineTaskSnapshotsResult,
    routineTaskEventsResult,
    routineWeeklyReportsResult,
    routineAiSummariesResult,
    routineSyncRunsResult,
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
    client
      .from("import_rows")
      .select("*")
      .eq("user_id", userId)
      .order("import_batch_id", { ascending: false })
      .order("row_number", { ascending: true }),
    client.from("audit_logs").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    client
      .from("routine_google_connections")
      .select(
        "id,user_id,provider,status,scope,token_expires_at,connected_at,last_sync_at,last_sync_attempt_at,last_successful_sync_at,last_sync_error,auto_sync_enabled,created_at,updated_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    client.from("routine_categories").select("*").eq("user_id", userId).order("name", { ascending: true }),
    client
      .from("routine_task_lists")
      .select("id,user_id,google_task_list_id,title,is_priority_queue,updated_at_google,last_seen_at,created_at,updated_at")
      .eq("user_id", userId)
      .order("title", { ascending: true }),
    client
      .from("routine_tasks")
      .select(
        "id,user_id,google_task_id,google_task_list_id,routine_task_list_id,title,notes,status,due_date,completed_at,updated_at_google,last_seen_at,detected_category_id,confirmed_category_id,parent_google_task_id,position,is_hidden,created_at,updated_at",
      )
      .eq("user_id", userId)
      .order("updated_at", { ascending: false }),
    client
      .from("routine_task_snapshots")
      .select("id,user_id,routine_task_id,google_task_id,google_task_list_id,title,notes,status,due_date,completed_at,detected_category_id,confirmed_category_id,snapshot_at")
      .eq("user_id", userId)
      .order("snapshot_at", { ascending: false }),
    client.from("routine_task_events").select("*").eq("user_id", userId).order("event_at", { ascending: false }),
    client.from("routine_weekly_reports").select("*").eq("user_id", userId).order("week_start_date", { ascending: false }),
    client.from("routine_ai_summaries").select("*").eq("user_id", userId).order("week_start", { ascending: false }),
    client.from("routine_sync_runs").select("*").eq("user_id", userId).order("started_at", { ascending: false }),
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
    auditLogsResult.error ??
    routineConnectionsResult.error ??
    routineCategoriesResult.error ??
    routineTaskListsResult.error ??
    routineTasksResult.error ??
    routineTaskSnapshotsResult.error ??
    routineTaskEventsResult.error ??
    routineWeeklyReportsResult.error ??
    routineAiSummariesResult.error ??
    routineSyncRunsResult.error;

  if (error) {
    console.error("Erro técnico ao carregar dados para exportação:", error);
    throw new Error("Não foi possível carregar os dados para exportação.");
  }

  const importsRows = buildImportsExportRows(importBatchesResult.data ?? [], importRowsResult.data ?? []);
  const historyRows = buildHistoryExportRows(auditLogsResult.data ?? []);
  const weeklyReviewRows = buildWeeklyReviewExportRows({
    connections: (routineConnectionsResult.data ?? []) as SafeRoutineConnectionRow[],
    categories: (routineCategoriesResult.data ?? []) as RoutineCategory[],
    taskLists: (routineTaskListsResult.data ?? []) as RoutineTaskList[],
    tasks: (routineTasksResult.data ?? []) as RoutineTask[],
    taskSnapshots: (routineTaskSnapshotsResult.data ?? []) as RoutineTaskSnapshot[],
    taskEvents: (routineTaskEventsResult.data ?? []) as RoutineTaskEvent[],
    weeklyReports: (routineWeeklyReportsResult.data ?? []) as RoutineWeeklyReport[],
    aiSummaries: (routineAiSummariesResult.data ?? []) as RoutineAiSummary[],
    syncRuns: (routineSyncRunsResult.data ?? []) as RoutineSyncRun[],
  });

  const diagnosticsSourceResult = await loadFinancialDiagnosticsSourceData(client, userId);
  if (diagnosticsSourceResult.error || !diagnosticsSourceResult.data) {
    console.error("Erro técnico ao carregar diagnóstico para exportação:", diagnosticsSourceResult.error);
    throw new Error("Não foi possível preparar o diagnóstico para exportação.");
  }
  const diagnosticsRows = buildDiagnosticsExportRows(buildFinancialDiagnosticsFromSource(diagnosticsSourceResult.data));

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
    weekly_review: weeklyReviewRows,
    history: historyRows,
    diagnostics: diagnosticsRows,
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
  const fileName = buildFileName("json", scope, bundle.metadata.exportedAt);
  const modulesExported = getExportedModules(bundle.metadata.scope);
  const payload = {
    metadata: {
      data_exportacao: bundle.metadata.exportedAt,
      arquivo: fileName,
      usuario: bundle.metadata.user,
      versao: bundle.metadata.version,
      escopo: bundle.metadata.scope,
      modulos_exportados: modulesExported,
      total_modulos: modulesExported.length,
    },
    data_exportacao: bundle.metadata.exportedAt,
    usuario: bundle.metadata.user,
    versao: bundle.metadata.version,
    modulos: bundle.modules,
  };

  downloadBlob(JSON.stringify(payload, null, 2), fileName, "application/json;charset=utf-8");
  saveLastExportSummary(userId, {
    fileName,
    format: "json",
    scope,
    exportedAt: bundle.metadata.exportedAt,
    modulesExported,
    rowsExported: countExportedRows(bundle),
    user: bundle.metadata.user,
  });
  await logBackupExport(client, userId, scope, "json", fileName, bundle);
}

export async function exportBundleAsXlsx(
  client: AppSupabaseClient,
  userId: string,
  email: string | null,
  scope: "all" | ExportModule,
) {
  const bundle = await fetchExportBundle(client, userId, email, scope);
  const workbook = utils.book_new();
  const fileName = buildFileName("xlsx", scope, bundle.metadata.exportedAt);
  const modulesExported = getExportedModules(bundle.metadata.scope);

  const metadataRows = [
    {
      versao: bundle.metadata.version,
      data_exportacao: formatDateTime(bundle.metadata.exportedAt),
      arquivo: fileName,
      usuario_id: bundle.metadata.user.id,
      usuario_email: bundle.metadata.user.email ?? "",
      escopo: bundle.metadata.scope,
      modulos_exportados: modulesExported.join(", "),
      total_modulos: modulesExported.length,
      total_registros: countExportedRows(bundle),
    },
  ];

  utils.book_append_sheet(workbook, utils.json_to_sheet(metadataRows), "Metadata");

  const modulesToExport = scope === "all" ? exportModuleOptions.map((option) => option.value) : [scope];

  for (const moduleName of modulesToExport) {
    const rows = normalizeRowsForSheet(moduleName, bundle.modules[moduleName], bundle.metadata.exportedAt);
    const sheet = utils.json_to_sheet(rows.length > 0 ? rows : [{ modulo: exportModuleOptions.find((option) => option.value === moduleName)?.label ?? moduleName }]);
    utils.book_append_sheet(workbook, sheet, moduleSheetNames[moduleName]);
  }

  writeFileXLSX(workbook, fileName);
  saveLastExportSummary(userId, {
    fileName,
    format: "xlsx",
    scope,
    exportedAt: bundle.metadata.exportedAt,
    modulesExported,
    rowsExported: countExportedRows(bundle),
    user: bundle.metadata.user,
  });
  await logBackupExport(client, userId, scope, "xlsx", fileName, bundle);
}

export async function loadLatestBackupExportSummary(client: AppSupabaseClient, userId: string) {
  const result = await client
    .from("audit_logs")
    .select("user_id,new_value,metadata,created_at")
    .eq("user_id", userId)
    .eq("module", "settings")
    .eq("action", "backup_exported")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error) {
    console.error("Erro técnico ao carregar último backup/exportação pelo histórico:", result.error);
    return null;
  }

  return parseBackupAuditSummary(result.data);
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
    weekly_review: [],
    history: [],
    diagnostics: [],
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

function buildHistoryExportRows(logs: AuditLog[]) {
  return logs.map((log) => ({
    id: log.id,
    user_id: log.user_id,
    module: log.module,
    record_id: log.record_id,
    action: log.action,
    field_name: log.field_name,
    old_value: stringifyJson(log.old_value),
    new_value: stringifyJson(log.new_value),
    metadata: stringifyJson(log.metadata),
    created_at: log.created_at,
  }));
}

function buildWeeklyReviewExportRows({
  connections,
  categories,
  taskLists,
  tasks,
  taskSnapshots,
  taskEvents,
  weeklyReports,
  aiSummaries,
  syncRuns,
}: {
  connections: SafeRoutineConnectionRow[];
  categories: RoutineCategory[];
  taskLists: RoutineTaskList[];
  tasks: RoutineTask[];
  taskSnapshots: RoutineTaskSnapshot[];
  taskEvents: RoutineTaskEvent[];
  weeklyReports: RoutineWeeklyReport[];
  aiSummaries: RoutineAiSummary[];
  syncRuns: RoutineSyncRun[];
}) {
  return [
    ...connections.map((row) => ({ tipo_registro: "conexao_google", ...row })),
    ...categories.map((row) => ({ tipo_registro: "categoria_rotina", ...row })),
    ...taskLists.map((row) => ({ tipo_registro: "lista_tarefas", ...row })),
    ...tasks.map((row) => ({ tipo_registro: "tarefa", ...row })),
    ...taskSnapshots.map((row) => ({ tipo_registro: "snapshot_tarefa", ...row })),
    ...taskEvents.map((row) => ({
      tipo_registro: "evento_tarefa",
      ...row,
      previous_value: stringifyJson(row.previous_value),
      new_value: stringifyJson(row.new_value),
      metadata: stringifyJson(row.metadata),
    })),
    ...weeklyReports.map((row) => ({
      tipo_registro: "relatorio_semanal",
      ...row,
      summary_json: stringifyJson(row.summary_json),
    })),
    ...aiSummaries.map((row) => ({
      tipo_registro: "analise_ia",
      ...row,
      input_summary_json: stringifyJson(row.input_summary_json),
    })),
    ...syncRuns.map((row) => ({ tipo_registro: "sync_run", ...row })),
  ];
}

function buildDiagnosticsExportRows(diagnostics: ReturnType<typeof buildFinancialDiagnosticsFromSource>) {
  const summaryRow = {
    tipo_registro: "resumo_diagnostico",
    gerado_em: diagnostics.generatedAt,
    total_alertas: diagnostics.totalAlerts,
    total_ignorados: diagnostics.totalIgnored,
    secoes: diagnostics.sections.length,
  };

  const sectionRows = diagnostics.sections.flatMap((section) => {
    const sectionSummary = {
      tipo_registro: "secao_diagnostico",
      secao: section.title,
      descricao_secao: section.description,
      alertas_na_secao: section.count,
      alertas_ignorados_na_secao: section.ignoredCount,
    };

    const items = section.items.map((item) => ({
      tipo_registro: "alerta_diagnostico",
      secao: section.title,
      alert_key: item.alertKey,
      alert_type: item.alertType,
      subject_type: item.subjectType,
      subject_id: item.subjectId,
      title: item.title,
      description: item.description,
      detalhes: item.details.join(" | "),
      referencias: stringifyJson(item.references as unknown as Json),
      actions: item.actions.join(", "),
    }));

    return [sectionSummary, ...items];
  });

  return [summaryRow, ...sectionRows];
}

function normalizeRowsForSheet(moduleName: ExportModule, rows: unknown[], exportedAt: string) {
  return rows.map((row) => {
    const record = row as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(record)) {
      normalized[humanizeKey(key)] = normalizeCellValue(key, value);
    }

    normalized[humanizeKey("exported_em")] = formatDateTime(exportedAt);
    normalized[humanizeKey("modulo")] = exportModuleOptions.find((option) => option.value === moduleName)?.label ?? moduleName;
    return normalized;
  });
}

function normalizeCellValue(key: string, value: unknown) {
  if (value === null || typeof value === "undefined") return "";
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value) || (typeof value === "object" && value !== null)) return stringifyJson(value as Json);
  if (typeof value === "string" && isDateValue(key, value)) {
    return formatDateLikeValue(value);
  }
  return value;
}

function buildFileName(extension: "xlsx" | "json", scope: "all" | ExportModule, exportedAt: string) {
  const date = exportedAt.slice(0, 10);
  const suffix = scope === "all" ? "" : `-${sanitizeFileNamePart(scope)}`;
  return `hub-vz-backup${suffix}-${date}.${extension}`;
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

async function logBackupExport(
  client: AppSupabaseClient,
  userId: string,
  scope: "all" | ExportModule,
  format: "xlsx" | "json",
  fileName: string,
  bundle: ExportBundle,
) {
  try {
    const modulesExported = getExportedModules(scope);
    await safeLogAction(client, {
      user_id: userId,
      module: "settings",
      record_id: null,
      action: "backup_exported",
      field_name: null,
      old_value: null,
      new_value: fileName,
      metadata: {
        format,
        scope,
        exported_at: bundle.metadata.exportedAt,
        modules: modulesExported,
        modules_count: modulesExported.length,
        rows_exported_total: countExportedRows(bundle),
        rows_by_module: Object.fromEntries(modulesExported.map((moduleName) => [moduleName, bundle.modules[moduleName]?.length ?? 0])),
      },
    });
  } catch (error) {
    console.error("Erro técnico ao registrar exportação no histórico:", error);
  }
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

function getExportedModules(scope: "all" | ExportModule) {
  return scope === "all" ? exportModuleOptions.map((option) => option.value) : [scope];
}

function countExportedRows(bundle: ExportBundle) {
  return getExportedModules(bundle.metadata.scope).reduce((total, moduleName) => total + (bundle.modules[moduleName]?.length ?? 0), 0);
}

function parseBackupAuditSummary(
  row:
    | {
        user_id: string;
        new_value: Json | null;
        metadata: Json;
        created_at: string;
      }
    | null,
): LastExportSummary | null {
  if (!row) return null;

  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : null;
  const scope = typeof metadata?.scope === "string" && (metadata.scope === "all" || exportModuleOptions.some((option) => option.value === metadata.scope))
    ? (metadata.scope as "all" | ExportModule)
    : "all";
  const format = metadata?.format === "xlsx" || metadata?.format === "json" ? metadata.format : "json";
  const fileName = typeof row.new_value === "string" && row.new_value.trim().length > 0 ? row.new_value : buildFileName(format, scope, row.created_at);
  const modulesExported = Array.isArray(metadata?.modules) ? metadata.modules.filter((value): value is string => typeof value === "string") : undefined;
  const rowsExported = typeof metadata?.rows_exported_total === "number" ? metadata.rows_exported_total : undefined;

  return {
    fileName,
    format,
    scope,
    exportedAt: typeof metadata?.exported_at === "string" ? metadata.exported_at : row.created_at,
    modulesExported,
    rowsExported,
    user: {
      id: row.user_id,
      email: null,
    },
  };
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
  if (keyLabels[value]) return keyLabels[value];

  const base = value
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!base) return value;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function isDateValue(key: string, value: string) {
  return /date|_at|month|week_|_date$/i.test(key) && /^\d{4}-\d{2}-\d{2}/.test(value);
}

function formatDateLikeValue(value: string) {
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return formatDateTime(value);
  }
  if (/^\d{4}-\d{2}$/.test(value)) {
    const date = new Date(`${value}-01T00:00:00`);
    return new Intl.DateTimeFormat("pt-BR", { month: "2-digit", year: "numeric" }).format(date);
  }
  return formatDate(value);
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
