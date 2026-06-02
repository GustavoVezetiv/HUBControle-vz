import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";
import xlsx from "xlsx";

const BASE_SHEET = "Base_Consolidada";
const BOARD_GAMES_SHEET = "BoardGames";
const DEFAULT_FILE_NAME = "lista_compras_organizada.xlsx";

const args = parseArgs(process.argv.slice(2));
const confirmImport = args.has("confirm");
const createMissingCategories = args.has("create-categories");
const includeBoardGames = args.has("include-board-games");
const offlinePreview = args.has("offline-preview");
const filePath = resolveFilePath(args.get("file") ?? DEFAULT_FILE_NAME);

loadEnvFile(".env.local");
loadEnvFile(".env");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const userId = process.env.SUPABASE_IMPORT_USER_ID;

if (!fs.existsSync(filePath)) {
  fail(`Arquivo não encontrado: ${filePath}`);
}

if (!offlinePreview && (!supabaseUrl || !serviceRoleKey || !userId)) {
  fail([
    "Variáveis obrigatórias ausentes.",
    "Defina NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e SUPABASE_IMPORT_USER_ID.",
    "A service role key deve ser usada somente localmente neste script, nunca no frontend/Vercel.",
  ].join("\n"));
}

const supabase = offlinePreview
  ? null
  : createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

const workbook = xlsx.readFile(filePath, { cellDates: true });
const rawRows = readWorkbookRows(workbook);

if (rawRows.length === 0) {
  fail(`Nenhuma linha encontrada na aba ${BASE_SHEET}.`);
}

const existingData = offlinePreview ? { purchases: [], categories: [] } : await loadExistingData();
const prepared = await prepareRows(rawRows, existingData);
const validRows = prepared.rows.filter((row) => row.status === "new");

printPreview(prepared, validRows);

if (offlinePreview) {
  console.log("");
  console.log("Prévia offline concluída. Nenhuma consulta ao Supabase foi feita.");
  console.log("Duplicidades existentes e categorias reais só são validadas sem --offline-preview.");
  process.exit(0);
}

if (!confirmImport) {
  console.log("");
  console.log("Prévia concluída. Nada foi gravado.");
  console.log("Para importar, rode novamente com --confirm.");
  process.exit(0);
}

if (validRows.length === 0) {
  console.log("Nenhuma compra nova válida para importar.");
  process.exit(0);
}

const insertPayload = validRows.map((row) => row.payload);
const { data: inserted, error: insertError } = await supabase
  .from("planned_purchases")
  .insert(insertPayload)
  .select("id,title");

if (insertError) {
  console.error("Erro técnico ao importar compras:", insertError);
  fail(`Falha ao importar compras: ${insertError.message}`);
}

console.log("");
console.log(`Importação concluída. Linhas importadas: ${inserted?.length ?? 0}.`);

function parseArgs(argv) {
  const parsed = new Map();
  for (const arg of argv) {
    if (arg.startsWith("--file=")) {
      parsed.set("file", arg.slice("--file=".length));
      continue;
    }
    if (arg.startsWith("--")) {
      parsed.set(arg.slice(2), "true");
    }
  }
  return parsed;
}

function resolveFilePath(input) {
  return path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
}

function loadEnvFile(fileName) {
  const envPath = path.resolve(process.cwd(), fileName);
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function readWorkbookRows(book) {
  const rows = [];
  if (!book.SheetNames.includes(BASE_SHEET)) {
    fail(`A aba obrigatória não existe: ${BASE_SHEET}`);
  }

  rows.push(...sheetToRows(book, BASE_SHEET, null));

  if (includeBoardGames && book.SheetNames.includes(BOARD_GAMES_SHEET)) {
    rows.push(...sheetToRows(book, BOARD_GAMES_SHEET, "Board Games"));
  }

  return rows;
}

function sheetToRows(book, sheetName, forcedProject) {
  const sheet = book.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: "", raw: true });
  return rows.map((raw, index) => ({
    raw,
    rowNumber: index + 2,
    sheetName,
    forcedProject,
  }));
}

async function loadExistingData() {
  if (!supabase) {
    fail("Cliente Supabase indisponível.");
  }

  const [purchaseResult, categoryResult] = await Promise.all([
    supabase.from("planned_purchases").select("id,title,external_url").eq("user_id", userId),
    supabase.from("categories").select("id,name,type").eq("user_id", userId),
  ]);

  if (purchaseResult.error) {
    fail(`Falha ao consultar compras existentes: ${purchaseResult.error.message}`);
  }
  if (categoryResult.error) {
    fail(`Falha ao consultar categorias existentes: ${categoryResult.error.message}`);
  }

  return {
    purchases: purchaseResult.data ?? [],
    categories: categoryResult.data ?? [],
  };
}

async function prepareRows(rows, existingData) {
  const existingTitleKeys = new Set(existingData.purchases.map((item) => normalizeKey(item.title)));
  const existingUrlKeys = new Set(
    existingData.purchases
      .map((item) => normalizeUrl(item.external_url))
      .filter(Boolean),
  );
  const categoriesByName = new Map(existingData.categories.map((category) => [normalizeKey(category.name), category]));
  const seenTitleKeys = new Set();
  const seenUrlKeys = new Set();
  const missingCategoryNames = new Set();
  const createdCategoryNames = new Set();

  const preparedRows = [];

  for (const row of rows) {
    const mapped = mapRow(row);
    const errors = [];

    if (!mapped.title) errors.push("Item sem nome.");
    if (mapped.estimatedAmount < 0) errors.push("Valor atual inválido.");

    const titleKey = normalizeKey(mapped.title);
    const urlKey = normalizeUrl(mapped.externalUrl);

    if (titleKey && existingTitleKeys.has(titleKey)) errors.push("Compra já existe com o mesmo nome.");
    if (urlKey && existingUrlKeys.has(urlKey)) errors.push("Compra já existe com o mesmo Link Notion.");
    if (titleKey && seenTitleKeys.has(titleKey)) errors.push("Compra duplicada dentro da planilha pelo mesmo nome.");
    if (urlKey && seenUrlKeys.has(urlKey)) errors.push("Compra duplicada dentro da planilha pelo mesmo Link Notion.");

    let categoryId = null;
    if (mapped.categoryName) {
      const categoryKey = normalizeKey(mapped.categoryName);
      let category = categoriesByName.get(categoryKey);

      if (!category && createMissingCategories) {
        category = await createCategory(mapped.categoryName);
        categoriesByName.set(categoryKey, category);
        createdCategoryNames.add(mapped.categoryName);
      }

      if (category) {
        categoryId = category.id;
      } else {
        missingCategoryNames.add(mapped.categoryName);
      }
    }

    if (titleKey) seenTitleKeys.add(titleKey);
    if (urlKey) seenUrlKeys.add(urlKey);

    preparedRows.push({
      ...mapped,
      errors,
      status: errors.length > 0 ? "duplicate_or_invalid" : "new",
      payload: {
        user_id: userId,
        category_id: categoryId,
        title: mapped.title,
        description: mapped.description,
        estimated_amount: mapped.estimatedAmount,
        payment_method: "unknown",
        installment_count: null,
        decision_status: mapped.decisionStatus,
        risk_level: mapped.riskLevel,
        notes: mapped.notes,
        quantity: mapped.quantity,
        priority_rank: mapped.priorityRank,
        project: mapped.project,
        external_url: mapped.externalUrl,
        decision_label: mapped.decisionLabel,
        import_source: `xlsx:${path.basename(filePath)}:${mapped.sheetName}`,
      },
    });
  }

  return { rows: preparedRows, missingCategoryNames, createdCategoryNames };
}

async function createCategory(name) {
  if (!supabase) {
    fail("Cliente Supabase indisponível.");
  }

  const { data, error } = await supabase
    .from("categories")
    .insert({
      user_id: userId,
      name,
      type: "planned_purchase",
      color: "#0f766e",
      icon: "shopping-bag",
      is_active: true,
    })
    .select("id,name,type")
    .single();

  if (error) {
    fail(`Falha ao criar categoria "${name}": ${error.message}`);
  }

  return data;
}

function mapRow(row) {
  const raw = row.raw;
  const title = cleanText(get(raw, "Item"));
  const quantity = parseInteger(get(raw, "Qtd"));
  const estimatedAmount = parseMoney(get(raw, "Valor atual"));
  const priorityRank = parseInteger(get(raw, "Rank"));
  const bought = isPositive(get(raw, "Comprado?"));
  const categoryName = cleanText(get(raw, "Categoria final sugerida"));
  const project = row.forcedProject ?? cleanText(get(raw, "Projeto")) ?? null;
  const decisionLabel = cleanText(get(raw, "Decisão sugerida"));
  const externalUrl = cleanText(get(raw, "Link Notion"));
  const observation = cleanText(get(raw, "Observações"));
  const decision = mapDecision(decisionLabel, bought, priorityRank);
  const descriptionParts = [];
  const notesParts = [];

  if (project) descriptionParts.push(`Projeto: ${project}`);
  if (categoryName) notesParts.push(`Categoria sugerida: ${categoryName}`);
  if (quantity) notesParts.push(`Qtd: ${quantity}`);
  if (priorityRank !== null) notesParts.push(`Rank: ${priorityRank}`);
  if (decisionLabel) notesParts.push(`Decisão sugerida: ${decisionLabel}`);
  if (externalUrl) notesParts.push(`Link Notion: ${externalUrl}`);
  if (observation) notesParts.push(`Observações: ${observation}`);

  return {
    sheetName: row.sheetName,
    rowNumber: row.rowNumber,
    title,
    quantity,
    estimatedAmount,
    priorityRank,
    categoryName,
    project,
    decisionLabel,
    externalUrl,
    description: descriptionParts.length ? descriptionParts.join(" | ") : null,
    notes: notesParts.length ? notesParts.join("\n") : null,
    decisionStatus: decision.status,
    riskLevel: decision.risk,
  };
}

function mapDecision(decisionLabel, bought, priorityRank) {
  const text = normalizeKey(decisionLabel);

  if (bought || text.includes("ja comprado") || text.includes("comprado")) {
    return { status: "purchased", risk: "low" };
  }
  if (text.includes("priorizar") && !text.includes("revisar")) {
    return { status: "approved", risk: "high" };
  }
  if (text.includes("revisar para priorizar")) {
    return { status: "considering", risk: "medium" };
  }
  if (text.includes("esperar") || text.includes("revisar") || text.includes("promocao")) {
    return { status: "delayed", risk: "medium" };
  }
  if (priorityRank !== null && priorityRank > 0 && priorityRank <= 10) {
    return { status: "considering", risk: "high" };
  }

  return { status: "considering", risk: "medium" };
}

function get(raw, expectedHeader) {
  const expectedKey = normalizeHeader(expectedHeader);
  const foundKey = Object.keys(raw).find((key) => normalizeHeader(key) === expectedKey);
  return foundKey ? raw[foundKey] : "";
}

function cleanText(value) {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

function parseMoney(value) {
  if (typeof value === "number") return value;
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const normalized = text
    .replace(/[R$\s]/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : -1;
}

function parseInteger(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number.parseInt(text.replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isPositive(value) {
  return ["sim", "ok", "yes", "true", "1", "comprado"].includes(normalizeKey(value));
}

function normalizeHeader(value) {
  return normalizeKey(value).replace(/[^a-z0-9]/g, "");
}

function normalizeKey(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeUrl(value) {
  const text = cleanText(value);
  if (!text) return "";
  return text.trim().replace(/\/$/, "").toLowerCase();
}

function printPreview(prepared, validRows) {
  const duplicateOrInvalidRows = prepared.rows.filter((row) => row.status !== "new");
  const missingCategoryCount = prepared.missingCategoryNames.size;

  console.log("Prévia de importação - Compras e desejos");
  console.log(`Arquivo: ${filePath}`);
  console.log(`Total lido: ${prepared.rows.length}`);
  console.log(`Total novo: ${validRows.length}`);
  console.log(`Ignorado por duplicidade/erro: ${duplicateOrInvalidRows.length}`);
  console.log(`Categorias não encontradas: ${missingCategoryCount}`);
  console.log(`Categorias criadas: ${prepared.createdCategoryNames.size}`);

  if (prepared.missingCategoryNames.size > 0) {
    console.log("");
    console.log("Categorias não encontradas:");
    for (const name of prepared.missingCategoryNames) {
      console.log(`- ${name}`);
    }
    console.log("Use --create-categories para criá-las com user_id informado.");
  }

  if (duplicateOrInvalidRows.length > 0) {
    console.log("");
    console.log("Linhas ignoradas:");
    for (const row of duplicateOrInvalidRows.slice(0, 30)) {
      console.log(`- ${row.sheetName} linha ${row.rowNumber}: ${row.title || "(sem nome)"} | ${row.errors.join("; ")}`);
    }
    if (duplicateOrInvalidRows.length > 30) {
      console.log(`... mais ${duplicateOrInvalidRows.length - 30} linha(s).`);
    }
  }

  console.log("");
  console.log("Primeiras linhas novas:");
  for (const row of validRows.slice(0, 15)) {
    console.log(`- ${row.title} | ${formatMoney(row.estimatedAmount)} | ${row.decisionLabel ?? "sem decisão"} | ${row.project ?? "sem projeto"}`);
  }
}

function formatMoney(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
