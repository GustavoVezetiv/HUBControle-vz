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
  .replace(/import \{[^}]+\} from \"@\/features\/shared\/archive\";\r?\n/g, "")
  .replace(/export /g, "");

source += "\nmodule.exports = { syncReimbursementFinancialLink, recalculateInvoiceTotal };";

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
  archiveRecord: async (client, tableName, id, userId, reason) => {
    const table = client.tables[tableName];
    const row = table.find((item) => item.id === id && item.user_id === userId);
    if (!row) return { error: { message: "row not found" } };
    row.archived_at = "2026-06-11T00:00:00.000Z";
    row.archive_reason = reason ?? null;
    return { error: null };
  },
  restoreArchivedRecord: async () => ({ error: null }),
};

vm.runInNewContext(compiled, sandbox, { filename: sourcePath });

const { syncReimbursementFinancialLink } = sandbox.module.exports;

async function main() {
  await shouldLinkExistingTransaction();
  await shouldCreateNewTransactionInInvoice();
  await shouldMoveLinkedTransactionBetweenInvoices();
  await shouldRemoveLinkKeepingTransaction();
  await shouldBlockLinkedTransactionWithoutConfirmation();
  await shouldAllowReplacingExistingLinkedTransactionWithConfirmation();
  console.log("Reimbursement financial link flow validation passed.");
}

async function shouldLinkExistingTransaction() {
  const db = baseDb();
  const client = createMockSupabaseClient(db);
  const reimbursement = db.reimbursements.find((item) => item.id === "reimbursement-a");

  const result = await syncReimbursementFinancialLink(client, "user-1", reimbursement, {
    ...baseValues(),
    financial_link_mode: "link_existing",
    financial_link_card_id: "card-1",
    financial_link_invoice_id: "invoice-1",
    financial_link_transaction_id: "transaction-free",
  });

  assert.equal(result.error, null);
  assert.equal(db.credit_card_transactions.find((item) => item.id === "transaction-free")?.reimbursement_id, "reimbursement-a");
  assert.equal(db.reimbursements.find((item) => item.id === "reimbursement-a")?.credit_card_transaction_id, "transaction-free");
  assert.equal(db.reimbursements.find((item) => item.id === "reimbursement-a")?.credit_card_invoice_id, "invoice-1");
}

async function shouldCreateNewTransactionInInvoice() {
  const db = baseDb();
  const client = createMockSupabaseClient(db);
  const reimbursement = db.reimbursements.find((item) => item.id === "reimbursement-b");

  const result = await syncReimbursementFinancialLink(client, "user-1", reimbursement, {
    ...baseValues(),
    financial_link_mode: "create_invoice_transaction",
    financial_link_card_id: "card-1",
    financial_link_invoice_id: "invoice-1",
    financial_link_new_description: "Novo lancamento",
    financial_link_new_amount: "55",
    financial_link_new_date: "2026-06-08",
    financial_link_new_category_id: "category-1",
  });

  assert.equal(result.error, null);
  const created = db.credit_card_transactions.find((item) => item.id === result.transactionId);
  assert.ok(created);
  assert.equal(created.invoice_id, "invoice-1");
  assert.equal(created.credit_card_id, "card-1");
  assert.equal(created.reimbursement_id, "reimbursement-b");
  assert.equal(db.credit_card_invoices.find((item) => item.id === "invoice-1")?.total_amount, 207);
}

async function shouldMoveLinkedTransactionBetweenInvoices() {
  const db = baseDb();
  const client = createMockSupabaseClient(db);
  const reimbursement = db.reimbursements.find((item) => item.id === "reimbursement-linked");

  const result = await syncReimbursementFinancialLink(client, "user-1", reimbursement, {
    ...baseValues(),
    financial_link_mode: "link_existing",
    financial_link_card_id: "card-1",
    financial_link_invoice_id: "invoice-2",
    financial_link_transaction_id: "transaction-linked",
  });

  assert.equal(result.error, null);
  assert.equal(db.credit_card_transactions.find((item) => item.id === "transaction-linked")?.invoice_id, "invoice-2");
  assert.equal(db.credit_card_invoices.find((item) => item.id === "invoice-1")?.total_amount, 92);
  assert.equal(db.credit_card_invoices.find((item) => item.id === "invoice-2")?.total_amount, 60);
  assert.equal(db.reimbursements.find((item) => item.id === "reimbursement-linked")?.credit_card_invoice_id, "invoice-2");
}

async function shouldRemoveLinkKeepingTransaction() {
  const db = baseDb();
  const client = createMockSupabaseClient(db);
  const reimbursement = db.reimbursements.find((item) => item.id === "reimbursement-linked");

  const result = await syncReimbursementFinancialLink(client, "user-1", reimbursement, {
    ...baseValues(),
    financial_link_mode: "remove_current",
    financial_link_remove_mode: "keep_transaction",
  });

  assert.equal(result.error, null);
  assert.equal(db.credit_card_transactions.find((item) => item.id === "transaction-linked")?.reimbursement_id, null);
  assert.equal(db.credit_card_transactions.find((item) => item.id === "transaction-linked")?.is_reimbursable, false);
  assert.equal(db.reimbursements.find((item) => item.id === "reimbursement-linked")?.credit_card_transaction_id, null);
}

async function shouldBlockLinkedTransactionWithoutConfirmation() {
  const db = baseDb();
  const client = createMockSupabaseClient(db);
  const reimbursement = db.reimbursements.find((item) => item.id === "reimbursement-a");

  const result = await syncReimbursementFinancialLink(client, "user-1", reimbursement, {
    ...baseValues(),
    financial_link_mode: "link_existing",
    financial_link_card_id: "card-1",
    financial_link_invoice_id: "invoice-1",
    financial_link_transaction_id: "transaction-owned-by-other",
  });

  assert.ok(result.error);
  assert.match(result.error.message, /confirme a substituição/i);
}

async function shouldAllowReplacingExistingLinkedTransactionWithConfirmation() {
  const db = baseDb();
  const client = createMockSupabaseClient(db);
  const reimbursement = db.reimbursements.find((item) => item.id === "reimbursement-a");

  const result = await syncReimbursementFinancialLink(client, "user-1", reimbursement, {
    ...baseValues(),
    financial_link_mode: "link_existing",
    financial_link_card_id: "card-1",
    financial_link_invoice_id: "invoice-1",
    financial_link_transaction_id: "transaction-owned-by-other",
    financial_link_allow_reuse: true,
  });

  assert.equal(result.error, null);
  assert.equal(db.credit_card_transactions.find((item) => item.id === "transaction-owned-by-other")?.reimbursement_id, "reimbursement-a");
  assert.equal(db.reimbursements.find((item) => item.id === "reimbursement-other")?.credit_card_transaction_id, null);
}

function baseDb() {
  return {
    credit_card_invoices: [
      invoiceRow("invoice-1", "card-1", 80),
      invoiceRow("invoice-2", "card-1", 20),
      invoiceRow("invoice-other-card", "card-2", 0),
    ],
    credit_card_transactions: [
      transactionRow("transaction-free", { invoice_id: "invoice-1", credit_card_id: "card-1", amount: 20 }),
      transactionRow("transaction-existing-2", { invoice_id: "invoice-1", credit_card_id: "card-1", amount: 60 }),
      transactionRow("transaction-linked", { invoice_id: "invoice-1", credit_card_id: "card-1", amount: 60, reimbursement_id: "reimbursement-linked", is_reimbursable: true }),
      transactionRow("transaction-owned-by-other", { invoice_id: "invoice-1", credit_card_id: "card-1", amount: 12, reimbursement_id: "reimbursement-other", is_reimbursable: true }),
    ],
    reimbursements: [
      reimbursementRow("reimbursement-a"),
      reimbursementRow("reimbursement-b"),
      reimbursementRow("reimbursement-linked", { credit_card_transaction_id: "transaction-linked", credit_card_invoice_id: "invoice-1", source_type: "credit_card_transaction", source_id: "transaction-linked" }),
      reimbursementRow("reimbursement-other", { credit_card_transaction_id: "transaction-owned-by-other", credit_card_invoice_id: "invoice-1", source_type: "credit_card_transaction", source_id: "transaction-owned-by-other" }),
    ],
  };
}

function invoiceRow(id, cardId, totalAmount) {
  return {
    id,
    user_id: "user-1",
    credit_card_id: cardId,
    reference_month: "2026-06-01",
    due_date: "2026-06-10",
    status: "open",
    total_amount: totalAmount,
    archived_at: null,
  };
}

function transactionRow(id, overrides = {}) {
  return {
    id,
    user_id: "user-1",
    credit_card_id: "card-1",
    invoice_id: "invoice-1",
    category_id: "category-1",
    person_id: "person-1",
    description: id,
    amount: 0,
    transaction_date: "2026-06-05",
    ownership_type: "third_party",
    is_reimbursable: false,
    reimbursement_status: "not_applicable",
    reimbursement_id: null,
    archived_at: null,
    ...overrides,
  };
}

function reimbursementRow(id, overrides = {}) {
  return {
    id,
    user_id: "user-1",
    person_id: "person-1",
    category_id: "category-1",
    description: id,
    expected_amount: 55,
    received_amount: 0,
    expected_date: "2026-06-10",
    received_date: null,
    received_at: null,
    status: "expected",
    account_payable_id: null,
    income_source_id: null,
    credit_card_transaction_id: null,
    credit_card_invoice_id: null,
    source_type: "manual",
    source_id: null,
    archived_at: null,
    ...overrides,
  };
}

function baseValues() {
  return {
    person_id: "person-1",
    category_id: "category-1",
    credit_card_transaction_id: "",
    credit_card_invoice_id: "",
    account_payable_id: "",
    income_source_id: "",
    description: "Reembolso teste",
    expected_amount: "55",
    received_amount: "0",
    expected_date: "2026-06-10",
    received_date: "",
    status: "expected",
    notes: "",
    is_recurring: false,
    recurrence_frequency: "monthly",
    recurrence_start_date: "",
    recurrence_end_date: "",
    recurrence_occurrences: "0",
    financial_link_mode: "none",
    financial_link_card_id: "",
    financial_link_invoice_id: "",
    financial_link_transaction_id: "",
    financial_link_allow_reuse: false,
    financial_link_new_description: "",
    financial_link_new_amount: "0",
    financial_link_new_date: "",
    financial_link_new_category_id: "",
    financial_link_remove_mode: "keep_transaction",
  };
}

function createMockSupabaseClient(tables) {
  return {
    tables,
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

  eq(column, value) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  neq(column, value) {
    this.filters.push({ kind: "neq", column, value });
    return this;
  }

  is(column, value) {
    this.filters.push({ kind: "is", column, value });
    return this;
  }

  maybeSingle() {
    this.maybeSingleMode = true;
    return this.execute();
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
    assert.ok(Array.isArray(table), `missing mock table ${this.tableName}`);

    if (this.operation === "insert") {
      const inserted = this.payload.map((item) => ({
        id: item.id ?? `mock-${this.tableName}-${table.length + 1}`,
        archived_at: null,
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

    return this.formatRows(matched);
  }

  matches(row) {
    return this.filters.every((filter) => {
      if (filter.kind === "eq") return row[filter.column] === filter.value;
      if (filter.kind === "neq") return row[filter.column] !== filter.value;
      return row[filter.column] === filter.value;
    });
  }

  formatRows(rows) {
    if (this.singleMode) {
      return Promise.resolve({ data: rows[0] ?? null, error: rows[0] ? null : { message: "not found" } });
    }

    if (this.maybeSingleMode) {
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    }

    return Promise.resolve({ data: rows, error: null });
  }
}

await main();
