import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";
import xlsx from "xlsx";

const DEFAULT_FILE_NAME = "lista_compras_organizada.xlsx";
const BASE_SHEET = "Base_Consolidada";
const BOARD_GAMES_SHEET = "BoardGames";
const GOALS_SHEET = "Metas";

const args = parseArgs(process.argv.slice(2));
const filePath = resolveFilePath(args.get("file") ?? DEFAULT_FILE_NAME);
const confirmImport = args.has("confirm");
const confirmDelete = args.has("confirm-delete");
const createMissingCategories = args.has("create-categories");
const offlinePreview = args.has("offline-preview");
const reviewImportSource = args.get("review-import-source");
const deleteImportSource = args.get("delete-import-source");

loadEnvFile(".env.local");
loadEnvFile(".env");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const accessToken = process.env.SUPABASE_IMPORT_ACCESS_TOKEN;
let userId = process.env.SUPABASE_IMPORT_USER_ID;

if (!offlinePreview && !hasDatabaseCredentials()) {
  fail([
    "Variáveis obrigatórias ausentes.",
    "Opção 1: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e SUPABASE_IMPORT_USER_ID.",
    "Opção 2: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY e SUPABASE_IMPORT_ACCESS_TOKEN.",
    "A service role key deve ser usada somente localmente neste script.",
  ].join("\n"));
}

const supabase = offlinePreview
  ? null
  : createClient(supabaseUrl, serviceRoleKey ?? supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
    });

if (!offlinePreview && !serviceRoleKey) {
  const authUserResult = await supabase.auth.getUser(accessToken);
  if (authUserResult.error || !authUserResult.data.user) {
    fail(`Falha ao validar SUPABASE_IMPORT_ACCESS_TOKEN: ${authUserResult.error?.message ?? "usuário não encontrado"}`);
  }
  userId = authUserResult.data.user.id;
}

if (reviewImportSource || deleteImportSource) {
  await reviewOrDeleteImportSource(reviewImportSource ?? deleteImportSource, Boolean(deleteImportSource));
  process.exit(0);
}

if (!fs.existsSync(filePath)) {
  fail(`Arquivo não encontrado: ${filePath}`);
}

const workbook = xlsx.readFile(filePath, { cellDates: true });
const existing = offlinePreview ? emptyExistingData() : await loadExistingData();
const prepared = await prepareWorkbook(workbook, existing);

printPreview(prepared);

if (offlinePreview) {
  console.log("\nPrévia offline concluída. Nada foi gravado.");
  process.exit(0);
}

if (!confirmImport) {
  console.log("\nPrévia concluída. Nada foi gravado.");
  console.log("Para importar, rode novamente com --confirm.");
  process.exit(0);
}

await insertPrepared(prepared);

function parseArgs(argv) {
  const parsed = new Map();
  for (const arg of argv) {
    if (arg.startsWith("--file=")) parsed.set("file", arg.slice("--file=".length));
    else if (arg.startsWith("--review-import-source=")) parsed.set("review-import-source", arg.slice("--review-import-source=".length));
    else if (arg.startsWith("--delete-import-source=")) parsed.set("delete-import-source", arg.slice("--delete-import-source=".length));
    else if (arg.startsWith("--")) parsed.set(arg.slice(2), "true");
  }
  return parsed;
}

function hasDatabaseCredentials() {
  if (!supabaseUrl) return false;
  if (serviceRoleKey && userId) return true;
  return Boolean(supabaseAnonKey && accessToken);
}

function resolveFilePath(input) {
  return path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
}

function loadEnvFile(fileName) {
  const envPath = path.resolve(process.cwd(), fileName);
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function emptyExistingData() {
  return { purchases: [], goals: [], categories: [] };
}

async function loadExistingData() {
  const [purchaseResult, goalResult, categoryResult] = await Promise.all([
    supabase.from("planned_purchases").select("id,title,external_url,import_source").eq("user_id", userId),
    supabase.from("goals").select("id,name,import_source").eq("user_id", userId),
    supabase.from("categories").select("id,name,type").eq("user_id", userId),
  ]);

  if (purchaseResult.error) fail(`Falha ao consultar compras: ${purchaseResult.error.message}`);
  if (goalResult.error) fail(`Falha ao consultar metas: ${goalResult.error.message}`);
  if (categoryResult.error) fail(`Falha ao consultar categorias: ${categoryResult.error.message}`);

  return {
    purchases: purchaseResult.data ?? [],
    goals: goalResult.data ?? [],
    categories: categoryResult.data ?? [],
  };
}

async function prepareWorkbook(workbook, existing) {
  const prepared = { purchases: [], goals: [], createdCategories: new Set(), missingCategories: new Set() };
  const categoriesByName = new Map(existing.categories.map((category) => [normalizeKey(category.name), category]));

  if (workbook.SheetNames.includes(BASE_SHEET)) {
    const rows = sheetToRows(workbook, BASE_SHEET);
    prepared.purchases.push(...(await preparePurchaseRows(rows, existing, categoriesByName, prepared, "Compras")));
  }

  if (workbook.SheetNames.includes(BOARD_GAMES_SHEET)) {
    const rows = sheetToRows(workbook, BOARD_GAMES_SHEET);
    prepared.purchases.push(...(await preparePurchaseRows(rows, existing, categoriesByName, prepared, "Board Games", "Board Games")));
  }

  if (workbook.SheetNames.includes(GOALS_SHEET)) {
    const rows = sheetToRows(workbook, GOALS_SHEET);
    prepared.goals.push(...prepareGoalRows(rows, existing));
  }

  if (prepared.purchases.length === 0 && prepared.goals.length === 0) {
    fail(`Nenhuma linha encontrada nas abas ${BASE_SHEET}, ${BOARD_GAMES_SHEET} ou ${GOALS_SHEET}.`);
  }

  return prepared;
}

function sheetToRows(workbook, sheetName) {
  return xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: true }).map((raw, index) => ({
    raw,
    rowNumber: index + 2,
    sheetName,
  }));
}

async function preparePurchaseRows(rows, existing, categoriesByName, prepared, defaultProject, forcedProject = null) {
  const existingTitles = new Set(existing.purchases.map((item) => normalizeKey(item.title)));
  const existingUrls = new Set(existing.purchases.map((item) => normalizeUrl(item.external_url)).filter(Boolean));
  const seenPairs = new Set();

  const output = [];
  for (const row of rows) {
    const mapped = mapPurchase(row, defaultProject, forcedProject);
    const errors = [];
    if (!mapped.title) errors.push("Item sem nome.");
    if (mapped.estimated_amount < 0) errors.push("Valor atual inválido.");

    const titleKey = normalizeKey(mapped.title);
    const urlKey = normalizeUrl(mapped.external_url);
    const pairKey = `${titleKey}::${urlKey || "sem-link"}`;
    if (titleKey && existingTitles.has(titleKey)) errors.push("Compra já existe com o mesmo nome.");
    if (urlKey && existingUrls.has(urlKey)) errors.push("Compra já existe com o mesmo Link Notion.");
    if (seenPairs.has(pairKey)) errors.push("Compra duplicada na planilha pelo mesmo nome e Link Notion.");

    let category_id = null;
    if (mapped.categoryName) {
      const categoryKey = normalizeKey(mapped.categoryName);
      let category = categoriesByName.get(categoryKey);
      if (!category && createMissingCategories && !offlinePreview) {
        category = await createCategory(mapped.categoryName);
        categoriesByName.set(categoryKey, category);
        prepared.createdCategories.add(mapped.categoryName);
      }
      if (category) category_id = category.id;
      else prepared.missingCategories.add(mapped.categoryName);
    }

    seenPairs.add(pairKey);
    output.push({
      module: "Compras",
      row,
      mapped,
      status: errors.length ? "error" : "new",
      errors,
      payload: { ...mapped, category_id, user_id: userId },
    });
  }
  return output;
}

function prepareGoalRows(rows, existing) {
  const existingNames = new Set(existing.goals.map((item) => normalizeKey(item.name)));
  const seenNames = new Set();

  return rows.map((row) => {
    const mapped = mapGoal(row);
    const nameKey = normalizeKey(mapped.name);
    const errors = [];
    if (!mapped.name) errors.push("Meta sem nome.");
    if (nameKey && existingNames.has(nameKey)) errors.push("Meta já existe com o mesmo nome.");
    if (nameKey && seenNames.has(nameKey)) errors.push("Meta duplicada na planilha.");
    if (nameKey) seenNames.add(nameKey);

    return {
      module: "Metas",
      row,
      mapped,
      status: errors.length ? "error" : "new",
      errors,
      payload: { ...mapped, user_id: userId },
    };
  });
}

function mapPurchase(row, defaultProject, forcedProject) {
  const raw = row.raw;
  const title = text(raw.Item);
  const quantity = numberOrNull(raw.Qtd);
  const status = truthy(raw["Comprado?"]) ? "purchased" : statusFromDecision(raw["Decisão sugerida"]);
  const description = [text(raw.Observações), text(raw["Decisão sugerida"]) ? `Decisão: ${text(raw["Decisão sugerida"])}` : ""]
    .filter(Boolean)
    .join("\n");
  return {
    categoryName: text(raw["Categoria final sugerida"]),
    title,
    description,
    estimated_amount: Math.max(numberOrNull(raw["Valor atual"]) ?? 0, 0),
    payment_method: "unknown",
    installment_count: null,
    priority: priorityFromDecision(raw["Decisão sugerida"], raw.Rank),
    priority_rank: numberOrNull(raw.Rank),
    decision_status: status,
    desired_date: null,
    target_date: dateOrNull(raw.Data),
    project: forcedProject ?? text(raw.Projeto) ?? defaultProject,
    quantity,
    external_url: text(raw["Link Notion"]) || null,
    decision_label: text(raw["Decisão sugerida"]) || null,
    import_source: `xlsx:${path.basename(filePath)}:${row.sheetName}`,
    notes: description || null,
  };
}

function mapGoal(row) {
  const raw = row.raw;
  const section = text(raw["Seção"]);
  const source = text(raw.Origem);
  const nextAction = text(raw["Próxima ação"]);
  const notes = [
    source ? `Origem: ${source}` : "",
    section ? `Área: ${section}` : "",
    nextAction ? `Próxima ação: ${nextAction}` : "",
  ].filter(Boolean).join("\n");

  return {
    name: text(raw.Meta),
    goal_type: normalizeGoalType(section),
    target_amount: 100,
    current_amount: Math.max(numberOrNull(raw["Cumprido atual"]) ?? 0, 0),
    target_date: dateOrNull(raw.Final),
    start_date: dateOrNull(raw["Início"]),
    monthly_contribution: 0,
    status: goalStatus(raw["Status manual"] || raw["Status original"]),
    category_label: section || null,
    source_label: source || null,
    import_source: `xlsx:${path.basename(filePath)}:${row.sheetName}`,
    notes: notes || null,
  };
}

async function createCategory(name) {
  const { data, error } = await supabase
    .from("categories")
    .insert({ user_id: userId, name, type: "purchase", color: "#18b98f", icon: "shopping-bag", is_default: false, is_active: true })
    .select("id,name,type")
    .single();
  if (error) fail(`Falha ao criar categoria ${name}: ${error.message}`);
  return data;
}

async function insertPrepared(prepared) {
  const purchaseRows = prepared.purchases.filter((row) => row.status === "new");
  const goalRows = prepared.goals.filter((row) => row.status === "new");

  if (purchaseRows.length) {
    const { error } = await supabase.from("planned_purchases").insert(purchaseRows.map((row) => row.payload));
    if (error) fail(`Falha ao importar compras: ${error.message}`);
  }
  if (goalRows.length) {
    const { error } = await supabase.from("goals").insert(goalRows.map((row) => row.payload));
    if (error) fail(`Falha ao importar metas: ${error.message}`);
  }

  console.log(`\nImportação concluída. Compras: ${purchaseRows.length}. Metas: ${goalRows.length}.`);
}

async function reviewOrDeleteImportSource(importSource, shouldDelete) {
  if (!importSource) fail("Informe o import_source.");
  const [purchaseResult, goalResult] = await Promise.all([
    supabase.from("planned_purchases").select("id,title,import_source").eq("user_id", userId).eq("import_source", importSource),
    supabase.from("goals").select("id,name,import_source").eq("user_id", userId).eq("import_source", importSource),
  ]);
  if (purchaseResult.error) fail(`Falha ao revisar compras: ${purchaseResult.error.message}`);
  if (goalResult.error) fail(`Falha ao revisar metas: ${goalResult.error.message}`);

  console.log(`Compras encontradas: ${purchaseResult.data?.length ?? 0}`);
  console.table((purchaseResult.data ?? []).slice(0, 20).map((item) => ({ id: item.id, titulo: item.title })));
  console.log(`Metas encontradas: ${goalResult.data?.length ?? 0}`);
  console.table((goalResult.data ?? []).slice(0, 20).map((item) => ({ id: item.id, nome: item.name })));

  if (!shouldDelete) return;
  if (!confirmDelete) fail("Remoção bloqueada. Rode com --confirm-delete para excluir apenas esse import_source.");

  const [purchaseDelete, goalDelete] = await Promise.all([
    supabase.from("planned_purchases").delete().eq("user_id", userId).eq("import_source", importSource),
    supabase.from("goals").delete().eq("user_id", userId).eq("import_source", importSource),
  ]);
  if (purchaseDelete.error) fail(`Falha ao remover compras: ${purchaseDelete.error.message}`);
  if (goalDelete.error) fail(`Falha ao remover metas: ${goalDelete.error.message}`);
  console.log("Remoção concluída para o import_source informado.");
}

function printPreview(prepared) {
  const all = [...prepared.purchases, ...prepared.goals];
  const errors = all.filter((row) => row.status === "error");
  const newRows = all.filter((row) => row.status === "new");
  console.log("Prévia da importação");
  console.log(`Total lido: ${all.length}`);
  console.log(`Novos: ${newRows.length}`);
  console.log(`Com erro/duplicidade: ${errors.length}`);
  console.log(`Categorias criadas: ${prepared.createdCategories.size}`);
  console.log(`Categorias não encontradas: ${prepared.missingCategories.size}`);
  if (prepared.missingCategories.size) console.log([...prepared.missingCategories].join(", "));
  console.table(all.slice(0, 20).map((row) => ({
    modulo: row.module,
    aba: row.row.sheetName,
    linha: row.row.rowNumber,
    nome: row.mapped.title ?? row.mapped.name,
    status: row.status,
    erros: row.errors.join("; "),
  })));
}

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).replace(/[R$\s.]/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateOrNull(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function truthy(value) {
  return ["sim", "ok", "comprado", "true", "1", "x"].includes(text(value).toLowerCase());
}

function normalizeKey(value) {
  return text(value).toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();
}

function normalizeUrl(value) {
  return text(value).toLowerCase().replace(/\/$/, "");
}

function statusFromDecision(value) {
  const decision = normalizeKey(value);
  if (decision.includes("promocao")) return "promotion";
  if (decision.includes("esperar")) return "waiting";
  if (decision.includes("revisar")) return "review";
  return "pending";
}

function priorityFromDecision(decisionValue, rankValue) {
  const decision = normalizeKey(decisionValue);
  const rank = numberOrNull(rankValue);
  if (decision.includes("priorizar") || (rank !== null && rank <= 10)) return "high";
  if (decision.includes("esperar")) return "low";
  return "medium";
}

function normalizeGoalType(section) {
  const key = normalizeKey(section).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return key || "personal";
}

function goalStatus(value) {
  const status = normalizeKey(value);
  if (status.includes("concl") || status.includes("feito") || status.includes("cumpr")) return "completed";
  if (status.includes("paus")) return "paused";
  if (status.includes("cancel")) return "cancelled";
  return "active";
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
