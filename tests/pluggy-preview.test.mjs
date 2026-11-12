import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = fileURLToPath(new URL("../", import.meta.url));
function harness(overrides = {}, env = {}, globals = {}) {
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const mod = { exports: {} };
    cache.set(path, mod.exports);
    const code = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const scoped = (name) =>
      name in overrides
        ? overrides[name]
        : name === "server-only"
          ? {}
          : name.startsWith("node:")
            ? require(name)
            : load(
                resolve(
                  name.startsWith("@/") ? resolve(root, "src") : dirname(path),
                  `${name.startsWith("@/") ? name.slice(2) : name}.ts`,
                ),
              );
    vm.runInNewContext(`(function(require,module,exports){${code}\n})`, {
      URL,
      URLSearchParams,
      Response,
      Request,
      Headers,
      AbortSignal,
      Buffer,
      structuredClone,
      process: { env, cwd: () => root },
      fetch: async () => {
        throw new Error("Unexpected network in test.");
      },
      ...globals,
    })(scoped, mod, mod.exports);
    return mod.exports;
  }
  return (path) => load(resolve(root, path));
}
const load = harness();
const { createPluggyReader } = load("src/features/pluggy/client.ts");
const { buildPluggyPreview } = load("src/features/pluggy/preview.ts");
const {
  movementDisposition,
  inboxSummary,
  candidateConfidence,
  inboxComposition,
  inboxPeriodFromParams,
} = load("src/features/pluggy/inbox.ts");
const { organizzeHistory } = load("src/features/organizze/history.ts");
const owner = "11111111-1111-4111-8111-111111111111";
const itemId = "22222222-2222-4222-8222-222222222222";
const bank = "33333333-3333-4333-8333-333333333333";
const card = "44444444-4444-4444-8444-444444444444";
const tx = "55555555-5555-4555-8555-555555555555";
const tx2 = "66666666-6666-4666-8666-666666666666";
const period = { start: "2026-09-01", end: "2026-09-30" };
const config = {
  clientId: "FIXTURE_ID",
  clientSecret: "FIXTURE_SECRET",
  itemId,
  ownerId: owner,
};
const paged = (results, total = results.length, totalPages = 1, page = 1) => ({
  results,
  total,
  totalPages,
  page,
});
const accounts = [
  {
    id: bank,
    itemId,
    type: "BANK",
    name: "Conta sintética",
    currencyCode: "BRL",
    taxNumber: "FIXTURE_PRIVATE",
    number: "PRIVATE_NUMBER",
    balance: 2,
  },
  {
    id: card,
    itemId,
    type: "CREDIT",
    name: "Cartão sintético",
    currencyCode: "BRL",
    creditData: { balanceDueDate: "2026-09-30" },
  },
];
const movement = (id = tx, accountId = bank, amount = -12, type = "DEBIT") => ({
  id,
  accountId,
  amount,
  type,
  currencyCode: "BRL",
  date: "2026-09-03T00:00:00.000Z",
  status: "POSTED",
  description: "Compra sintética",
  category: "Groceries",
  providerId: "bank-original-id",
  creditCardMetadata: null,
});
function transport(overrides = {}) {
  const calls = [];
  return {
    calls,
    fetch: async (input, options) => {
      const url = new URL(input);
      calls.push({ url, options });
      assert.equal(url.origin, "https://api.pluggy.ai");
      assert.equal(options.redirect, "error");
      assert.equal(options.cache, "no-store");
      if (url.pathname === "/auth") {
        assert.equal(options.method, "POST");
        assert.equal(options.headers["X-API-KEY"], undefined);
        return Response.json({ apiKey: "FIXTURE_TOKEN" });
      }
      assert.equal(options.method, "GET");
      assert.equal(options.headers["X-API-KEY"], "FIXTURE_TOKEN");
      if (overrides[url.pathname]) return overrides[url.pathname](url, options);
      if (url.pathname === `/items/${itemId}`)
        return Response.json({
          id: itemId,
          status: "UPDATED",
          executionStatus: "SUCCESS",
          connector: { name: "MeuPluggy", isSandbox: false },
          oauthRedirectUri: "PRIVATE_OAUTH",
          error: { credentials: "PRIVATE_ERROR" },
        });
      if (url.pathname === "/accounts") return Response.json(paged(accounts));
      if (url.pathname === "/v2/transactions")
        return Response.json({
          results: [
            movement(
              url.searchParams.get("accountId") === bank ? tx : tx2,
              url.searchParams.get("accountId"),
              url.searchParams.get("accountId") === bank ? -12 : 12,
            ),
          ],
          next: null,
        });
      if (url.pathname === "/bills")
        return Response.json(
          paged([
            {
              id: tx,
              dueDate: "2026-09-30",
              totalAmount: 12,
              totalAmountCurrencyCode: "BRL",
              payments: [{ id: "payment-original", amount: 12 }],
            },
          ]),
        );
      throw new Error("Unexpected endpoint");
    },
  };
}
const refs = {
  ownerId: owner,
  categories: [],
  cards: [],
  invoices: [],
  movements: [
    {
      id: "manual-original",
      table: "accounts_payable",
      amountCents: 1200,
      date: "2026-09-03",
      description: "Compra sintética",
      ownership: "family",
      linkedTo: "Reembolso",
      createdOrigin: "manual",
    },
  ],
};

async function inboxFixture(overrides = {}, review = {}) {
  const snapshot = await createPluggyReader(config, transport().fetch).sync(period);
  const row = buildPluggyPreview(snapshot, refs, null).movements[0];
  return {
    ...row,
    candidates: [],
    bank: "Banco sintético",
    institutionId: "nubank",
    review: {
      state: "new",
      categoryId: null,
      ownership: null,
      reviewed: false,
      ...review,
    },
    classification: { categoryId: null, ownership: null, ambiguous: false, ruleIds: [] },
    selectedCategoryId: null,
    selectedOwnership: null,
    changedAfterLink: false,
    ...overrides,
  };
}

test("financial inbox keeps settled purchases and income separate from unsafe movements", async () => {
  const row = await inboxFixture();
  assert.equal(movementDisposition(row).section, "inbox");
  assert.equal(movementDisposition(row).canPrepare, true);
  assert.equal(movementDisposition({ ...row, kind: "income" }).type, "Receita / crédito");
  for (const operationType of ["PIX", "TED", "DOC", "TEF", "TRANSFER"]) {
    const result = movementDisposition({ ...row, operationType });
    assert.equal(result.section, "pending");
    assert.equal(result.automatic, false);
    assert.equal(result.canPrepare, false);
  }
  assert.equal(
    movementDisposition({ ...row, requiresPaymentReview: true }).section,
    "pending",
  );
  assert.equal(
    movementDisposition({ ...row, description: "Pagamento de fatura" }).section,
    "pending",
  );
  assert.equal(movementDisposition({ ...row, bankStatus: "PENDING" }).section, "pending");
  assert.equal(movementDisposition({ ...row, kind: "card_credit" }).section, "pending");
  for (const change of [
    { currency: "USD" },
    { amount: null },
    { amount: 0 },
    { date: "" },
    { kind: "unknown" },
  ])
    assert.equal(movementDisposition({ ...row, ...change }).section, "pending");
  assert.equal(row.selectedOwnership, null);
  const salary = {
    ...row,
    kind: "income",
    direction: "CREDIT",
    accountType: "BANK",
    operationType: "PORTABILIDADE_SALARIO",
    requiresPaymentReview: true,
  };
  assert.equal(movementDisposition(salary).section, "inbox");
  assert.equal(salary.selectedOwnership, null);
  assert.equal(
    movementDisposition({ ...salary, operationType: "PIX" }).section,
    "pending",
  );
});

test("same bank/date/value outranks text similarity, and different banks or account types are excluded", async () => {
  const { identifyBank } = load("src/features/imports/bank-identity.ts");
  assert.equal(identifyBank("Conta Mercadopago"), "mercado_pago");
  assert.equal(identifyBank("Cartão XP Visa Infinite"), "xp");
  assert.equal(identifyBank("XP ou Nubank"), null);
  const snapshot = await createPluggyReader(config, transport().fetch).sync(period);
  const references = {
    ...refs,
    cards: [{ id: "card-hub", name: "XP Visa Infinite", issuer: "XP" }],
    movements: [
      { ...refs.movements[0], id: "other-bank", institutionId: "xp" },
      {
        ...refs.movements[0],
        id: "same-bank",
        institutionId: "nubank",
        description: "Texto diferente",
      },
      {
        ...refs.movements[0],
        id: "card-vs-bank",
        table: "credit_card_transactions",
        cardId: "card-hub",
      },
    ],
  };
  const row = buildPluggyPreview(snapshot, references, null).movements[0];
  assert.equal(row.candidates.length, 1);
  assert.equal(row.candidates[0].id, "same-bank");
  assert.equal(row.candidates[0].confidence.score, 90);
  assert.equal(row.candidates[0].confidence.label, "Alta");
  assert.equal(row.candidates[0].confidence.bankMatch, true);
});

test("Organizze bank references suggest a compatible hierarchy and preserve tags without assigning ownership", async () => {
  const snapshot = await createPluggyReader(config, transport().fetch).sync(period);
  const references = {
    ...refs,
    movements: [],
    categories: [
      { id: "food", name: "Alimentação", type: "expense", parent_category_id: null },
    ],
  };
  const historical = {
    movements: [
      {
        sourceKey: "transaction:1",
        description: "Outra descrição",
        date: "2026-09-03",
        kind: "expense",
        amountCents: -1200,
        categoryId: "source-category",
        category: "Alimentação",
        categoryPath: "Alimentação",
        tags: ["Viagem"],
        account: "Conta Nubank",
        accountType: "BANK",
      },
    ],
    categories: [],
    tags: [],
    total: 1,
  };
  const row = buildPluggyPreview(snapshot, references, historical).movements[0];
  assert.equal(row.historical[0].confidence.score, 90);
  assert.equal(row.historySuggestion.categoryId, "food");
  assert.equal(row.historySuggestion.tags[0], "Viagem");
  assert.equal(row.ownership, null);
  assert.equal(row.kind, "expense");
  assert.equal(row.candidates.length, 0);
  historical.movements[0].account = "Conta XP";
  assert.equal(
    buildPluggyPreview(snapshot, references, historical).movements[0].historical.length,
    0,
  );
});

test("pagination preference persists per user, defaults old settings and rejects invalid modes", () => {
  const entries = new Map(),
    events = [];
  const window = {
    localStorage: {
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => entries.set(key, value),
      removeItem: (key) => entries.delete(key),
    },
    dispatchEvent: (event) => events.push(event),
  };
  const preferences = harness(
    {},
    {},
    {
      window,
      CustomEvent: class {
        constructor(type, options) {
          this.type = type;
          this.detail = options.detail;
        }
      },
    },
  )("src/features/settings/system-preferences.ts");
  assert.equal(preferences.loadSystemPreferences("alpha").paginationScroll, "top");
  preferences.saveSystemPreferences("alpha", {
    ...preferences.defaultSystemPreferences,
    paginationScroll: "bottom",
  });
  assert.equal(preferences.loadSystemPreferences("alpha").paginationScroll, "bottom");
  assert.equal(preferences.loadSystemPreferences("beta").paginationScroll, "top");
  preferences.saveSystemPreferences("alpha", {
    ...preferences.defaultSystemPreferences,
    paginationScroll: "bad-mode",
  });
  assert.equal(preferences.loadSystemPreferences("alpha").paginationScroll, "top");
  assert.equal(events[0].type, "hubvz:preferences-updated");
});

test("composition is disjoint, excludes ignored/linked items and counts only the supplied selection", async () => {
  const base = await inboxFixture({ accountType: "BANK", direction: "DEBIT" });
  const rows = [
    base,
    { ...base, kind: "income", direction: "CREDIT" },
    { ...base, accountType: "CREDIT" },
    { ...base, accountType: "CREDIT", direction: "CREDIT", kind: "card_credit" },
    { ...base, kind: "invoice_payment" },
    { ...base, review: { ...base.review, state: "reconciled" } },
  ];
  const result = inboxComposition(rows);
  assert.equal(result.expense, 1);
  assert.equal(result.income, 1);
  assert.equal(result.card, 1);
  assert.equal(result.review, 1);
  assert.equal(result.total, 4);
  assert.equal(result.ignored, 1);
  assert.equal(result.linked, 1);
  assert.equal(
    result.expense + result.income + result.card + result.review,
    result.total,
  );
  assert.equal(inboxComposition([rows[1]]).total, 1);
  assert.equal(inboxComposition([]).total, 0);
});

test("Dashboard period links validate dates and the financial inbox has one active navigation item", () => {
  assert.equal(
    inboxPeriodFromParams({ from: "2026-02-30", to: "2026-03-01" }),
    undefined,
  );
  assert.equal(
    inboxPeriodFromParams({ from: ["2026-11-01"], to: "2026-11-09" }),
    undefined,
  );
  assert.equal(
    inboxPeriodFromParams({ from: "2026-12-01", to: "2026-11-01" }),
    undefined,
  );
  assert.equal(inboxPeriodFromParams({}), undefined);
  assert.equal(
    inboxPeriodFromParams({ from: "2026-11-01", to: "2026-11-09" }).start,
    "2026-11-01",
  );
  assert.equal(inboxPeriodFromParams({ from: "", to: "" }).end, "");
  const nav = load("src/lib/navigation.ts");
  assert.equal(nav.getActiveNavigationGroup("/dashboard/imports/pluggy").id, "financial");
  assert.equal(
    nav.navigationItems.filter((item) =>
      nav.isNavigationItemActive(item, "/dashboard/imports/pluggy"),
    ).length,
    1,
  );
  assert.equal(nav.getActiveNavigationGroup("/dashboard/imports/organizze").id, "system");
  assert.equal(nav.getActiveNavigationGroup("/dashboard").id, "financial");
});

test("only explicit non-expense operations are ignored automatically, without changing the review", async () => {
  const base = await inboxFixture();
  for (const change of [
    { kind: "invoice_payment" },
    ...[
      "PIX_INTERNO",
      "OWN_TRANSFER",
      "ESTORNO_TECNICO",
      "INFORMATIONAL",
      "APLICACAO",
      "RESGATE",
      "INVESTMENT_PURCHASE",
    ].map((operationType) => ({ operationType })),
  ]) {
    const row = { ...base, ...change };
    const original = JSON.stringify(row);
    const result = movementDisposition(row);
    assert.equal(result.section, "ignored");
    assert.equal(result.automatic, true);
    assert.equal(result.canPrepare, false);
    assert.equal(JSON.stringify(row), original);
  }
  assert.equal(
    movementDisposition({ ...base, operationType: "ESTORNO" }).automatic,
    false,
  );
  const manual = await inboxFixture({}, { state: "historical", reviewed: true });
  assert.equal(movementDisposition(manual).section, "ignored");
  assert.equal(movementDisposition(manual).automatic, false);
  const postponed = await inboxFixture({}, { state: "pending", reviewed: true });
  assert.equal(movementDisposition(postponed).section, "pending");
  assert.equal(
    movementDisposition({ ...postponed, kind: "invoice_payment" }).section,
    "pending",
  );
});

test("inbox counts and comparisons preserve linked items and never infer ownership", async () => {
  const row = await inboxFixture();
  const snapshot = await createPluggyReader(config, transport().fetch).sync(period);
  const candidate = buildPluggyPreview(snapshot, refs, null).movements[0].candidates[0];
  assert.equal(candidate.amount, 12);
  assert.equal(candidate.date, "2026-09-03");
  assert.equal(candidateConfidence(row, candidate), "Baixa");
  assert.equal(candidate.confidence.bankMatch, null);
  assert.equal(candidateConfidence(row, { ...candidate, description: "Outra" }), "Baixa");
  assert.equal(
    candidateConfidence(row, { ...candidate, description: "Outra", date: "2026-09-06" }),
    "Baixa",
  );
  const match = { ...row, candidates: [candidate] };
  const linked = await inboxFixture(
    { candidates: [candidate], changedAfterLink: true },
    { state: "reconciled", targetId: "existing", reviewed: true },
  );
  const rows = [
    row,
    match,
    linked,
    { ...row, bankStatus: "PENDING" },
    { ...row, kind: "invoice_payment" },
  ];
  const counts = inboxSummary(rows);
  assert.equal(counts.inbox, 1);
  assert.equal(counts.reconciliation, 2);
  assert.equal(counts.pending, 1);
  assert.equal(counts.ignored, 1);
  assert.equal(counts.matches, 1);
  assert.equal(counts.new, 1);
  assert.equal(counts.classification, 2);
  assert.equal(counts.automatic, 1);
  assert.equal(movementDisposition(linked).label, "Origem alterada");
  assert.equal(row.selectedOwnership, null);
});

test("personal proxy uses only authentication POST and scoped GETs; keys stay server-side", async () => {
  const api = transport();
  const reader = createPluggyReader(config, api.fetch);
  const snapshot = await reader.sync(period);
  await reader.sync(period);
  assert.equal(api.calls.filter((call) => call.options.method === "POST").length, 1);
  assert.equal(snapshot.accounts.length, 2);
  assert.equal(snapshot.transactions.length, 2);
  assert.equal(snapshot.bills.length, 1);
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.transactions[0].providerId, "bank-original-id");
  for (const secret of [
    "FIXTURE_TOKEN",
    "FIXTURE_SECRET",
    "PRIVATE_OAUTH",
    "PRIVATE_ERROR",
  ])
    assert.equal(JSON.stringify(snapshot).includes(secret), false);
  const preview = buildPluggyPreview(snapshot, refs, null);
  assert.equal(JSON.stringify(preview).includes("PRIVATE_NUMBER"), false);
  assert.equal(JSON.stringify(preview).includes("FIXTURE_PRIVATE"), false);
});
test("v2 cursor is followed as an opaque query, not embedded inside after", async () => {
  const cursor = `?accountId=${bank}&after=opaque%2B%2F%3D`;
  const api = transport({
    "/accounts": () => Response.json(paged([accounts[0]])),
    "/v2/transactions": (url) =>
      Response.json(
        url.searchParams.has("after")
          ? { results: [movement(tx2)], next: null }
          : { results: [movement()], next: cursor },
      ),
  });
  const snapshot = await createPluggyReader(config, api.fetch).sync(period);
  assert.equal(snapshot.transactions.length, 2);
  assert.equal(api.calls.at(-1).url.search, cursor);
});
for (const next of [
  "https://evil.invalid/?after=x",
  `?accountId=${card}&after=x`,
  `?accountId=${bank}&accountId=${card}&after=x`,
  `?accountId=${bank}&after=x&dateFrom=2020-01-01`,
  `?accountId=${bank}&after=x&url=https://evil.invalid`,
])
  test(`unsafe cursor blocked: ${next.slice(0, 28)}`, async () => {
    const api = transport({
      "/accounts": () => Response.json(paged([accounts[0]])),
      "/v2/transactions": () => Response.json({ results: [movement()], next }),
    });
    await assert.rejects(
      createPluggyReader(config, api.fetch).sync(period),
      (error) => error.code === "unsafe_cursor",
    );
  });
test("repeated cursor/IDs cannot silently masquerade as complete", async () => {
  const api = transport({
    "/accounts": () => Response.json(paged([accounts[0]])),
    "/v2/transactions": () =>
      Response.json({ results: [movement()], next: `?accountId=${bank}&after=repeat` }),
  });
  await assert.rejects(createPluggyReader(config, api.fetch).sync(period), (error) =>
    ["transaction_scope_or_id", "cursor_cycle_or_limit"].includes(error.code),
  );
});
test("numbered pagination reads every account page and rejects count changes", async () => {
  const api = transport({
    "/accounts": (url) =>
      Response.json(
        paged(
          [accounts[Number(url.searchParams.get("page")) - 1]],
          2,
          2,
          Number(url.searchParams.get("page")),
        ),
      ),
  });
  assert.equal(
    (await createPluggyReader(config, api.fetch).sync(period)).accounts.length,
    2,
  );
  const changed = transport({
    "/accounts": (url) =>
      Response.json(
        paged(
          [accounts[0]],
          Number(url.searchParams.get("page")) === 1 ? 2 : 3,
          2,
          Number(url.searchParams.get("page")),
        ),
      ),
  });
  await assert.rejects(
    createPluggyReader(config, changed.fetch).sync(period),
    (error) => error.code === "pagination_changed",
  );
});
test("incomplete counts, foreign accounts and foreign transactions are blocked", async () => {
  for (const overrides of [
    { "/accounts": () => Response.json(paged([accounts[0]], 2)) },
    { "/accounts": () => Response.json(paged([{ ...accounts[0], itemId: owner }])) },
    {
      "/v2/transactions": () =>
        Response.json({ results: [movement(tx, owner)], next: null }),
    },
  ])
    await assert.rejects(
      createPluggyReader(config, transport(overrides).fetch).sync(period),
    );
});
test("unsupported optional bills warn, but authentication and rate limits do not become empty success", async () => {
  const optional = transport({ "/bills": () => new Response(null, { status: 404 }) });
  const snapshot = await createPluggyReader(config, optional.fetch).sync(period);
  assert.equal(snapshot.transactions.length, 2);
  assert.equal(snapshot.warnings.length, 1);
  for (const status of [401, 429]) {
    const api = transport({
      "/bills": () => new Response("PRIVATE upstream body", { status }),
    });
    await assert.rejects(
      createPluggyReader(config, api.fetch).sync(period),
      (error) =>
        error.code === `upstream_${status}` && !error.message.includes("PRIVATE"),
    );
  }
});

test("secondary product 403 is reported without bypass, while denied proxy access stops all data reads", async () => {
  const optional = transport({ "/bills": () => new Response(null, { status: 403 }) });
  const snapshot = await createPluggyReader(config, optional.fetch).sync(period);
  assert.equal(snapshot.transactions.length, 2);
  assert.equal(snapshot.unavailable[0].code, "upstream_403");
  assert.equal(snapshot.bills.length, 0);
  const denied = transport({
    [`/items/${itemId}`]: () => new Response(null, { status: 403 }),
  });
  await assert.rejects(
    createPluggyReader(config, denied.fetch).sync(period),
    (error) => error.code === "upstream_403",
  );
  assert.equal(
    denied.calls.some((call) => call.url.pathname === "/accounts"),
    false,
  );
});
test("only real Meu Pluggy proxy is accepted and invalid config never sends a request", async () => {
  for (const connector of [
    { name: "Nubank", isSandbox: false },
    { name: "MeuPluggy", isSandbox: true },
  ]) {
    const api = transport({
      [`/items/${itemId}`]: () => Response.json({ id: itemId, connector }),
    });
    await assert.rejects(
      createPluggyReader(config, api.fetch).sync(period),
      (error) => error.code === "not_meu_pluggy_proxy",
    );
    assert.equal(api.calls.length, 2);
  }
  assert.throws(
    () => createPluggyReader({ ...config, itemId: "../foreign" }),
    (error) => error.code === "not_configured",
  );
});
test("Organizze archive retains category hierarchy/tags/IDs and makes no insert plan", () => {
  const make = (entity, id, raw) => ({
    entity,
    sourceId: String(id),
    key: `${entity}:${id}`,
    raw: { id, ...raw },
    sources: [
      {
        task: { path: `/${entity === "category" ? "categories" : "transactions"}` },
        raw: { id, ...raw },
      },
    ],
  });
  const snapshot = {
    version: 1,
    source: "organizze",
    ownerId: owner,
    period,
    startedAt: "2026-10-22",
    tasks: [],
    receipts: [],
    errors: [],
    rejected: [],
    records: [
      make("category", 1, { name: "Casa", kind: "expenses" }),
      make("category", 2, { name: "Mercado", parent_id: 1, kind: "expenses" }),
      make("transaction", 3, {
        amount_cents: -1200,
        description: "Compra sintética",
        date: "2026-09-03",
        category_id: 2,
        tags: [{ name: "Mãe" }, "Referência"],
      }),
    ],
  };
  const before = JSON.stringify(snapshot);
  const history = organizzeHistory(snapshot);
  assert.equal(history.categories[1].parentId, "1");
  assert.equal(history.movements[0].sourceKey, "transaction:3");
  assert.equal(history.movements[0].category, "Mercado");
  assert.equal(history.tags.length, 2);
  assert.equal(JSON.stringify(snapshot), before);
  assert.equal(history.operations, undefined);
});
test("manual suggestions and historical categories do not assign ownership, link or create reimbursements", async () => {
  const snapshot = await createPluggyReader(config, transport().fetch).sync(period);
  const history = {
    total: 1,
    categories: [],
    tags: ["Mãe"],
    movements: [
      {
        sourceKey: "transaction:99",
        kind: "expense",
        amountCents: -1200,
        date: "2026-09-04",
        category: "Categoria histórica",
        categoryId: "7",
        tags: ["Mãe"],
        account: "Conta antiga",
      },
    ],
  };
  const before = JSON.stringify({ snapshot, refs, history });
  const result = buildPluggyPreview(snapshot, refs, history);
  assert.equal(result.summary.financialWrites, 0);
  assert.equal(result.movements[0].ownership, null);
  assert.equal(result.movements[0].candidates[0].id, "manual-original");
  assert.equal(result.movements[0].candidates[0].linkedTo, "Reembolso");
  assert.equal(result.movements[0].category, "Groceries");
  assert.equal(result.movements[0].historical[0].category, "Categoria histórica");
  assert.equal(JSON.stringify({ snapshot, refs, history }), before);
});
test("card credits are not income; pending/foreign currency do not produce confident matches", async () => {
  const snapshot = await createPluggyReader(config, transport().fetch).sync(period);
  snapshot.transactions = [
    movement(tx, card, -12, "CREDIT"),
    { ...movement(tx2), status: "PENDING" },
    { ...movement(tx2), currencyCode: "USD" },
  ];
  const result = buildPluggyPreview(snapshot, refs, null);
  assert.equal(result.movements[0].kind, "card_credit");
  assert.equal(
    result.movements.every((row) => !row.candidates.length && row.ownership === null),
    true,
  );
});

function routeHarness({
  authenticated = true,
  correctOwner = true,
  env = {},
  backup = null,
} = {}) {
  const client = {
    auth: {
      getUser: async () => ({
        data: { user: authenticated ? { id: correctOwner ? owner : bank } : null },
        error: null,
      }),
    },
  };
  const calls = { sync: 0, saves: 0, references: 0 };
  const loader = harness(
    {
      "@/lib/supabase/server": { createClient: async () => client },
      "@/features/pluggy/backup": {
        latestPluggyBackup: async () => backup,
        savePluggyBackup: async () => {
          calls.saves++;
          return "fixture-backup";
        },
      },
      "@/features/pluggy/client": {
        PluggyError: class extends Error {},
        configuredPluggyReader: () => ({
          sync: async () => {
            calls.sync++;
            return backup.snapshot;
          },
        }),
      },
      "@/features/organizze/backup": { latestOrganizzeBackup: async () => null },
      "@/features/organizze/references": {
        loadOrganizzeReferences: async () => {
          calls.references++;
          return refs;
        },
      },
    },
    { PLUGGY_HUB_USER_ID: owner, ...env },
  );
  return { route: loader("src/app/api/pluggy/route.ts"), calls };
}
const request = (body, origin = "http://localhost:3190") =>
  new Request("http://localhost:3190/api/pluggy", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
test("route rejects unauthenticated/other-owner/CSRF/import requests before upstream or writes", async () => {
  for (const options of [{ authenticated: false }, { correctOwner: false }]) {
    const { route, calls } = routeHarness(options);
    assert.equal(
      (await route.POST(request({ action: "preview", period, nubankConfirmed: true })))
        .status,
      401,
    );
    assert.equal(calls.sync, 0);
  }
  const { route, calls } = routeHarness();
  assert.equal(
    (
      await route.POST(
        request(
          { action: "preview", period, nubankConfirmed: true },
          "https://foreign.invalid",
        ),
      )
    ).status,
    403,
  );
  for (const body of [
    { action: "confirm", period, nubankConfirmed: true },
    { action: "preview", period, nubankConfirmed: false },
    { action: "preview", period, nubankConfirmed: true, itemId: bank },
  ])
    assert.equal((await route.POST(request(body))).status, 400);
  assert.equal(calls.sync, 0);
  assert.equal(calls.saves, 0);
});
test("status exposes missing names only; preview saves local snapshot and never has a finance write client", async () => {
  const snapshot = await createPluggyReader(config, transport().fetch).sync(period);
  const { route, calls } = routeHarness({
    backup: { snapshot, backupId: "fixture" },
    env: {
      PLUGGY_CLIENT_ID: "FIXTURE_PRIVATE_ID",
      PLUGGY_CLIENT_SECRET: "FIXTURE_PRIVATE_SECRET",
      PLUGGY_NUBANK_ITEM_ID: itemId,
    },
  });
  const status = await route.GET(new Request("http://localhost/api/pluggy"));
  assert.equal((await status.json()).configured, true);
  const result = await route.POST(
    request({ action: "preview", period, nubankConfirmed: true }),
  );
  assert.equal(result.status, 200);
  assert.equal(calls.sync, 1);
  assert.equal(calls.saves, 1);
  const body = await result.json();
  assert.equal(body.preview.summary.financialWrites, 0);
  assert.equal(JSON.stringify(body).includes("FIXTURE_PRIVATE"), false);
});
test("private backup roundtrip checks owner, connection, completeness and original records", async () => {
  const files = new Map();
  const fs = {
    mkdir: async () => {},
    writeFile: async (path, text, options) => {
      assert.equal(options.flag, "wx");
      files.set(path, text);
    },
    readdir: async () => [
      ...new Set([...files.keys()].map((path) => path.split(/[\\/]/).at(-2))),
    ],
    readFile: async (path) => files.get(path),
    stat: async (path) => ({ size: files.get(path).length }),
  };
  const backup = harness({ "node:fs/promises": fs })("src/features/pluggy/backup.ts");
  const snapshot = await createPluggyReader(config, transport().fetch).sync(period);
  await backup.savePluggyBackup(snapshot);
  const loaded = await backup.latestPluggyBackup(owner, itemId);
  assert.equal(JSON.stringify(loaded.snapshot), JSON.stringify(snapshot));
  assert.equal(await backup.latestPluggyBackup(bank, itemId), null);
  assert.equal(await backup.latestPluggyBackup(owner, bank), null);
  assert.throws(() =>
    backup.validatePluggySnapshot({ ...snapshot, complete: false }, owner, itemId),
  );
});

test("bill pagination preserves original payment IDs and every page", async () => {
  const api = transport({
    "/bills": (url) => {
      const page = Number(url.searchParams.get("page"));
      return Response.json(
        paged(
          [
            {
              id: page === 1 ? tx : tx2,
              payments: [{ id: `payment-${page}`, amount: 12 }],
            },
          ],
          2,
          2,
          page,
        ),
      );
    },
  });
  const snapshot = await createPluggyReader(config, api.fetch).sync(period);
  assert.equal(snapshot.bills.length, 2);
  assert.equal(snapshot.bills[1].raw.payments[0].id, "payment-2");
  assert.equal(api.calls.filter((call) => call.url.pathname === "/bills").length, 2);
});

test("one rejected API key is renewed once and successful reads resume", async () => {
  let requests = 0;
  const api = transport({
    [`/items/${itemId}`]: () =>
      ++requests === 1
        ? new Response(null, { status: 401 })
        : Response.json({
            id: itemId,
            status: "UPDATED",
            executionStatus: "SUCCESS",
            connector: { name: "Meu Pluggy", isSandbox: false },
          }),
  });
  const snapshot = await createPluggyReader(config, api.fetch).sync(period);
  assert.equal(snapshot.complete, true);
  assert.equal(api.calls.filter((call) => call.url.pathname === "/auth").length, 2);
});

test("explicit invoice payment/refund operations do not become a new expense or income", async () => {
  const snapshot = await createPluggyReader(config, transport().fetch).sync(period);
  snapshot.transactions = [
    { ...movement(), operationType: "PAGAMENTO_FATURA" },
    { ...movement(tx2, card, 12), operationType: "ESTORNO" },
  ];
  const preview = buildPluggyPreview(snapshot, refs, null);
  assert.equal(preview.movements[0].kind, "invoice_payment");
  assert.equal(preview.movements[1].kind, "card_credit");
  assert.equal(
    preview.movements.every((row) => !row.candidates.length && row.ownership === null),
    true,
  );
  assert.equal(preview.summary.financialWrites, 0);
});

test("history endpoint requires owner and can read the archive without finance tables or RPC", async () => {
  const snapshot = {
    version: 1,
    source: "organizze",
    ownerId: owner,
    period,
    startedAt: "2026-10-22",
    tasks: [],
    receipts: [],
    errors: [],
    rejected: [],
    records: [],
  };
  let reads = 0;
  for (const userId of [null, bank, owner]) {
    const route = harness(
      {
        "@/lib/supabase/server": {
          createClient: async () => ({
            auth: {
              getUser: async () => ({
                data: { user: userId ? { id: userId } : null },
                error: null,
              }),
            },
          }),
        },
        "@/features/organizze/backup": {
          latestOrganizzeBackup: async () => {
            reads++;
            return { snapshot };
          },
        },
      },
      { ORGANIZZE_HUB_USER_ID: owner },
    )("src/app/api/organizze/history/route.ts");
    const response = await route.GET();
    assert.equal(response.status, userId === owner ? 200 : 401);
  }
  assert.equal(reads, 1);
});

test("five institutions use one private application and reject reused/malformed proxy IDs", () => {
  const { pluggyConfig } = load("src/features/pluggy/config.ts");
  const env = {
    PLUGGY_CLIENT_ID: "fixture",
    PLUGGY_CLIENT_SECRET: "private",
    ORGANIZZE_HUB_USER_ID: owner,
    PLUGGY_NUBANK_ITEM_ID: itemId,
    PLUGGY_XP_ITEM_ID: bank,
    PLUGGY_SICREDI_ITEM_ID: card,
    PLUGGY_CAIXA_ITEM_ID: tx,
    PLUGGY_MERCADO_PAGO_ITEM_ID: tx2,
  };
  const settings = pluggyConfig(env);
  assert.equal(settings.items.length, 5);
  assert.equal(
    settings.items.every((bank) => bank.valid),
    true,
  );
  assert.equal(settings.ownerId, owner);
  const duplicated = pluggyConfig({ ...env, PLUGGY_XP_ITEM_ID: itemId });
  assert.equal(duplicated.items[0].valid, false);
  assert.equal(duplicated.items[1].valid, false);
  assert.equal(
    pluggyConfig({ ...env, PLUGGY_SICREDI_ITEM_ID: "../invalid" }).items[2].valid,
    false,
  );
});

test("five-bank fixtures collect independent products and share a single auth key", async () => {
  const { institutions } = load("src/features/pluggy/types.ts");
  const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
  const shared = { apiKey: "", expiresAt: 0, authenticating: null };
  let authCount = 0;
  const snapshots = [];
  for (let index = 0; index < institutions.length; index++) {
    const proxy = uuid(index + 1),
      account = uuid(index + 101),
      investment = uuid(index + 201);
    const read = async (input, options) => {
      const url = new URL(input);
      if (url.pathname === "/auth") {
        authCount++;
        assert.equal(options.method, "POST");
        return Response.json({ apiKey: "PRIVATE_SHARED_KEY" });
      }
      assert.equal(options.method, "GET");
      assert.equal(options.headers["X-API-KEY"], "PRIVATE_SHARED_KEY");
      if (url.pathname.startsWith("/items/"))
        return Response.json({
          id: proxy,
          status: "UPDATED",
          executionStatus: "SUCCESS",
          connector: { name: "MeuPluggy", isSandbox: false },
        });
      if (url.pathname === "/accounts")
        return Response.json(
          paged([
            {
              id: account,
              itemId: proxy,
              name: "Fixture",
              type: index === 0 ? "CREDIT" : "BANK",
              currencyCode: "BRL",
            },
          ]),
        );
      if (url.pathname === "/v2/transactions")
        return Response.json({
          results: [movement(uuid(index + 301), account, index === 0 ? 12 : -12)],
          next: null,
        });
      if (url.pathname === "/bills")
        return Response.json(paged([{ id: uuid(401), payments: [] }]));
      if (url.pathname === "/investments")
        return index === 1
          ? Response.json(
              paged([
                {
                  id: investment,
                  itemId: proxy,
                  name: "Position fixture",
                  balance: 42,
                  type: "EQUITY",
                  transactions: [{ id: uuid(501), type: "BUY", amount: 20 }],
                },
              ]),
            )
          : new Response(null, { status: 404 });
      if (url.pathname === `/investments/${investment}/transactions`)
        return Response.json(
          paged([
            { id: uuid(501), type: "BUY", amount: 20 },
            { id: uuid(502), type: "SELL", amount: 22 },
          ]),
        );
      throw new Error("Unapproved endpoint");
    };
    snapshots.push(
      await createPluggyReader(
        {
          ...config,
          itemId: proxy,
          institution: institutions[index].id,
          includeInvestments: true,
        },
        read,
        shared,
      ).sync(period),
    );
  }
  assert.equal(authCount, 1);
  assert.equal(
    snapshots.every(
      (snapshot) => snapshot.complete && snapshot.transactions.length === 1,
    ),
    true,
  );
  assert.equal(snapshots[0].bills.length, 1);
  assert.equal(snapshots[1].investments.length, 1);
  assert.equal(snapshots[1].investmentTransactions.length, 2);
  assert.equal(snapshots[2].unavailable[0].resource, "investments");
  assert.equal(JSON.stringify(snapshots).includes("PRIVATE_SHARED_KEY"), false);
});

test("investment pagination and parent scopes are validated independently of financial movements", async () => {
  const investment = "77777777-7777-4777-8777-777777777777";
  const api = transport({
    "/investments": (url) =>
      Response.json(
        paged(
          [{ id: Number(url.searchParams.get("page")) === 1 ? investment : tx2, itemId }],
          2,
          2,
          Number(url.searchParams.get("page")),
        ),
      ),
    [`/investments/${investment}/transactions`]: () =>
      Response.json(
        paged([{ id: tx, investmentId: investment, type: "BUY", amount: 12 }]),
      ),
    [`/investments/${tx2}/transactions`]: () => Response.json(paged([])),
  });
  const snapshot = await createPluggyReader(
    { ...config, includeInvestments: true },
    api.fetch,
  ).sync(period);
  assert.equal(snapshot.investments.length, 2);
  assert.equal(snapshot.investmentTransactions.length, 1);
  const invalid = transport({
    "/investments": () => Response.json(paged([{ id: investment, itemId: owner }])),
  });
  await assert.rejects(
    createPluggyReader({ ...config, includeInvestments: true }, invalid.fetch).sync(
      period,
    ),
    (error) => error.code === "investment_scope_mismatch",
  );
});

test("only confirmed rules classify; conflicting rules and unconfirmed historical tags never imply ownership", () => {
  const { matchRules, suggestRules } = load("src/features/pluggy/reconciliation.ts");
  const categories = [
    {
      id: "subscriptions",
      name: "Assinaturas",
      type: "expense",
      parent_category_id: null,
    },
    { id: "other", name: "Outro", type: "expense", parent_category_id: null },
  ];
  const rules = [
    {
      id: "r1",
      pattern: "microsoft",
      categoryId: "subscriptions",
      ownership: null,
      active: true,
    },
  ];
  const match = matchRules("MICROSOFT*365", "expense", rules, categories);
  assert.equal(match.categoryId, "subscriptions");
  assert.equal(match.ownership, null);
  assert.equal(matchRules("MICROSOFT", "income", rules, categories).categoryId, null);
  assert.equal(
    matchRules("MICROSOFT", "expense", [{ ...rules[0], active: false }], categories)
      .categoryId,
    null,
  );
  const conflict = matchRules(
    "MICROSOFT",
    "expense",
    [...rules, { ...rules[0], id: "r2", categoryId: "other", ownership: "family" }],
    categories,
  );
  assert.equal(conflict.categoryId, null);
  assert.equal(conflict.ownership, null);
  assert.equal(conflict.ambiguous, true);
  const history = {
    movements: [
      {
        description: "MICROSOFT",
        category: "Assinaturas",
        tags: ["Mãe"],
        kind: "expense",
      },
      {
        description: "MICROSOFT",
        category: "Assinaturas",
        tags: ["Trabalho"],
        kind: "expense",
      },
    ],
  };
  const proposal = suggestRules(history, categories)[0];
  assert.equal(proposal.count, 2);
  assert.equal(proposal.categoryId, "subscriptions");
  assert.equal(proposal.tags.length, 2);
  assert.equal(proposal.ownership, undefined);
});

test("inbox review requires an explicit valid canonical candidate and preserves unclassified ownership", async () => {
  const { validateReview } = load("src/features/pluggy/reconciliation.ts");
  const snapshot = await createPluggyReader(config, transport().fetch).sync(period);
  const row = buildPluggyPreview(snapshot, refs, null).movements[0];
  const review = validateReview(
    row,
    {
      state: "reconciled",
      categoryId: null,
      ownership: null,
      targetId: "manual-original",
      target: "accounts_payable",
    },
    [],
  );
  assert.equal(review.targetId, "manual-original");
  assert.equal(review.ownership, null);
  assert.throws(() => validateReview(row, { ...review, targetId: "foreign" }, []));
  assert.throws(() => validateReview(row, { ...review, categoryId: "foreign" }, []));
  assert.throws(() => validateReview(row, { ...review, state: "new" }, []));
  assert.throws(() => validateReview({ ...row, kind: "invoice_payment" }, review, []));
});

test("staging uses the external source key, confirmed category rules and no financial payload", async () => {
  const { stageRows } = load("src/features/pluggy/queries.ts");
  const snapshot = await createPluggyReader(config, transport().fetch).sync(period);
  const preview = buildPluggyPreview(snapshot, refs, null);
  const before = JSON.stringify(snapshot);
  const rows = stageRows(
    snapshot,
    preview,
    [
      {
        id: "rule",
        pattern: "compra",
        categoryId: "category",
        ownership: null,
        active: true,
      },
    ],
    [{ id: "category", name: "Mercado", type: "expense", parent_category_id: null }],
  );
  assert.equal(rows[0].sourceKey, `pluggy:${itemId}:${bank}:${tx}`);
  assert.equal(rows[0].categoryId, "category");
  assert.equal(rows[0].ownership, null);
  assert.equal(rows[0].raw.providerId, "bank-original-id");
  assert.equal(rows[0].target_entity_id, undefined);
  assert.equal(JSON.stringify(snapshot), before);
});

test("dashboard API checks owner/CSRF, refuses arbitrary items and requires explicit review confirmation", async () => {
  const env = {
    PLUGGY_HUB_USER_ID: owner,
    PLUGGY_CLIENT_ID: "fixture",
    PLUGGY_CLIENT_SECRET: "secret",
    PLUGGY_NUBANK_ITEM_ID: itemId,
  };
  const calls = { dashboard: 0, sync: 0, rpc: 0 };
  let signedIn = false;
  const fixture = { ready: true, banks: [], movements: [], rules: [], categories: [] };
  const loader = harness(
    {
      "@/lib/supabase/server": {
        createClient: async () => ({
          auth: {
            getUser: async () => ({
              data: { user: signedIn ? { id: owner } : null },
              error: null,
            }),
          },
          rpc: async () => {
            calls.rpc++;
            throw new Error("Unexpected mutation");
          },
        }),
      },
      "@/features/pluggy/service": {
        pluggyDashboard: async () => {
          calls.dashboard++;
          return fixture;
        },
        syncPluggyBank: async () => {
          calls.sync++;
        },
        pluggyMessage: () => "Controlled failure",
      },
    },
    env,
  );
  const route = loader("src/app/api/pluggy/dashboard/route.ts");
  assert.equal(
    (await route.GET(new Request("http://localhost/api/pluggy/dashboard"))).status,
    401,
  );
  assert.equal(calls.dashboard, 0);
  signedIn = true;
  assert.equal(
    (await route.GET(new Request("http://localhost/api/pluggy/dashboard"))).status,
    200,
  );
  assert.equal(
    (
      await route.POST(
        request(
          { action: "sync", institution: "nubank", period },
          "https://foreign.invalid",
        ),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await route.POST(
        request({ action: "sync", institution: "nubank", period, itemId: bank }),
      )
    ).status,
    400,
  );
  assert.equal(
    (await route.POST(request({ action: "sync", institution: "unknown", period })))
      .status,
    400,
  );
  assert.equal(
    (await route.POST(request({ action: "sync", institution: "nubank", period: {} })))
      .status,
    400,
  );
  assert.equal(
    (await route.POST(request({ action: "review", confirm: false }))).status,
    400,
  );
  assert.equal(
    (
      await route.POST(
        request({
          action: "review",
          confirm: true,
          sourceKey: "foreign",
          expectedUpdatedAt: "2026-10-23",
        }),
      )
    ).status,
    409,
  );
  assert.equal(calls.rpc, 0);
  assert.equal(calls.sync, 0);
  assert.equal(
    (await route.POST(request({ action: "sync", institution: "nubank", period }))).status,
    200,
  );
  assert.equal(calls.sync, 1);
});

test("optional daily endpoint denies missing/invalid secrets and isolates failure of one institution", async () => {
  const env = {
    CRON_SECRET: "PRIVATE_CRON",
    PLUGGY_HUB_USER_ID: owner,
    PLUGGY_CLIENT_ID: "fixture",
    PLUGGY_CLIENT_SECRET: "secret",
    PLUGGY_NUBANK_ITEM_ID: itemId,
    PLUGGY_XP_ITEM_ID: bank,
    PLUGGY_SICREDI_ITEM_ID: card,
    PLUGGY_CAIXA_ITEM_ID: tx,
    PLUGGY_MERCADO_PAGO_ITEM_ID: tx2,
  };
  const calls = [];
  const route = harness(
    {
      "@/features/pluggy/service": {
        defaultPluggyPeriod: () => period,
        syncPluggyBank: async (id) => {
          calls.push(id);
          if (id === "xp") throw new Error("PRIVATE_UPSTREAM");
          return { skipped: false };
        },
        pluggyMessage: () => "Controlled error",
      },
    },
    env,
  )("src/app/api/pluggy/sync/route.ts");
  assert.equal(
    (await route.GET(new Request("http://localhost/api/pluggy/sync"))).status,
    401,
  );
  assert.equal(
    (
      await route.GET(
        new Request("http://localhost/api/pluggy/sync", {
          headers: { authorization: "Bearer WRONG_SECRET" },
        }),
      )
    ).status,
    401,
  );
  assert.equal(calls.length, 0);
  const result = await route.GET(
    new Request("http://localhost/api/pluggy/sync", {
      headers: { authorization: "Bearer PRIVATE_CRON" },
    }),
  );
  const body = await result.json();
  assert.equal(calls.length, 5);
  assert.equal(body.results[1].status, "error");
  assert.equal(body.results[4].status, "read");
  assert.equal(body.financialWrites, 0);
  assert.equal(JSON.stringify(body).includes("PRIVATE"), false);
});

test("accumulated backups retain overlapping history and do not regress a newer provider version", async () => {
  const first = await createPluggyReader(config, transport().fetch).sync(period);
  first.transactions[0].updatedAt = "2026-10-23T12:00:00Z";
  const second = structuredClone(first);
  second.accounts = [first.accounts[0]];
  second.transactions = [
    { ...first.transactions[0], amount: -99, updatedAt: "2026-10-22T12:00:00Z" },
    movement("77777777-7777-4777-8777-777777777777"),
  ];
  second.bills = [];
  const names = [
    "2026-10-22T12-00-00-000Z-11111111-1111-4111-8111-111111111111",
    "2026-10-23T12-00-00-000Z-22222222-2222-4222-8222-222222222222",
  ];
  const values = new Map(
    names.map((name, index) => [name, JSON.stringify(index === 0 ? first : second)]),
  );
  const fs = {
    readdir: async () => names,
    stat: async () => ({ size: 1024 }),
    readFile: async (path) => values.get(path.split(/[\\/]/).at(-2)),
  };
  const { accumulatedPluggyBackup } = harness({ "node:fs/promises": fs })(
    "src/features/pluggy/backup.ts",
  );
  const result = await accumulatedPluggyBackup(owner, itemId);
  assert.equal(result.snapshot.transactions.length, 3);
  assert.equal(result.snapshot.transactions.find((row) => row.id === tx).amount, -12);
  assert.equal(result.snapshot.accounts.length, 2);
  assert.equal(result.snapshot.previousAccountIds[0], card);
  assert.equal(await accumulatedPluggyBackup(bank, itemId), null);
});
