#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const sourcePath = path.resolve("src/features/imports/import-engine.ts");
let source = fs.readFileSync(sourcePath, "utf8");

source = source
  .replace(/import \{ isActiveImportTarget \} from [^;]+;\r?\n/, "const isActiveImportTarget = () => true;\n")
  .replace(/import type [^;]+;\r?\n/g, "")
  .replace(/export /g, "");

source += "\nmodule.exports = { buildSystemGoalsPurchasesPreviewRows, rowCounts, buildInsertPayload };";

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

const sandbox = {
  console,
  module: { exports: {} },
  exports: {},
};

vm.runInNewContext(compiled, sandbox, { filename: sourcePath });

const engine = sandbox.module.exports;

const references = {
  people: [],
  categories: [{ id: "cat-1", name: "Tecnologia", type: "purchase" }],
  cards: [],
  invoices: [],
  accounts: [],
  incomeSources: [],
  existing: {
    people: [],
    categories: [],
    accounts_payable: [],
    income_sources: [],
    credit_cards: [],
    credit_card_invoices: [],
    credit_card_transactions: [],
    reimbursements: [],
    installments: [],
    planned_purchases: [],
    goals: [{ name: "Meta duplicada", target_date: "2026-12-15", goal_category: "personal" }],
  },
};

const rows = engine.buildSystemGoalsPurchasesPreviewRows(
  {
    goals: [
      {
        nome: "Aprender ingles",
        tipo: "Curso",
        data_alvo: "15/12/2026",
        status: "Ativa",
        observacoes: "Início: 01/06/2026",
      },
      {
        nome: "Meta duplicada",
        tipo: "Pessoal",
        data_alvo: "15/12/2026",
        status: "Ativa",
        observacoes: "Duplicada para teste",
      },
    ],
    purchases: [
      {
        nome: "Notebook",
        descricao: "Trabalho",
        valor_estimado: "3500",
        data_alvo: "2026-08-01",
        categoria: "Tecnologia",
        forma_planejada: "pix",
        parcelas: "1",
        status: "Priorizar",
        risco: "high",
        notas: "Comprar com desconto",
      },
      {
        nome: "Cadeira",
        descricao: "Ergonomia",
        valor_estimado: "800",
        categoria: "Moveis",
        status: "Esperar/Revisar",
        risco: "medium",
      },
    ],
  },
  references,
);

const goal = rows.find((row) => row.target === "goals");
const duplicateGoal = rows.find((row) => row.mapped.name === "Meta duplicada");
const purchase = rows.find((row) => row.mapped.title === "Notebook");
const purchaseWithMissingCategory = rows.find((row) => row.mapped.title === "Cadeira");
const goalPayload = engine.buildInsertPayload("goals", "user-1", {
  ...goal.mapped,
  import_batch_id: "batch-1",
});
const rowNumbers = rows.map((row) => row.rowNumber);
const uniqueRowNumbers = new Set(rowNumbers);

const assertions = [
  ["linhas da previa usam rowNumber global unico", uniqueRowNumbers.size === rows.length],
  ["metas preservam origem da aba", goal.rowNumber === 1 && goal.raw._source_sheet === "Metas_Sistema" && goal.raw._source_row_number === "2"],
  ["metadados da meta preservam linha original", goal.mapped._source_sheet === "Metas_Sistema" && goal.mapped._source_row_number === 2],
  ["compras continuam numeracao global apos metas", purchase.rowNumber === 3],
  ["compras preservam origem da aba", purchase.raw._source_sheet === "Compras_Sistema" && purchase.raw._source_row_number === "2"],
  ["metadados da compra preservam linha original", purchase.mapped._source_sheet === "Compras_Sistema" && purchase.mapped._source_row_number === 2],
  ["meta qualitativa valida", goal.status === "valid"],
  ["meta duplicada ignorada por padrao", duplicateGoal.status === "skipped" && duplicateGoal.duplicate === true],
  ["meta sem categoria pendente", goal.missingCategoryName === null],
  ["tipo Curso mapeado para course", goal.mapped.goal_category === "course"],
  ["aba Metas_Sistema nao usa progresso manual", goal.mapped.manual_progress_percent === null],
  ["meta qualitativa nao vira financeira ou numerica", goal.mapped.goal_kind === "qualitative"],
  [
    "meta qualitativa sem valores financeiros",
    goal.mapped.target_amount === null &&
      goal.mapped.current_amount === null &&
      goal.mapped.monthly_contribution === null,
  ],
  ["payload de meta com import_batch_id", goalPayload.import_batch_id === "batch-1"],
  ["payload de meta com created_by", goalPayload.created_by === "user-1"],
  ["compra com categoria inexistente fica pendente", purchaseWithMissingCategory.missingCategoryName === "Moveis"],
  ["compra pendente continua valida para importar sem categoria apos confirmacao", purchaseWithMissingCategory.status === "valid"],
];

const failed = assertions.filter(([, ok]) => !ok);

if (failed.length > 0) {
  console.error(`Falhas na validacao local: ${failed.map(([name]) => name).join(", ")}`);
  process.exit(1);
}

console.log("Validacao local do fluxo Metas e compras concluida.");
console.log(
  JSON.stringify(
    {
      total: rows.length,
      valid: rows.filter((row) => row.status === "valid").length,
      skipped: rows.filter((row) => row.status === "skipped").length,
      missingCategory: purchaseWithMissingCategory.missingCategoryName,
      goalKind: goal.mapped.goal_kind,
      goalCategory: goal.mapped.goal_category,
      goalImportBatchId: goalPayload.import_batch_id,
      goalCreatedBy: goalPayload.created_by,
    },
    null,
    2,
  ),
);
