import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = fileURLToPath(new URL("../", import.meta.url));

function harness(overrides = {}, env = {}) {
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const loadedModule = { exports: {} };
    cache.set(path, loadedModule.exports);
    const source = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const scopedRequire = (name) => {
      if (name === "server-only") return {};
      if (name in overrides) return overrides[name];
      return load(
        resolve(
          name.startsWith("@/") ? resolve(root, "src") : dirname(path),
          `${name.startsWith("@/") ? name.slice(2) : name}.ts`,
        ),
      );
    };
    vm.runInNewContext(`(function(require,module,exports){${source}\n})`, {
      URL,
      URLSearchParams,
      Buffer,
      Response,
      Request,
      Headers,
      AbortSignal,
      structuredClone,
      process: { env },
      console,
      fetch: async () => {
        throw new Error("No network permitted in fixtures.");
      },
    })(scopedRequire, loadedModule, loadedModule.exports);
    cache.set(path, loadedModule.exports);
    return loadedModule.exports;
  }
  return (name) => load(resolve(root, name));
}
const load = harness();
const { createOrganizzeReader, validateTask } = load("src/features/organizze/client.ts");
const { createSnapshot, acceptPage, monthlyWindows, extract, pendingTask } = load(
  "src/features/organizze/extraction.ts",
);
const { buildOrganizzePreview, buildSelectionPlan } = load(
  "src/features/organizze/preview.ts",
);
const { allReferencePages } = load("src/features/organizze/references.ts");
const { loadOrganizzeReferences } = load("src/features/organizze/references.ts");
const { buildOrganizzeImport } = load("src/features/imports/organizze.ts");
const period = { start: "2023-01-01", end: "2023-01-31" };
const refs = {
  ownerId: "fixture-owner",
  categories: [],
  cards: [],
  movements: [],
  invoices: [],
};
const config = {
  email: "fixture@example.invalid",
  apiKey: "SIMULATED_ONLY",
  userAgent: "HubVZ-fixture",
};
const page = (data, nextPage = null) => ({
  data,
  nextPage,
  fetchedAt: "2026-10-21T12:00:00Z",
});

test("pagination follows next in a multi-token relation", async () => {
  const reader = createOrganizzeReader(config, async () =>
    Response.json([{ id: 1 }], {
      headers: {
        Link: '</rest/v2/accounts?page=2>; rel="last next"',
      },
    }),
  );
  assert.equal((await reader({ path: "/accounts" })).nextPage, 2);
});

test("incomplete structured payment and transfer links do not become expenses", () => {
  const snapshot = createSnapshot(refs.ownerId, period);
  acceptPage(
    snapshot,
    { path: "/transactions", period },
    page([
      { id: 1, amount_cents: -100, date: "2023-01-01", paid_credit_card_id: 3 },
      { id: 2, amount_cents: -100, date: "2023-01-01", oposite_account_id: 4 },
    ]),
  );
  const rows = buildOrganizzePreview(snapshot, refs).rows;
  assert.equal(rows[0].kind, "invoice_payment");
  assert.equal(rows[1].kind, "transfer");
  assert.ok(rows[0].issues.some((issue) => issue.includes("sem fatura")));
  assert.ok(rows[1].issues.some((issue) => issue.includes("Contrapartida")));
});

test("reader sends Basic auth with required headers, GET and no redirects/cache", async () => {
  const calls = [];
  const reader = createOrganizzeReader(config, async (url, options) => {
    calls.push({ url: String(url), options });
    return Response.json([{ id: 1 }]);
  });
  const result = await reader({ path: "/accounts" });
  assert.equal(result.data.length, 1);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(
    calls[0].options.headers.Authorization,
    `Basic ${Buffer.from("fixture@example.invalid:SIMULATED_ONLY").toString("base64")}`,
  );
  assert.equal(calls[0].options.headers["User-Agent"], "HubVZ-fixture");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal("body" in calls[0].options, false);
});

test("blocks arbitrary hosts, traversal, write routes and invalid dates before network", async () => {
  let calls = 0;
  const reader = createOrganizzeReader(config, async () => {
    calls++;
    return Response.json([]);
  });
  for (const path of [
    "https://evil.invalid",
    "/accounts/../transactions",
    "/accounts?x=1",
    "/credit_cards/1/archive",
    "/users/1",
  ]) {
    await assert.rejects(reader({ path }));
  }
  assert.throws(() => validateTask({ path: "/transactions" }));
  assert.throws(() =>
    validateTask({
      path: "/transactions",
      period: { start: "2023-02-30", end: "2023-02-30" },
    }),
  );
  assert.equal(calls, 0);
});

test("pagination accepts only next sequential page on same endpoint and dates", async () => {
  const reader = createOrganizzeReader(config, async () =>
    Response.json([{ id: 1 }], {
      headers: {
        Link: '<https://api.organizze.com.br/rest/v2/transactions?start_date=2023-01-01&end_date=2023-01-31&page=2>; rel="next"',
      },
    }),
  );
  assert.equal((await reader({ path: "/transactions", period })).nextPage, 2);
  for (const next of [
    "https://evil.invalid/?page=2",
    "/rest/v2/accounts?page=2",
    "/rest/v2/transactions?page=1",
    "/rest/v2/transactions?start_date=2023-01-01&end_date=2023-01-31&page=1",
    "/rest/v2/transactions?start_date=2023-01-01&end_date=2023-01-31&page=999",
  ]) {
    const unsafe = createOrganizzeReader(config, async () =>
      Response.json([], { headers: { Link: `<${next}>; rel="next"` } }),
    );
    await assert.rejects(unsafe({ path: "/transactions", period }), /invalid_pagination/);
  }
});

test("sanitizes authentication failures and 429 without returning upstream body/secrets", async () => {
  for (const status of [401, 429, 500]) {
    const reader = createOrganizzeReader(
      config,
      async () => new Response("SIMULATED_ONLY credential echoed", { status }),
    );
    try {
      await reader({ path: "/accounts" });
      assert.fail("expected failure");
    } catch (error) {
      assert.equal(error.message.includes("SIMULATED_ONLY"), false);
    }
  }
  const invalid = createOrganizzeReader(config, async () => new Response("not json"));
  await assert.rejects(invalid({ path: "/accounts" }), /invalid_response/);
});

test("monthly extraction covers chosen years and leap years without assuming current month", () => {
  const windows = monthlyWindows({ start: "2023-01-01", end: "2026-10-21" });
  assert.equal(windows.length, 46);
  assert.equal(windows[13].end, "2024-02-29");
  assert.equal(windows.at(-1).end, "2026-10-31");
  assert.throws(() => monthlyWindows({ start: "2023-02-30", end: "2023-03-01" }));
});

function fixture() {
  const snapshot = createSnapshot(refs.ownerId, period);
  acceptPage(
    snapshot,
    { path: "/accounts" },
    page([
      { id: 1, name: "Banco" },
      { id: 2, name: "Carteira" },
    ]),
  );
  acceptPage(
    snapshot,
    { path: "/categories" },
    page([
      { id: 10, name: "Casa", kind: "expense" },
      { id: 11, name: "Mercado", parent_id: 10, kind: "expense" },
    ]),
  );
  const transaction = (id, extra = {}) => ({
    id,
    date: "2023-01-10",
    amount_cents: -1000,
    description: "Compra",
    account_id: 1,
    category_id: 11,
    tags: [{ id: 50, name: "Mãe" }],
    ...extra,
  });
  acceptPage(
    snapshot,
    { path: "/transactions", period },
    page([
      transaction(100, {
        recurring: true,
        recurrence_id: 777,
        installment: 2,
        total_installments: 4,
      }),
      transaction(101, { oposite_transaction_id: 102, oposite_account_id: 2 }),
      transaction(102, {
        account_id: 2,
        amount_cents: 1000,
        oposite_transaction_id: 101,
        oposite_account_id: 1,
      }),
      transaction(103, { paid_credit_card_id: 3, paid_credit_card_invoice_id: 4 }),
    ]),
  );
  acceptPage(snapshot, { path: "/credit_cards" }, page([{ id: 3, name: "Cartão" }]));
  acceptPage(
    snapshot,
    { path: "/credit_cards/3/invoices", period },
    page([{ id: 4, date: "2023-01-20", credit_card_id: 3, amount_cents: -1000 }]),
  );
  acceptPage(
    snapshot,
    { path: "/credit_cards/3/invoices/4/payments" },
    page([transaction(103, { paid_credit_card_id: 3, paid_credit_card_invoice_id: 4 })]),
  );
  return snapshot;
}

test("preserves IDs, tags and recurrence; payments returned twice remain one movement", () => {
  const snapshot = fixture();
  const preview = buildOrganizzePreview(snapshot, refs);
  assert.equal(preview.rows.filter((row) => row.entity === "transaction").length, 4);
  assert.equal(
    preview.rows.find((row) => row.key === "transaction:103").sources.length,
    2,
  );
  assert.equal(
    preview.rows.find((row) => row.key === "transaction:100").raw.recurrence_id,
    777,
  );
  assert.equal(
    preview.rows.find((row) => row.key === "transaction:100").raw.total_installments,
    4,
  );
  assert.equal(preview.tags[0], "Mãe");
  const plan = buildSelectionPlan(snapshot, refs, ["transaction:100"]);
  assert.equal(plan.rows[0].ownership, null);
  assert.equal(plan.rows[0].reimbursement, null);
  assert.equal(plan.officialWritesAllowed, false);
  assert.ok(plan.rows[0].blockers.some((item) => item.includes("Dependência")));
});

test("transfer legs and invoice payments never become expenses or income", () => {
  const rows = buildOrganizzePreview(fixture(), refs).rows;
  assert.equal(rows.find((row) => row.key === "transaction:101").kind, "transfer");
  assert.equal(rows.find((row) => row.key === "transaction:102").kind, "transfer");
  assert.equal(rows.find((row) => row.key === "transaction:103").kind, "invoice_payment");
  assert.equal(rows.filter((row) => row.kind === "expense").length, 1);
});

test("proposes category match only for equal hierarchy and type, with no overwrite", () => {
  const snapshot = fixture();
  const references = {
    ...refs,
    categories: [
      { id: "hub-root", name: "Casa", type: "expense", parent_category_id: null },
      {
        id: "hub-child",
        name: "Mercado",
        type: "expense",
        parent_category_id: "hub-root",
      },
      { id: "wrong", name: "Mercado", type: "income", parent_category_id: "hub-root" },
    ],
  };
  const before = JSON.stringify(references);
  const child = buildOrganizzePreview(snapshot, references).rows.find(
    (row) => row.key === "category:11",
  );
  assert.equal(child.categoryCandidates.join(","), "hub-child");
  assert.equal(JSON.stringify(references), before);
  snapshot.records.find((row) => row.key === "category:10").raw.parent_id = 11;
  assert.ok(
    buildOrganizzePreview(snapshot, references)
      .rows.find((row) => row.key === "category:10")
      .issues.some((item) => item.includes("circular")),
  );
});

test("observed plural category kinds match Hub types without changing originals or guessing none", () => {
  const snapshot = createSnapshot(refs.ownerId, period);
  acceptPage(snapshot, { path: "/categories" }, page([
    { id: 1, name: "Casa", kind: "expenses", parent_id: null },
    { id: 2, name: "Salário", kind: "earnings", parent_id: null },
    { id: 3, name: "Casa", kind: "none", parent_id: null },
  ]));
  const references = { ...refs, categories: [
    { id: "expense", name: "Casa", type: "expense", parent_category_id: null },
    { id: "wrong-type", name: "Casa", type: "income", parent_category_id: null },
    { id: "income", name: "Salario", type: "income", parent_category_id: null },
  ] };
  const original = JSON.stringify(snapshot);
  const rows = buildOrganizzePreview(snapshot, references).rows;
  assert.equal(rows.find(row => row.sourceId === "1").categoryCandidates.join(","), "expense");
  assert.equal(rows.find(row => row.sourceId === "2").categoryCandidates.join(","), "income");
  assert.equal(rows.find(row => row.sourceId === "3").categoryCandidates.length, 0);
  assert.equal(JSON.stringify(snapshot), original);
});

test("ambiguous duplicate pagination parameters are rejected even if the first values look valid", async () => {
  for (const link of [
    '</rest/v2/transfers?start_date=2023-01-01&end_date=2023-01-31&page=2&page=3>; rel="next"',
    '</rest/v2/transfers?start_date=2023-01-01&end_date=2023-01-31&page=2&start_date=2024-01-01>; rel="next"',
  ]) {
    let requests = 0;
    const read = createOrganizzeReader(config, async () => {
      requests++;
      return Response.json([], { headers: { Link: link } });
    });
    await assert.rejects(read({ path: "/transfers", period }), error => error.code === "invalid_pagination");
    assert.equal(requests, 1);
  }
});

test("repairs malformed upstream page only by rebuilding a pinned GET, preserving all pages", async () => {
  const requested = [];
  const reader = createOrganizzeReader(config, async (url, options) => {
    requested.push({ url: String(url), method: options.method });
    return Response.json(requested.length === 1 ? [{ id: 1 }] : [], requested.length === 1 ? { headers: {
      Link: '</rest/v2/transfers?start_date=2023-01-01&end_date=2023-01-31&page=invalid-upstream-value&page=2&start_date=2023-01-01>; rel="next"',
    } } : {});
  });
  const snapshot = createSnapshot(refs.ownerId, period);
  const first = await reader({ path: "/transfers", period });
  acceptPage(snapshot, { path: "/transfers", period }, first);
  assert.equal(first.nextPage, 2);
  await reader({ path: "/transfers", period, page: first.nextPage });
  assert.equal(new URL(requested[1].url).searchParams.getAll("page").join(","), "2");
  assert.equal(new URL(requested[1].url).searchParams.getAll("start_date").join(","), period.start);
  assert.ok(requested.every(row => row.method === "GET"));
});

test("empty list pages terminate endless advertised next links and retain a warning", async () => {
  const reader = createOrganizzeReader(config, async () => Response.json([], { headers: {
    Link: '</rest/v2/transfers?start_date=2023-01-01&end_date=2023-01-31&page=broken&page=2>; rel="next"',
  } }));
  const result = await reader({ path: "/transfers", period });
  assert.equal(result.nextPage, null);
  assert.equal(result.warnings.length, 1);
  const snapshot = createSnapshot(refs.ownerId, period);
  acceptPage(snapshot, { path: "/transfers", period }, result);
  assert.equal(snapshot.warnings.length, 1);
});

test("duplicates are suggestions, out-of-period data excluded and conflicts preserved", () => {
  const snapshot = fixture();
  const references = {
    ...refs,
    movements: [
      {
        id: "existing",
        table: "accounts_payable",
        description: "Compra",
        date: "2023-01-10",
        amountCents: 1000,
      },
    ],
  };
  acceptPage(
    snapshot,
    { path: "/transactions/100" },
    page([{ id: 100, amount_cents: -1500, date: "2022-12-31" }]),
  );
  acceptPage(
    snapshot,
    { path: "/transactions/200" },
    page([{ id: 200, amount_cents: -100, date: "2023-02-01" }]),
  );
  const preview = buildOrganizzePreview(snapshot, references);
  assert.equal(
    preview.rows.find((row) => row.key === "transaction:100").duplicateCandidates.length,
    1,
  );
  assert.ok(
    preview.rows
      .find((row) => row.key === "transaction:100")
      .issues.some((item) => item.includes("conflitantes")),
  );
  assert.equal(
    preview.rows.find((row) => row.key === "transaction:200").selectable,
    false,
  );
});

test("extract resumes after failure, follows next pages, details, faturas and payments", async () => {
  const snapshot = createSnapshot(refs.ownerId, period);
  let fail = true;
  const calls = [];
  const read = async (task) => {
    calls.push(task.path);
    if (task.path === "/categories" && fail) throw new Error("fixture network failure");
    if (task.path === "/accounts") return page([{ id: 1 }]);
    if (task.path === "/credit_cards") return page([{ id: 3 }]);
    if (task.path === "/transactions" && !task.page)
      return page([{ id: 100, date: "2023-01-01", tags: [] }], 2);
    if (task.path === "/credit_cards/3/invoices") return page([{ id: 4 }]);
    if (task.path === "/credit_cards/3/invoices/4")
      return page([{ id: 4, transactions: [{ id: 101 }] }]);
    if (task.path === "/transactions/101")
      return page([{ id: 101, tags: [{ name: "Preservada" }] }]);
    if (task.path === "/transactions/100")
      return page([{ id: 100, date: "2023-01-01", tags: [] }]);
    return page([]);
  };
  await assert.rejects(extract(snapshot, read, () => {}, new AbortController().signal));
  assert.equal(snapshot.receipts.length, 1);
  assert.equal(buildOrganizzePreview(snapshot, refs).complete, false);
  fail = false;
  await extract(snapshot, read, () => {}, new AbortController().signal);
  assert.equal(calls.filter((path) => path === "/accounts").length, 1);
  assert.ok(calls.includes("/credit_cards/3/invoices/4/payments"));
  assert.ok(snapshot.receipts.some((receipt) => receipt.task.page === 2));
  assert.equal(pendingTask(snapshot), undefined);
  assert.equal(buildOrganizzePreview(snapshot, refs).complete, true);
  assert.equal(buildOrganizzePreview(snapshot, refs).tags[0], "Preservada");
});

test("missing IDs prevent completeness; cross-user snapshots rejected", () => {
  const snapshot = createSnapshot(refs.ownerId, period);
  acceptPage(snapshot, { path: "/accounts" }, page([{ name: "No ID" }]));
  assert.equal(snapshot.errors.length, 1);
  assert.equal(snapshot.rejected[0].raw.name, "No ID");
  assert.equal(buildOrganizzePreview(snapshot, refs).complete, false);
  assert.throws(() => buildOrganizzePreview(snapshot, { ...refs, ownerId: "other" }));
});

test("repeated page content cannot falsely complete pagination", () => {
  const snapshot = createSnapshot(refs.ownerId, period);
  acceptPage(
    snapshot,
    { path: "/transactions", period },
    page([{ id: 1 }, { id: 2 }], 2),
  );
  assert.throws(
    () =>
      acceptPage(
        snapshot,
        { path: "/transactions", period, page: 2 },
        page([{ id: 2 }, { id: 1 }], 3),
      ),
    /repetiu/,
  );
  assert.equal(snapshot.receipts.length, 1);
  assert.equal(buildOrganizzePreview(snapshot, refs).complete, false);
});

test("mismatched detail IDs are quarantined and never replace the requested transaction", () => {
  const snapshot = createSnapshot(refs.ownerId, period);
  acceptPage(
    snapshot,
    { path: "/transactions/1" },
    page([{ id: 99, description: "Wrong response" }]),
  );
  assert.equal(snapshot.records.length, 0);
  assert.equal(snapshot.rejected[0].raw.id, 99);
  assert.equal(snapshot.errors.length, 1);
});

test("embedded payments and dedicated payment lists unify by ID and reconcile totals", () => {
  const snapshot = createSnapshot(refs.ownerId, period);
  const payment = {
    id: 400,
    date: "2023-01-15",
    amount_cents: -1000,
    category_id: 10,
    account_id: 1,
    tags: [],
  };
  acceptPage(
    snapshot,
    { path: "/credit_cards/3/invoices/4" },
    page([
      {
        id: 4,
        date: "2023-01-20",
        amount_cents: 1000,
        payment_amount_cents: 2000,
        transactions: [],
        payments: [payment],
      },
    ]),
  );
  acceptPage(snapshot, { path: "/credit_cards/3/invoices/4/payments" }, page([payment]));
  const preview = buildOrganizzePreview(snapshot, refs);
  assert.equal(preview.rows.filter((row) => row.entity === "transaction").length, 1);
  assert.equal(
    preview.rows.find((row) => row.entity === "transaction").kind,
    "invoice_payment",
  );
  assert.ok(
    preview.rows
      .find((row) => row.entity === "invoice")
      .issues.some((issue) => issue.includes("total pago")),
  );
});

test("cancellation retains completed receipts and no subsequent reads execute", async () => {
  const snapshot = createSnapshot(refs.ownerId, period);
  const abort = new AbortController();
  let reads = 0;
  await assert.rejects(
    extract(
      snapshot,
      async () => {
        reads++;
        return page([]);
      },
      () => abort.abort(),
      abort.signal,
    ),
    /interrompida/,
  );
  assert.equal(reads, 1);
  assert.equal(snapshot.receipts.length, 1);
  assert.equal(buildOrganizzePreview(snapshot, refs).complete, false);
});

test("Hub reference pagination checks exact counts and rejects truncation/error", async () => {
  const result = await allReferencePages(async (from) => ({
    data: Array.from({ length: from === 0 ? 500 : 1 }, (_, index) => ({
      id: from + index,
    })),
    error: null,
    count: 501,
  }));
  assert.equal(result.length, 501);
  await assert.rejects(
    allReferencePages(async () => ({ data: [{ id: 1 }], error: null, count: 501 })),
  );
  await assert.rejects(
    allReferencePages(async () => ({
      data: null,
      error: new Error("fixture"),
      count: null,
    })),
  );
});

test("actual API route rejects unauthenticated and other owners before upstream access", async () => {
  for (const [id, expected] of [
    [null, 401],
    ["other-user", 403],
  ]) {
    const route = harness(
      {
        "@/lib/supabase/server": {
          createClient: async () => ({
            auth: {
              getUser: async () => ({ data: { user: id ? { id } : null }, error: null }),
            },
          }),
        },
      },
      { ORGANIZZE_HUB_USER_ID: refs.ownerId },
    )("src/app/api/organizze/preview/route.ts");
    const response = await route.GET(
      new Request(
        "https://fixture.invalid/api/organizze/preview?action=extract&path=/accounts",
      ),
    );
    assert.equal(response.status, expected);
    assert.equal(response.headers.get("cache-control"), "no-store, private");
    assert.equal(route.POST, undefined);
  }
});

test("actual API route and orchestration use GET only and never official writes", async () => {
  const upstreamCalls = [];
  const fakeReader = createOrganizzeReader(config, async (url, options) => {
    upstreamCalls.push(options.method);
    return Response.json(
      new URL(url).pathname.endsWith("/accounts") ? [{ id: 1, name: "Fixture" }] : [],
    );
  });
  const route = harness(
    {
      "@/lib/supabase/server": {
        createClient: async () => ({
          auth: {
            getUser: async () => ({ data: { user: { id: refs.ownerId } }, error: null }),
          },
          from: () => {
            throw new Error("No financial writes/reads allowed in extraction fixture.");
          },
        }),
      },
      "@/features/organizze/client": {
        createOrganizzeReader: () => fakeReader,
        OrganizzeError: Error,
      },
    },
    { ORGANIZZE_HUB_USER_ID: refs.ownerId },
  )("src/app/api/organizze/preview/route.ts");
  const snapshot = createSnapshot(refs.ownerId, period);
  await extract(
    snapshot,
    async (task) => {
      const params = new URLSearchParams({ action: "extract", path: task.path });
      if (task.period) {
        params.set("start", task.period.start);
        params.set("end", task.period.end);
      }
      const response = await route.GET(
        new Request(`https://fixture.invalid/api/organizze/preview?${params}`),
      );
      assert.equal(response.status, 200);
      return response.json();
    },
    () => {},
    new AbortController().signal,
  );
  assert.ok(upstreamCalls.length > 0);
  assert.equal(
    upstreamCalls.every((method) => method === "GET"),
    true,
  );
  assert.equal(buildOrganizzePreview(snapshot, refs).complete, true);
  assert.equal(JSON.stringify(snapshot).includes(config.apiKey), false);
});

test("optional unavailable resources retain an explicit warning without dropping core data", async () => {
  const snapshot = createSnapshot(refs.ownerId, period);
  const { OrganizzeError } = load("src/features/organizze/client.ts");
  await extract(snapshot, async task => {
    if (task.path === "/transfers") throw new OrganizzeError("upstream_404");
    return page([]);
  }, () => {}, new AbortController().signal);
  assert.equal(snapshot.unavailable.length, 1);
  assert.equal(buildOrganizzePreview(snapshot, refs).complete, true);
  assert.ok(buildOrganizzePreview(snapshot, refs).warnings.some(item => item.includes("404")));
  const unauthorized = createSnapshot(refs.ownerId, period);
  await assert.rejects(extract(unauthorized, async () => { throw new OrganizzeError("credentials_rejected"); }, () => {}, new AbortController().signal));
  assert.equal(unauthorized.unavailable?.length ?? 0, 0);
});

test("linked import reuses payloads and preserves tags, transfers, payments and originals", () => {
  const snapshot = fixture();
  snapshot.tasks = snapshot.receipts.map(receipt => receipt.task);
  const original = JSON.stringify(snapshot);
  const plan = buildOrganizzeImport(snapshot, refs, {}, { "transaction:100": { action: "new", ownership: "personal" } });
  const find = key => plan.operations.find(row => row.sourceKey === key);
  assert.equal(find("transaction:100").target, "accounts_payable");
  assert.equal(find("transaction:100").tags.join(","), "Mãe");
  assert.equal(find("transaction:100").source.raw.recurrence_id, 777);
  assert.equal(find("transaction:101").target, "source_only");
  assert.equal(find("transaction:102").target, "source_only");
  assert.equal(find("transaction:103").target, "source_only");
  assert.equal(find("transaction:103").links.paidInvoice, "invoice:3:4");
  assert.equal(find("category:11").links.parent, "category:10");
  assert.equal(find("invoice:3:4").target, "source_only");
  assert.equal(find("account:1").target, "source_only");
  assert.equal(plan.operations.some(row => row.target === "reimbursements"), false);
  assert.equal(JSON.stringify(snapshot), original);
});

test("invoice reconciliation includes future invoices while retaining owner RLS filters", async () => {
  const calls = [];
  const client = { from(table) {
    const query = {};
    for (const method of ["select", "eq", "gte", "lte", "order", "contains"]) query[method] = (...args) => { calls.push([table, method, ...args]); return query; };
    query.range = async () => ({ data: [], error: null, count: 0 });
    return query;
  } };
  await loadOrganizzeReferences(client, refs.ownerId, period);
  assert.equal(calls.some(([table, method]) => table === "credit_card_invoices" && ["gte", "lte"].includes(method)), false);
  for (const table of new Set(calls.map(call => call[0]))) assert.ok(calls.some(call => call[0] === table && call[1] === "eq" && call[2] === "user_id" && call[3] === refs.ownerId));
});

test("only selected card purchases create invoice debt; historical totals and payments remain references", () => {
  const snapshot = fixture(); snapshot.tasks = snapshot.receipts.map(receipt => receipt.task);
  const purchase = snapshot.records.find(row => row.key === "transaction:100");
  purchase.raw.credit_card_id = 3; purchase.raw.credit_card_invoice_id = 4;
  const invoice = snapshot.records.find(row => row.key === "invoice:3:4");
  invoice.raw.amount_cents = -900000; invoice.raw.payment_amount_cents = -500;
  const historical = buildOrganizzeImport(snapshot, refs);
  assert.equal(historical.summary.create, 0);
  assert.equal(historical.operations.every(row => row.target === "source_only"), true);
  const selected = buildOrganizzeImport(snapshot, refs, { "3": "new" }, { "transaction:100": { action: "new", ownership: "family" } });
  const debit = selected.operations.find(row => row.sourceKey === invoice.key);
  assert.equal(debit.target, "credit_card_invoices");
  assert.equal(debit.values.total_amount, 10);
  assert.equal(debit.values.paid_amount, 0);
  assert.equal(debit.values.personal_amount, 0);
  assert.equal(debit.source.raw.amount_cents, -900000);
  assert.equal(selected.operations.find(row => row.sourceKey === purchase.key).values.ownership_type, "family");
  invoice.raw.amount_cents = 1000;
  const credit = buildOrganizzeImport(snapshot, refs, { "3": "new" }, { "transaction:100": { action: "new", ownership: "personal" } });
  assert.equal(credit.summary.newMovements, 0);
  assert.equal(credit.blockers.length, 1);
});

test("an existing source cannot be recreated, and foreign card mappings are rejected", () => {
  const snapshot = fixture(); snapshot.tasks = snapshot.receipts.map(receipt => receipt.task);
  const plan = buildOrganizzeImport(snapshot, { ...refs, imported: [{ sourceKey: "transaction:100", target: "accounts_payable", id: "already-imported" }] });
  assert.equal(plan.operations.find(row => row.sourceKey === "transaction:100").existingId, "already-imported");
  assert.throws(() => buildOrganizzeImport(snapshot, refs, { "3": "other-users-card" }));
  assert.throws(() => buildOrganizzeImport(createSnapshot(refs.ownerId, period), refs));
});

test("confirmation route requires same origin, owner session and explicit confirmation", async () => {
  let financialCalls = 0;
  const context = {
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: refs.ownerId } } }) }, rpc: async name => { if (name === "organizze_reconciliation_ready") return { data: true, error: null }; financialCalls++; return { data: {}, error: null }; } }) },
    "@/features/organizze/backup": { readOrganizzeBackup: async () => ({ period }), validateSnapshot: () => {}, saveOrganizzeBackup: async () => "backup", latestOrganizzeBackup: async () => null },
    "@/features/organizze/references": { loadOrganizzeReferences: async () => refs },
    "@/features/imports/organizze": { buildOrganizzeImport: () => ({ operations: [], summary: {}, reviews: [], blockers: [] }) },
  };
  const route = harness(context, { ORGANIZZE_HUB_USER_ID: refs.ownerId })("src/app/api/organizze/import/route.ts");
  const request = (origin, body) => new Request("https://fixture.invalid/api/organizze/import", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await route.POST(request("https://other.invalid", { action: "confirm" }))).status, 403);
  const proxied = new Request("http://localhost:3190/api/organizze/import", { method: "POST", headers: { origin: "http://127.0.0.1:3190", host: "127.0.0.1:3190", "Content-Type": "application/json" }, body: JSON.stringify({ action: "backup", snapshot: {} }) });
  assert.equal((await route.POST(proxied)).status, 200);
  assert.equal((await route.POST(request("https://fixture.invalid", { action: "confirm", backupId: "backup", ownership: "personal" }))).status, 400);
  assert.equal(financialCalls, 0);
  assert.equal((await route.POST(request("https://fixture.invalid", { action: "confirm", backupId: "backup", ownership: "personal", confirm: true }))).status, 200);
  assert.equal(financialCalls, 1);
  const unavailable = harness({ ...context, "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: refs.ownerId } } }) }, rpc: async name => { assert.equal(name, "organizze_reconciliation_ready"); return { data: false, error: null }; } }) } }, { ORGANIZZE_HUB_USER_ID: refs.ownerId })("src/app/api/organizze/import/route.ts");
  assert.equal((await unavailable.POST(request("https://fixture.invalid", { action: "confirm", backupId: "backup", confirm: true, ownership: "personal" }))).status, 409);
  const blocked = harness({ ...context, "@/features/imports/organizze": { buildOrganizzeImport: () => ({ operations: [], blockers: [{ reason: "Titularidade ausente" }] }) } }, { ORGANIZZE_HUB_USER_ID: refs.ownerId })("src/app/api/organizze/import/route.ts");
  assert.equal((await blocked.POST(request("https://fixture.invalid", { action: "confirm", backupId: "backup", confirm: true }))).status, 409);
  assert.equal(financialCalls, 1);
  const wrongOwner = harness(context, { ORGANIZZE_HUB_USER_ID: "another" })("src/app/api/organizze/import/route.ts");
  assert.equal((await wrongOwner.POST(request("https://fixture.invalid", { action: "backup" }))).status, 401);
});


test("historical data and unknown ownership never enter totals, including bank inflows", () => {
  const snapshot = fixture(); snapshot.tasks = snapshot.receipts.map(receipt => receipt.task);
  const expense = snapshot.records.find(row => row.key === "transaction:100");
  const before = JSON.stringify(snapshot);
  assert.equal(buildOrganizzeImport(snapshot, refs).summary.create, 0);
  const unclassified = buildOrganizzeImport(snapshot, refs, {}, { [expense.key]: { action: "new" } });
  assert.equal(unclassified.summary.create, 0); assert.match(unclassified.blockers[0].reason, /titularidade/);
  assert.equal(JSON.stringify(snapshot), before);
  expense.raw.amount_cents = 1000;
  const untyped = buildOrganizzeImport(snapshot, refs, {}, { [expense.key]: { action: "new", ownership: "third_party" } });
  assert.equal(untyped.summary.newMovements, 0); assert.match(untyped.blockers[0].reason, /natureza/);
  const approved = buildOrganizzeImport(snapshot, refs, {}, { [expense.key]: { action: "new", ownership: "third_party", inflowKind: "third_party_money" } });
  assert.equal(approved.operations.find(row => row.sourceKey === expense.key).values.inflow_kind, "third_party_money");
});

test("same amount with changed descriptions/dates, subscriptions and receipts are reviewed, never auto-linked", () => {
  const snapshot = fixture(); snapshot.tasks = snapshot.receipts.map(receipt => receipt.task);
  const existing = { ...refs, movements: [{ id: "manual", table: "credit_card_transactions", description: "Nome manual diferente", date: "2023-01-12", amountCents: 1000, ownership: "reimbursable", personId: "person", cardId: "owned-card", invoiceId: "invoice", categoryId: "own-category", isAutomatic: true, linkedTo: "Assinatura e reembolso" }] };
  const preview = buildOrganizzePreview(snapshot, existing);
  assert.equal(preview.rows.find(row => row.key === "transaction:100").duplicateCandidates.length, 1);
  const plan = buildOrganizzeImport(snapshot, existing);
  assert.equal(plan.summary.create, 0); assert.equal(plan.summary.linkExisting, 0);
  const linked = buildOrganizzeImport(snapshot, existing, {}, { "transaction:100": { action: "link", target: "credit_card_transactions", targetId: "manual", ownership: "personal" } });
  const op = linked.operations.find(row => row.sourceKey === "transaction:100");
  assert.equal(op.existingId, "manual"); assert.equal(op.review.ownership, "reimbursable"); assert.equal(op.values.invoice_id, "invoice"); assert.equal(op.values.category_id, "own-category");
  assert.equal(linked.summary.create, 0);
  const rejected = buildOrganizzeImport(snapshot, existing, {}, { "transaction:100": { action: "new", ownership: "personal" } });
  assert.equal(rejected.summary.newMovements, 0);
  const distinct = buildOrganizzeImport(snapshot, existing, {}, { "transaction:100": { action: "new", ownership: "personal", confirmDifferent: true } });
  assert.equal(distinct.summary.newMovements, 1);
  const foreign = buildOrganizzeImport(snapshot, existing, {}, { "transaction:100": { action: "link", target: "credit_card_transactions", targetId: "foreign" } });
  assert.equal(foreign.blockers.length, 1);
  snapshot.records.find(row => row.key === "transaction:100").raw.amount_cents = 1000;
  const receipt = { ...refs, movements: [{ id: "receipt", table: "income_sources", description: "Pagamento único reembolso", amountCents: 1000, date: "2022-01-01", receivedDate: "2023-01-10", inflowKind: "reimbursement", isAutomatic: true }] };
  assert.equal(buildOrganizzePreview(snapshot, receipt).rows.find(row => row.key === "transaction:100").duplicateCandidates[0].id, "receipt");
});

test("ambiguous internal matches require review, and reference-only origins remain promotable", () => {
  const snapshot = fixture(); snapshot.tasks = snapshot.receipts.map(receipt => receipt.task);
  const source = snapshot.records.find(row => row.key === "transaction:100");
  snapshot.records.push({ ...structuredClone(source), key: "transaction:999", sourceId: "999", raw: { ...source.raw, id: 999, description: "Outro nome", date: "2023-01-11" } });
  assert.equal(buildOrganizzePreview(snapshot, refs).rows.find(row => row.key === source.key).internalCandidates.length, 1);
  assert.equal(buildOrganizzeImport(snapshot, refs, {}, { [source.key]: { action: "new", ownership: "personal" } }).summary.newMovements, 0);
  const historicalRefs = { ...refs, imported: [{ sourceKey: source.key, target: "source_only", id: "ledger-id" }] };
  assert.equal(buildOrganizzeImport(snapshot, historicalRefs, {}, { [source.key]: { action: "new", ownership: "shared", confirmDifferent: true } }).summary.newMovements, 1);
  historicalRefs.imported[0].reviewAction = "historical";
  assert.equal(buildOrganizzeImport(snapshot, historicalRefs).reviews.find(row => row.sourceKey === source.key).state, "historical");
  historicalRefs.imported[0].reviewAction = "pending";
  assert.equal(buildOrganizzeImport(snapshot, historicalRefs).reviews.find(row => row.sourceKey === source.key).state, "pending");
});

test("reimbursable classification requires an owned person and never fabricates reimbursements", () => {
  const snapshot = fixture(); snapshot.tasks = snapshot.receipts.map(receipt => receipt.task);
  const decisions = { "transaction:100": { action: "new", ownership: "reimbursable" } };
  assert.equal(buildOrganizzeImport(snapshot, refs, {}, decisions).summary.newMovements, 0);
  decisions["transaction:100"].personId = "person";
  const plan = buildOrganizzeImport(snapshot, { ...refs, people: [{ id: "person", name: "Pessoa" }] }, {}, decisions);
  assert.equal(plan.summary.newMovements, 1);
  assert.equal(plan.operations.some(row => row.target === "reimbursements"), false);
});

test("original creation source and reconciliation references are independent of ownership/category", () => {
  const { movementOrigin } = load("src/features/imports/organizze.ts");
  assert.equal(movementOrigin({ sourceType: "manual", origins: ["organizze", "pluggy"], ownership: "family", categoryId: "organize-historical" }), "Manual");
  assert.equal(movementOrigin({ createdOrigin: "pluggy", origins: ["pluggy", "organizze"], ownership: "personal" }), "Pluggy");
  assert.equal(movementOrigin({ isAutomatic: true, linkedTo: "Assinatura" }), "HubVZ");
});
