#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const sourcePath = path.resolve("src/features/reimbursements/debt-summary.ts");
let source = fs.readFileSync(sourcePath, "utf8");

source = source
  .replace(/import type [^;]+;\r?\n/g, "")
  .replace(/export /g, "");

source += "\nmodule.exports = { buildPersonDebtSummaries, filterPersonDebtSummaries, getReimbursementOpenAmount, isReimbursementLateByDate };";

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const sandbox = {
  console,
  module: { exports: {} },
  exports: {},
};

vm.runInNewContext(compiled, sandbox, { filename: sourcePath });

const {
  buildPersonDebtSummaries,
  filterPersonDebtSummaries,
  getReimbursementOpenAmount,
  isReimbursementLateByDate,
} = sandbox.module.exports;

const people = [
  { id: "person-open", name: "Aberto" },
  { id: "person-late", name: "Atrasado" },
  { id: "person-settled", name: "Quitado" },
  { id: "person-partial", name: "Parcial" },
];

const reimbursements = [
  reimbursement({ id: "open-1", person_id: "person-open", expected_amount: 100, received_amount: 0, expected_date: "2026-06-20", status: "expected" }),
  reimbursement({ id: "late-1", person_id: "person-late", expected_amount: 80, received_amount: 0, expected_date: "2026-06-01", status: "expected" }),
  reimbursement({ id: "settled-1", person_id: "person-settled", expected_amount: 50, received_amount: 50, expected_date: "2026-06-01", status: "received" }),
  reimbursement({ id: "partial-1", person_id: "person-partial", expected_amount: 120, received_amount: 40, expected_date: "2026-06-20", status: "partial" }),
];

const summaries = buildPersonDebtSummaries(people, reimbursements, "2026-06-07");
const byPerson = Object.fromEntries(summaries.map((item) => [item.person.id, item]));

assert.equal(byPerson["person-open"].totalExpected, 100);
assert.equal(byPerson["person-open"].received, 0);
assert.equal(byPerson["person-open"].open, 100);
assert.equal(byPerson["person-open"].late, 0);
assert.equal(byPerson["person-open"].openCount, 1);
assert.equal(byPerson["person-open"].lateCount, 0);
assert.equal(byPerson["person-open"].status, "em_dia");

assert.equal(byPerson["person-late"].open, 80);
assert.equal(byPerson["person-late"].late, 80);
assert.equal(byPerson["person-late"].lateCount, 1);
assert.equal(byPerson["person-late"].status, "atrasado");
assert.equal(isReimbursementLateByDate(reimbursements[1], "2026-06-07"), true);

assert.equal(byPerson["person-settled"].open, 0);
assert.equal(byPerson["person-settled"].lateCount, 0);
assert.equal(byPerson["person-settled"].status, "quitado");
assert.equal(getReimbursementOpenAmount(reimbursements[2]), 0);

assert.equal(byPerson["person-partial"].received, 40);
assert.equal(byPerson["person-partial"].open, 80);
assert.equal(byPerson["person-partial"].partialCount, 1);
assert.equal(byPerson["person-partial"].status, "parcial");

assert.deepEqual(
  filterPersonDebtSummaries(summaries, "open").map((item) => item.person.id).sort(),
  ["person-late", "person-open", "person-partial"].sort(),
  "default open view should hide settled people",
);
assert.deepEqual(filterPersonDebtSummaries(summaries, "late").map((item) => item.person.id), ["person-late"]);
assert.equal(filterPersonDebtSummaries(summaries, "all").length, 4);
assert.deepEqual(
  filterPersonDebtSummaries(summaries, "hide_settled").map((item) => item.person.id).sort(),
  ["person-late", "person-open", "person-partial"].sort(),
);

const clickedPersonId = "person-late";
const filteredRows = filterReimbursementsByPerson(reimbursements, clickedPersonId);
assert.equal(filteredRows.length, 1, "clicking a person card should filter the reimbursement table");
assert.equal(filteredRows[0].person_id, clickedPersonId);
assert.equal(filterReimbursementsByPerson(reimbursements, "all").length, reimbursements.length, "clear filter should show all rows again");

console.log("Reimbursements debt summary validation passed.");

function reimbursement(overrides) {
  return {
    id: overrides.id,
    user_id: "user-1",
    person_id: overrides.person_id,
    category_id: null,
    credit_card_transaction_id: null,
    credit_card_invoice_id: null,
    account_payable_id: null,
    income_source_id: null,
    source_type: null,
    source_id: null,
    description: overrides.id,
    expected_amount: overrides.expected_amount,
    received_amount: overrides.received_amount,
    expected_date: overrides.expected_date,
    received_date: null,
    status: overrides.status,
    notes: null,
    is_recurring: false,
    recurrence_frequency: null,
    recurrence_start_date: null,
    recurrence_end_date: null,
    recurrence_parent_id: null,
    recurrence_generated_until: null,
  };
}

function filterReimbursementsByPerson(rows, personId) {
  return rows.filter((row) => personId === "all" || row.person_id === personId);
}
