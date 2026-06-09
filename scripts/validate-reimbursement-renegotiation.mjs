#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const queriesPath = path.resolve("src/features/reimbursements/queries.ts");
let queriesSource = fs.readFileSync(queriesPath, "utf8");
queriesSource = queriesSource.replace(/import type [^;]+;\r?\n/g, "").replace(/export /g, "");
queriesSource += "\nmodule.exports = { renegotiateReimbursements };";

const queriesCompiled = ts.transpileModule(queriesSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

const queriesSandbox = { console, module: { exports: {} }, exports: {} };
vm.runInNewContext(queriesCompiled, queriesSandbox, { filename: queriesPath });
const { renegotiateReimbursements } = queriesSandbox.module.exports;

const debtPath = path.resolve("src/features/reimbursements/debt-summary.ts");
let debtSource = fs.readFileSync(debtPath, "utf8");
debtSource = debtSource.replace(/import type [^;]+;\r?\n/g, "").replace(/export /g, "");
debtSource += "\nmodule.exports = { buildPersonDebtSummaries, filterPersonDebtSummaries };";

const debtCompiled = ts.transpileModule(debtSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

const debtSandbox = { console, module: { exports: {} }, exports: {} };
vm.runInNewContext(debtCompiled, debtSandbox, { filename: debtPath });
const { buildPersonDebtSummaries, filterPersonDebtSummaries } = debtSandbox.module.exports;

await main();

function reimbursement(overrides) {
  return {
    id: overrides.id,
    user_id: "user-1",
    person_id: overrides.person_id,
    category_id: null,
    source_type: "manual",
    source_id: null,
    credit_card_transaction_id: null,
    account_payable_id: null,
    income_source_id: null,
    credit_card_invoice_id: null,
    description: overrides.description,
    expected_amount: overrides.expected_amount,
    received_amount: overrides.received_amount,
    status: overrides.status,
    expected_date: overrides.expected_date,
    received_at: null,
    received_date: null,
    is_recurring: false,
    recurrence_frequency: null,
    recurrence_start_date: null,
    recurrence_end_date: null,
    recurrence_parent_id: null,
    recurrence_generated_until: null,
    renegotiated_into_id: null,
    renegotiated_at: null,
    renegotiation_source_ids: [],
    pix_reference: null,
    notes: null,
  };
}

function createMockSupabaseClient(tables) {
  return {
    from(tableName) {
      return new QueryBuilder(tables, tableName);
    },
  };
}

async function main() {
  const db = {
    reimbursements: [
      reimbursement({ id: "r-1", person_id: "person-1", description: "Netflix", expected_amount: 50, received_amount: 0, expected_date: "2026-05-10", status: "late" }),
      reimbursement({ id: "r-2", person_id: "person-1", description: "Spotify", expected_amount: 70, received_amount: 20, expected_date: "2026-06-10", status: "partial" }),
      reimbursement({ id: "r-3", person_id: "person-2", description: "Outro", expected_amount: 30, received_amount: 0, expected_date: "2026-06-10", status: "expected" }),
      reimbursement({ id: "r-4", person_id: "person-1", description: "Quitado", expected_amount: 40, received_amount: 40, expected_date: "2026-04-10", status: "received" }),
    ],
  };

  const client = createMockSupabaseClient(db);

  const mixedPeople = await renegotiateReimbursements(client, "user-1", [db.reimbursements[0], db.reimbursements[2]], {
    expected_date: "2026-06-30",
    description: "Renegociação inválida",
    notes: "",
  });
  assert.ok(mixedPeople.error, "different people should be blocked");

  const receivedBlocked = await renegotiateReimbursements(client, "user-1", [db.reimbursements[3]], {
    expected_date: "2026-06-30",
    description: "Renegociação inválida",
    notes: "",
  });
  assert.ok(receivedBlocked.error, "received reimbursement should be blocked");

  const success = await renegotiateReimbursements(client, "user-1", [db.reimbursements[0], db.reimbursements[1]], {
    expected_date: "2026-06-30",
    description: "Renegociação Humberto",
    notes: "Nova combinação",
  });

  assert.equal(success.error, null, "same-person open reimbursements should renegotiate");
  assert.equal(success.count, 2);

  const newRow = db.reimbursements.find((item) => item.id === success.created.id);
  assert.ok(newRow, "new consolidated reimbursement should be created");
  assert.equal(newRow.person_id, "person-1");
  assert.equal(newRow.expected_amount, 100, "new expected amount should sum only open balances");
  assert.equal(newRow.received_amount, 0);
  assert.equal(newRow.status, "expected");
  assert.equal(newRow.expected_date, "2026-06-30");
  assert.deepEqual(newRow.renegotiation_source_ids, ["r-1", "r-2"]);

  const oldRows = db.reimbursements.filter((item) => ["r-1", "r-2"].includes(item.id));
  assert.ok(oldRows.every((item) => item.status === "renegotiated"), "old reimbursements should become renegotiated");
  assert.ok(oldRows.every((item) => item.renegotiated_into_id === newRow.id), "old reimbursements should link to new one");
  assert.ok(oldRows.every((item) => item.renegotiated_at), "old reimbursements should store renegotiated timestamp");

  const duplicateBlocked = await renegotiateReimbursements(client, "user-1", [db.reimbursements[0]], {
    expected_date: "2026-07-30",
    description: "Tentativa duplicada",
    notes: "",
  });
  assert.ok(duplicateBlocked.error, "already renegotiated titles should be blocked");

  const summaries = buildPersonDebtSummaries(
    [
      { id: "person-1", name: "Pessoa 1" },
      { id: "person-2", name: "Pessoa 2" },
    ],
    db.reimbursements,
    "2026-06-08",
  );
  const visibleDebt = filterPersonDebtSummaries(summaries, "all_debt");
  const personOne = visibleDebt.find((item) => item.person.id === "person-1");
  assert.ok(personOne, "new renegotiated title should remain in active debt summary");
  assert.equal(personOne.open, 100, "old renegotiated rows should leave active summary and only the new title should remain");
  assert.equal(db.reimbursements.filter((item) => item.person_id === "person-1").length, 4, "history should keep old and new rows");

  console.log("Reimbursement renegotiation validation passed.");
}

class QueryBuilder {
  constructor(tables, tableName) {
    this.tables = tables;
    this.tableName = tableName;
    this.filters = [];
    this.operation = "select";
    this.payload = null;
    this.singleMode = false;
  }

  select() {
    return this;
  }

  insert(payload) {
    this.operation = "insert";
    this.payload = Array.isArray(payload) ? payload : [payload];
    return this;
  }

  update(payload) {
    this.operation = "update";
    this.payload = payload;
    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  eq(column, value) {
    this.filters.push({ type: "eq", column, value });
    return this;
  }

  in(column, values) {
    this.filters.push({ type: "in", column, values });
    return this;
  }

  single() {
    this.singleMode = true;
    return this.execute();
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }

  async execute() {
    const table = this.tables[this.tableName];

    if (this.operation === "insert") {
      const rows = this.payload.map((row, index) => ({
        id: row.id ?? `mock-${this.tableName}-${table.length + index + 1}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...row,
      }));
      table.push(...rows);
      return this.singleMode ? { data: rows[0], error: null } : { data: rows, error: null };
    }

    const matched = table.filter((row) => this.matches(row));

    if (this.operation === "update") {
      matched.forEach((row) => Object.assign(row, this.payload));
      return { data: matched, error: null };
    }

    if (this.operation === "delete") {
      for (let index = table.length - 1; index >= 0; index -= 1) {
        if (this.matches(table[index])) table.splice(index, 1);
      }
      return { data: null, error: null };
    }

    return this.singleMode ? { data: matched[0] ?? null, error: null } : { data: matched, error: null };
  }

  matches(row) {
    return this.filters.every((filter) =>
      filter.type === "eq" ? row[filter.column] === filter.value : filter.values.includes(row[filter.column]),
    );
  }
}
