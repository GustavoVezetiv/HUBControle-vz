#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const sourcePath = path.resolve("src/features/reimbursements/queries.ts");
let source = fs.readFileSync(sourcePath, "utf8");

source = source
  .replace(/import type [^;]+;\r?\n/g, "")
  .replace(/export /g, "");

source += "\nmodule.exports = { generateLinkedEntryFromReimbursement, recalculateInvoiceTotal };";

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

const { generateLinkedEntryFromReimbursement } = sandbox.module.exports;

async function main() {
  const db = {
  credit_card_invoices: [
    {
      id: "invoice-1",
      user_id: "user-1",
      credit_card_id: "card-1",
      reference_month: "2026-06-01",
      due_date: "2026-06-10",
      status: "open",
      total_amount: 20,
    },
    {
      id: "invoice-other-card",
      user_id: "user-1",
      credit_card_id: "card-2",
      reference_month: "2026-06-01",
      due_date: "2026-06-10",
      status: "open",
      total_amount: 0,
    },
  ],
  credit_card_transactions: [
    {
      id: "transaction-existing",
      user_id: "user-1",
      credit_card_id: "card-1",
      invoice_id: "invoice-1",
      description: "Compra existente",
      amount: 20,
      transaction_date: "2026-06-01",
      is_reimbursable: false,
    },
  ],
  reimbursements: [
    baseReimbursement("reimbursement-1"),
    baseReimbursement("reimbursement-2"),
  ],
  };

  const client = createMockSupabaseClient(db);

  const result = await generateLinkedEntryFromReimbursement(
  client,
  "user-1",
  db.reimbursements[0],
  {
    target: "invoice",
    credit_card_id: "card-1",
    invoice_id: "invoice-1",
    description: "Youtube Family - Humberto",
    amount: "42.5",
    transaction_date: "2026-06-05",
  },
  );

  assert.equal(result.error, null, "generation should succeed");
  assert.ok(result.transactionId, "generated transaction id should be returned");
  assert.equal(result.invoiceId, "invoice-1", "selected invoice id should be returned");

  const generatedTransaction = db.credit_card_transactions.find((item) => item.id === result.transactionId);
  assert.ok(generatedTransaction, "transaction should be inserted");
  assert.equal(generatedTransaction.invoice_id, "invoice-1", "transaction invoice_id should be saved");
  assert.equal(generatedTransaction.credit_card_id, "card-1", "transaction credit_card_id should be saved");
  assert.equal(generatedTransaction.category_id, "category-1", "transaction category should come from reimbursement");
  assert.equal(generatedTransaction.person_id, "person-1", "transaction person should come from reimbursement");
  assert.equal(generatedTransaction.description, "Youtube Family - Humberto");
  assert.equal(generatedTransaction.amount, 42.5);
  assert.equal(generatedTransaction.transaction_date, "2026-06-05");
  assert.equal(generatedTransaction.is_reimbursable, true);
  assert.equal(generatedTransaction.reimbursement_id, "reimbursement-1");
  assert.equal(generatedTransaction.reimbursement_status, "pending");

  const invoiceTransactions = db.credit_card_transactions.filter((item) => item.invoice_id === "invoice-1");
  assert.equal(invoiceTransactions.length, 2, "invoice query by invoice_id should find generated transaction");
  assert.equal(db.credit_card_invoices[0].total_amount, 62.5, "invoice total should be recalculated from linked transactions");
  assert.equal(db.reimbursements[0].credit_card_transaction_id, result.transactionId, "reimbursement should link transaction");
  assert.equal(db.reimbursements[0].credit_card_invoice_id, "invoice-1", "reimbursement should link invoice");

  const duplicateResult = await generateLinkedEntryFromReimbursement(
  client,
  "user-1",
  db.reimbursements[0],
  {
    target: "invoice",
    credit_card_id: "card-1",
    invoice_id: "invoice-1",
    description: "Youtube Family - Humberto",
    amount: "42.5",
    transaction_date: "2026-06-05",
  },
  );

  assert.ok(duplicateResult.error, "duplicate generation should be blocked");
  assert.equal(
  db.credit_card_transactions.filter((item) => item.reimbursement_id === "reimbursement-1").length,
  1,
  "duplicate generation should not insert another transaction",
  );

  const mismatchResult = await generateLinkedEntryFromReimbursement(
  client,
  "user-1",
  db.reimbursements[1],
  {
    target: "invoice",
    credit_card_id: "card-1",
    invoice_id: "invoice-other-card",
    description: "Outro reembolso",
    amount: "30",
    transaction_date: "2026-06-06",
  },
  );

  assert.ok(mismatchResult.error, "card/invoice mismatch should be blocked");
  assert.match(mismatchResult.error.message, /não pertence ao cartão/i);
  assert.equal(
  db.credit_card_transactions.filter((item) => item.reimbursement_id === "reimbursement-2").length,
  0,
  "mismatched invoice/card should not insert a transaction",
  );

  console.log("Reimbursement invoice link flow validation passed.");
}

function baseReimbursement(id) {
  return {
    id,
    user_id: "user-1",
    person_id: "person-1",
    category_id: "category-1",
    description: "Youtube Family",
    expected_amount: 42.5,
    received_amount: 0,
    expected_date: "2026-06-10",
    received_date: null,
    status: "expected",
    account_payable_id: null,
    credit_card_transaction_id: null,
    credit_card_invoice_id: null,
    income_source_id: null,
    source_type: null,
    source_id: null,
  };
}

function createMockSupabaseClient(tables) {
  return {
    from(tableName) {
      return new QueryBuilder(tables, tableName);
    },
  };
}

class QueryBuilder {
  constructor(tables, tableName) {
    this.tables = tables;
    this.tableName = tableName;
    this.filters = [];
    this.operation = "select";
    this.payload = null;
    this.singleMode = false;
    this.maybeSingleMode = false;
  }

  select() {
    this.operation = this.operation === "insert" || this.operation === "update" ? this.operation : "select";
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
    this.filters.push({ column, value });
    return this;
  }

  single() {
    this.singleMode = true;
    return this.execute();
  }

  maybeSingle() {
    this.maybeSingleMode = true;
    return this.execute();
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }

  async execute() {
    const table = this.tables[this.tableName];
    assert.ok(Array.isArray(table), `missing mock table: ${this.tableName}`);

    if (this.operation === "insert") {
      const inserted = this.payload.map((item) => ({
        id: item.id ?? `mock-${this.tableName}-${table.length + 1}`,
        ...item,
      }));
      table.push(...inserted);
      return this.formatRows(inserted);
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

    return this.formatRows(matched);
  }

  matches(row) {
    return this.filters.every((filter) => row[filter.column] === filter.value);
  }

  formatRows(rows) {
    if (this.singleMode) {
      return rows.length === 1
        ? { data: rows[0], error: null }
        : { data: null, error: { message: `Expected one row, found ${rows.length}` } };
    }

    if (this.maybeSingleMode) {
      return rows.length <= 1
        ? { data: rows[0] ?? null, error: null }
        : { data: null, error: { message: `Expected at most one row, found ${rows.length}` } };
    }

    return { data: rows, error: null };
  }
}

await main();
