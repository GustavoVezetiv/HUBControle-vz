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

source += "\nmodule.exports = { buildPreviewRows, buildSystemGoalsPurchasesPreviewRows };";

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

const { buildPreviewRows, buildSystemGoalsPurchasesPreviewRows } = sandbox.module.exports;

const references = {
  people: [],
  categories: [],
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
    goals: [],
  },
};

const brRows = buildPreviewRows(
  "accounts_payable",
  [
    { titulo: "Conta A", valor: "100", vencimento: "24/12/2025" },
    { titulo: "Conta B", valor: "100", vencimento: "01/05/2025" },
    { titulo: "Conta C", valor: "100", vencimento: "24-12-2025" },
  ],
  references,
  { dateFormat: "br" },
);

const isoRows = buildPreviewRows(
  "accounts_payable",
  [{ titulo: "Conta ISO", valor: "100", vencimento: "2025-12-24" }],
  references,
  { dateFormat: "iso" },
);

const invalidRows = buildPreviewRows(
  "accounts_payable",
  [{ titulo: "Conta invalida", valor: "100", vencimento: "31/02/2025" }],
  references,
  { dateFormat: "br" },
);

const optionalDateRows = buildSystemGoalsPurchasesPreviewRows(
  {
    goals: [{ nome: "Meta sem data", tipo: "Pessoal", data_alvo: "", observacoes: "" }],
    purchases: [],
  },
  references,
  { dateFormat: "br" },
);

const assertions = [
  ["24/12/2025 normaliza para 2025-12-24", brRows[0].mapped.due_date === "2025-12-24"],
  ["01/05/2025 normaliza para 2025-05-01", brRows[1].mapped.due_date === "2025-05-01"],
  ["24-12-2025 normaliza para 2025-12-24", brRows[2].mapped.due_date === "2025-12-24"],
  ["2025-12-24 continua valido em ISO", isoRows[0].mapped.due_date === "2025-12-24" && isoRows[0].status === "valid"],
  [
    "data invalida mostra linha e campo",
    invalidRows[0].status === "invalid" &&
      invalidRows[0].errors.some((error) => error.includes("Linha 2, campo Vencimento")) &&
      invalidRows[0].errors.some((error) => error.includes("Esperado formato dd/mm/aaaa")),
  ],
  ["data vazia opcional continua permitida", optionalDateRows[0].status === "valid" && optionalDateRows[0].mapped.target_date === null],
];

const failed = assertions.filter(([, ok]) => !ok);

if (failed.length > 0) {
  console.error(`Falhas na validacao de datas da importacao: ${failed.map(([name]) => name).join(", ")}`);
  process.exit(1);
}

console.log("Validacao local de datas da importacao concluida.");
console.log(
  JSON.stringify(
    {
      brExamples: brRows.map((row) => row.mapped.due_date),
      isoExample: isoRows[0].mapped.due_date,
      invalidErrors: invalidRows[0].errors,
      optionalTargetDate: optionalDateRows[0].mapped.target_date,
    },
    null,
    2,
  ),
);
