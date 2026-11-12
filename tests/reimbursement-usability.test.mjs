import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = fileURLToPath(new URL("../", import.meta.url));
const cache = new Map();
function load(path) {
  if (cache.has(path)) return cache.get(path);
  const source = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, {
    Intl,
    Date,
    console,
  })(
    (name) =>
      load(
        resolve(
          name.startsWith("@/") ? resolve(root, "src") : dirname(path),
          `${name.startsWith("@/") ? name.slice(2) : name}.ts`,
        ),
      ),
    loadedModule,
    loadedModule.exports,
  );
  cache.set(path, loadedModule.exports);
  return loadedModule.exports;
}
const {
  getFifthBusinessDayOfNextMonth,
  getBrazilNationalHolidays,
  getReimbursementToday,
} = load(resolve(root, "src/features/reimbursements/carryover-date.ts"));
const { createReimbursementForm, reimbursementToFormValues } = load(
  resolve(root, "src/features/reimbursements/types.ts"),
);
const {
  filterReimbursementRows,
  defaultAdvancedReimbursementFilters,
  getAmountRangeError,
} = load(resolve(root, "src/features/reimbursements/filters.ts"));

test("fifth business day excludes national holidays and weekends across month/year boundaries", () => {
  assert.equal(getFifthBusinessDayOfNextMonth("2026-10-22"), "2026-11-09");
  assert.equal(getFifthBusinessDayOfNextMonth("2026-04-01"), "2026-05-08");
  assert.equal(getFifthBusinessDayOfNextMonth("2026-12-31"), "2027-01-08");
  assert.equal(getFifthBusinessDayOfNextMonth("2026-03-15"), "2026-04-08");
  assert.equal(getFifthBusinessDayOfNextMonth("2026-05-10"), "2026-06-05"); // Corpus Christi is optional, not national.
  assert.equal(getFifthBusinessDayOfNextMonth("2024-01-31"), "2024-02-07");
});

test("holiday calendar distinguishes Good Friday, optional days and historical Nov 20", () => {
  assert.equal(getBrazilNationalHolidays(2026).has("2026-04-03"), true);
  assert.equal(getBrazilNationalHolidays(2026).has("2026-02-17"), false);
  assert.equal(getBrazilNationalHolidays(2026).has("2026-06-04"), false);
  assert.equal(getBrazilNationalHolidays(2026).has("2026-11-20"), true);
  assert.equal(getBrazilNationalHolidays(2023).has("2023-11-20"), false);
  assert.equal(getBrazilNationalHolidays(2027).has("2027-03-26"), true);
});

test("invalid dates rejected; reference day respects Cuiaba around UTC month rollover", () => {
  for (const date of ["", "2026-02-30", "2026-13-01", "01/10/2026"])
    assert.equal(getFifthBusinessDayOfNextMonth(date), null);
  const today = getReimbursementToday(new Date("2026-11-01T02:00:00Z"));
  assert.equal(today, "2026-10-31");
  assert.equal(getFifthBusinessDayOfNextMonth(today), "2026-11-09");
});

test("new form suggests date; manual changes and editing existing records remain intact", () => {
  const form = createReimbursementForm("2026-10-22");
  assert.equal(form.expected_date, "2026-11-09");
  form.expected_date = "2026-11-20";
  assert.equal(form.expected_date, "2026-11-20");
  assert.equal(createReimbursementForm("2026-10-22").expected_date, "2026-11-09");
  const edited = reimbursementToFormValues({
    person_id: "p1",
    expected_date: "2026-12-12",
    status: "expected",
    expected_amount: 80,
    received_amount: 0,
  });
  assert.equal(edited.expected_date, "2026-12-12");
});

const rows = [
  {
    id: "late",
    person_id: "p1",
    category_id: "c1",
    description: "Mercado",
    notes: "Alimentação",
    expected_amount: 150,
    received_amount: 50,
    status: "expected",
    expected_date: "2026-10-01",
    is_recurring: false,
    credit_card_transaction_id: "t1",
  },
  {
    id: "today",
    person_id: "p2",
    category_id: null,
    description: "Assinatura",
    expected_amount: 50,
    received_amount: 0,
    status: "partial",
    expected_date: "2026-10-22",
    recurrence_parent_id: "series",
    credit_card_invoice_id: "i1",
  },
  {
    id: "week",
    person_id: "p1",
    category_id: "c1",
    description: "Grupo",
    expected_amount: 75,
    received_amount: 0,
    status: "expected",
    expected_date: "2026-10-29",
    is_recurring: true,
  },
  {
    id: "next",
    person_id: "p2",
    description: "Parcela",
    expected_amount: 100,
    received_amount: 0,
    status: "expected",
    expected_date: "2026-10-30",
  },
  {
    id: "undated",
    person_id: "p1",
    description: "Sem data",
    expected_amount: 100,
    received_amount: 0,
    status: "expected",
    expected_date: null,
  },
  {
    id: "forgiven",
    person_id: "p1",
    description: "Perdoado",
    expected_amount: 1000,
    received_amount: 0,
    status: "forgiven",
    expected_date: "2026-09-01",
  },
  {
    id: "settled",
    person_id: "p2",
    description: "Recebido",
    expected_amount: 100,
    received_amount: 100,
    status: "received",
    expected_date: "2026-10-01",
  },
];
const refs = {
  people: [
    { id: "p1", name: "Ana Família" },
    { id: "p2", name: "José" },
  ],
  categories: [{ id: "c1", name: "Cartão de crédito" }],
  cards: [{ id: "card", name: "Cartão Azul" }],
  transactions: [{ id: "t1", credit_card_id: "card" }],
  invoices: [{ id: "i1", credit_card_id: "card" }],
};
const base = {
  ...defaultAdvancedReimbursementFilters,
  search: "",
  personFilter: "all",
  statusFilter: "all",
  linkedFilter: "all",
  categoryFilter: "all",
};
const filter = (patch = {}) =>
  filterReimbursementRows(rows, { ...base, ...patch }, refs, "2026-10-22")
    .map((row) => row.id)
    .join(",");

test("overdue computed from dates and remaining balance, without relying on stored status", () => {
  assert.equal(filter({ maturityFilter: "late" }), "late");
  assert.equal(filter({ balanceFilter: "closed" }), "forgiven,settled");
  assert.equal(filter({ maturityFilter: "today" }), "today");
  assert.equal(filter({ maturityFilter: "week" }), "today,week");
  assert.equal(filter({ maturityFilter: "undated" }), "undated");
});

test("amount filters use remaining principal, include exact bounds and reject invalid ranges", () => {
  assert.equal(filter({ minAmount: "100", maxAmount: "100" }), "late,next,undated");
  assert.equal(filter({ minAmount: "101", maxAmount: "100" }), "");
  assert.equal(filter({ minAmount: "bad" }), "");
  assert.ok(getAmountRangeError("-1", ""));
  assert.ok(getAmountRangeError("100", "1"));
});

test("recurrence includes generated children and financial links include invoice-only associations", () => {
  assert.equal(filter({ recurrenceFilter: "recurring" }), "today,week");
  assert.equal(filter({ linkedFilter: "linked" }), "late,today");
  assert.equal(filter({ cardFilter: "card" }), "late,today");
  assert.equal(
    filter({ categoryFilter: "none", balanceFilter: "open" }),
    "today,next,undated",
  );
});

test("missing card reference data never reclassifies a known card association as no card", () => {
  const unknown = {
    ...rows[0],
    id: "missing-reference",
    credit_card_transaction_id: "unavailable-transaction",
    credit_card_invoice_id: "unavailable-invoice",
  };
  const result = filterReimbursementRows(
    [...rows, unknown],
    { ...base, cardFilter: "none" },
    refs,
    "2026-10-22",
  );
  assert.equal(
    result.some((row) => row.id === unknown.id),
    false,
  );
});

test("search is accent-insensitive and includes person, category, notes and card; filters intersect", () => {
  assert.equal(filter({ search: "jose", balanceFilter: "open" }), "today,next");
  assert.equal(filter({ search: "alimentacao" }), "late");
  assert.equal(filter({ search: "cartao azul" }), "late,today");
  assert.equal(
    filter({
      personFilter: "p1",
      categoryFilter: "c1",
      minAmount: "75",
      maxAmount: "100",
      maturityFilter: "week",
    }),
    "week",
  );
});
