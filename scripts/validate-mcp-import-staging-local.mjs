import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

// Dedicated local Supabase project and disposable demo data only.
const base = "http://localhost:3219";
const supabase = "http://127.0.0.1:55421";
assert.equal(process.env.MCP_STAGING_CONFIRM, "isolated-synthetic-only");
assert.equal(new URL(process.env.MCP_STAGING_SUPABASE_URL).origin, supabase);
assert.equal(existsSync(".env.local"), false, "Run in a copy without the real .env.local.");
const publicKey = process.env.MCP_STAGING_SUPABASE_ANON_KEY;
const serviceKey = process.env.MCP_STAGING_SERVICE_ROLE_KEY;
assert.ok(publicKey && serviceKey);
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(supabase, serviceKey, options);
const requireData = ({ data, error }) => {
  if (error) throw new Error(`Local staging operation failed (${error.code ?? error.status ?? "unknown"}).`);
  return data;
};
const user = async () => {
  const email = `hub-mcp-${randomUUID()}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const { user: record } = requireData(await admin.auth.admin.createUser({ email, password, email_confirm: true }));
  const client = createClient(supabase, publicKey, options);
  requireData(await client.auth.signInWithPassword({ email, password }));
  return { email, password, id: record.id, client };
};
const owner = await user();
const outsider = await user();

const periodEnd = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Cuiaba" }).format(new Date());
const day = (ago) => new Date(Date.parse(`${periodEnd}T12:00:00Z`) - ago * 86_400_000).toISOString().slice(0, 10);
const period = { start: day(45), end: periodEnd };
const now = new Date().toISOString();
const name = "Hub MCP fixture";
const periodDate = day(1);
const itemId = randomUUID();
const accountId = randomUUID();
const movement = (description, amount, status = "POSTED") => ({
  id: randomUUID(), accountId, description, date: `${periodDate}T12:00:00Z`,
  amount, type: "DEBIT", status, currencyCode: "BRL",
});
const linked = movement(`${name} manual`, -154.62);
const created = movement(`${name} nova`, -829.19);
const conflict = movement(`${name} conflito`, -332.87);
const pending = movement(`${name} pendente`, -47.25, "PENDING");
const sourceKey = row => `pluggy:${itemId}:${accountId}:${row.id}`;
const account = async (title, amount) => requireData(await owner.client.from("accounts_payable").insert({
  user_id: owner.id, title, amount, due_date: periodDate, status: "paid",
}).select("id,updated_at").single());
const canonical = await account(linked.description, 154.62);
const conflictCanonical = await account(conflict.description, 332.87);
const category = requireData(await owner.client.from("categories").insert({
  user_id: owner.id, name: "Categoria da fixture MCP", type: "expense",
}).select("id,name").single());
requireData(await owner.client.rpc("save_pluggy_rule", {
  p_rule: { pattern: "fixture", categoryId: category.id, ownership: null, active: true },
}));

const bucket = "hub-import-backups";
const checked = await admin.storage.getBucket(bucket);
if (Number(checked.error?.statusCode) === 404) {
  requireData(await admin.storage.createBucket(bucket, { public: false, allowedMimeTypes: ["application/json"] }));
}
assert.equal(requireData(await admin.storage.getBucket(bucket)).public, false);
const backup = (source, content) => admin.storage.from(bucket).upload(
  `${owner.id}/${source}/${now.replace(/[:.]/g, "-")}-${randomUUID()}/${source}-backup.json`,
  JSON.stringify(content), { contentType: "application/json" },
).then(requireData);
await backup("pluggy", {
  source: "pluggy", version: 1, ownerId: owner.id, itemId, institution: "nubank",
  item: { status: "UPDATED", executionStatus: "SUCCESS", lastUpdatedAt: now },
  fetchedAt: now, period, complete: true, warnings: [], unavailable: [],
  accounts: [{ id: accountId, itemId, type: "BANK", name: "Nubank fixture", currencyCode: "BRL" }],
  transactions: [linked, created, conflict, pending], bills: [], receipts: [],
});
const record = (entity, id, raw, task) => ({
  entity, sourceId: String(id), key: `${entity}:${id}`, raw: { id, ...raw },
  sources: [{ task, raw: { id, ...raw } }],
});
const historicalKey = "transaction:9123409";
const organizzeLink = "transaction:9123410";
const organizzeCreate = "transaction:9123411";
const organizzeMovement = (id, description, amount, tags = []) => record(
  "transaction",
  id,
  { description, amount_cents: amount, paid: true, date: periodDate, account_id: 9123408, category_id: 9123407, tags },
  { path: "/transactions", period: { start: periodDate, end: periodDate } },
);
await backup("organizze", { snapshot: {
  source: "organizze", version: 1, ownerId: owner.id, period, startedAt: now,
  errors: [], receipts: [], tasks: [], rejected: [], unavailable: [],
  records: [
    record("category", 9123407, { name: category.name, kind: "expense" }, { path: "/categories" }),
    record("account", 9123408, { name: "Nubank fixture", type: "Checking" }, { path: "/accounts" }),
    organizzeMovement(9123409, "Histórico fixture", -1087, ["fixture"]),
    organizzeMovement(9123410, linked.description, -15462),
    organizzeMovement(9123411, "Débito de histórico aprovado", -28339),
  ],
} });

const cronSecret = randomBytes(24).toString("hex");
const server = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "3219"], {
  env: {
    ...process.env, NEXT_PUBLIC_SUPABASE_URL: supabase, NEXT_PUBLIC_SUPABASE_ANON_KEY: publicKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey, NEXT_PUBLIC_SITE_URL: base, MCP_PUBLIC_URL: `${base}/api/mcp`,
    MCP_ENABLED: "true", MCP_OAUTH_READY: "true", MCP_ENABLE_WRITES: "true", MCP_DIRECT_WRITES_READY: "true",
    MCP_CONFIRMATION_SECRET: randomBytes(32).toString("hex"), MCP_OAUTH_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
    MCP_ALLOWED_OAUTH_CLIENT_IDS: "https://chatgpt.com/oauth/client.json", MCP_ALLOWED_ORIGINS: base,
    IMPORT_BACKUP_STORAGE: "supabase", CRON_SECRET: cronSecret, ORGANIZZE_HUB_USER_ID: owner.id,
    ORGANIZZE_EMAIL: "", ORGANIZZE_API_KEY: "", PLUGGY_CLIENT_ID: "local-fixture", PLUGGY_CLIENT_SECRET: "local-fixture",
    PLUGGY_HUB_USER_ID: owner.id, PLUGGY_NUBANK_ITEM_ID: itemId,
    PLUGGY_XP_ITEM_ID: "", PLUGGY_SICREDI_ITEM_ID: "", PLUGGY_CAIXA_ITEM_ID: "", PLUGGY_MERCADO_PAGO_ITEM_ID: "",
  },
  stdio: "ignore",
  windowsHide: true,
});

const resource = `${base}/api/mcp`;
const clientId = "https://chatgpt.com/oauth/client.json";
const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";
const call = async (token, method, params = {}) => fetch(resource, {
  method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18",
    ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  signal: AbortSignal.timeout(45_000),
});
const tool = async (token, name, args = {}, shouldFail = false) => {
  const response = await call(token, "tools/call", { name, arguments: args });
  assert.equal(response.status, 200);
  const { result } = await response.json();
  if (result?.isError && !shouldFail) throw new Error(`${name}: ${result.content[0].text}`);
  assert.equal(Boolean(result?.isError), shouldFail, name);
  return shouldFail ? result : JSON.parse(result.content[0].text);
};
const ready = async () => {
  for (let attempt = 0; attempt < 45; attempt++) {
    try { if ((await fetch(`${base}/.well-known/oauth-authorization-server`, { signal: AbortSignal.timeout(5000) })).ok) return; } catch { /* Next is starting. */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error("Local Next server did not start.");
};
async function authorize(user, scope) {
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(16).toString("base64url");
  const codeChallenge = createHash("sha256").update(verifier).digest("base64url");
  const request = new URL("/oauth/authorize", base);
  request.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", state, scope, resource, code_challenge: codeChallenge, code_challenge_method: "S256" });
  const started = await fetch(request, { redirect: "manual" });
  const cookie = started.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie, `OAuth start returned HTTP ${started.status}`);
  const act = async (pageUrl, fields, label) => {
    const page = await fetch(pageUrl, { headers: { cookie } });
    assert.equal(page.status, 200);
    const form = new FormData();
    const html = await page.text();
    for (const input of html.match(/<input\b[^>]*>/gi) ?? []) {
      const attrs = Object.fromEntries([...input.matchAll(/([:$\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
      if (attrs.name) form.set(attrs.name, attrs.value ?? "");
    }
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    const result = await fetch(pageUrl, { method: "POST", headers: { cookie, origin: base, referer: pageUrl.toString() }, body: form, redirect: "manual" });
    assert.ok([302, 303].includes(result.status), `${label} returned HTTP ${result.status}`);
    const location = new URL(result.headers.get("location"), base);
    assert.ok(!location.searchParams.has("error"), `${label} rejected`);
    return location;
  };
  const consent = await act(new URL(started.headers.get("location"), base), { action: "login", email: user.email, password: user.password }, "OAuth login");
  const callback = await act(consent, { action: "approve" }, "OAuth consent");
  assert.equal(callback.origin + callback.pathname, redirectUri);
  assert.equal(callback.searchParams.get("state"), state);
  const response = await fetch(`${base}/oauth/token`, { method: "POST", body: new URLSearchParams({
    grant_type: "authorization_code", client_id: clientId, redirect_uri: redirectUri,
    code: callback.searchParams.get("code"), code_verifier: verifier, resource,
  }) });
  assert.equal(response.status, 200);
  const token = (await response.json()).access_token;
  assert.ok(token?.startsWith("mcp_at_"));
  return token;
}

async function countAccounts() {
  const result = await owner.client.from("accounts_payable").select("id", { count: "exact", head: true });
  assert.ifError(result.error);
  return result.count;
}

try {
  await ready();
  assert.equal((await call(null, "tools/list")).status, 401);
  const token = await authorize(owner, "mcp:read mcp:write offline_access");
  const otherToken = await authorize(outsider, "mcp:read offline_access");
  const initialized = await call(token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "isolated-test", version: "1" } });
  assert.equal((await initialized.json()).result?.protocolVersion, "2025-06-18");
  const listed = await call(token, "tools/list");
  assert.equal((await listed.json()).result?.tools?.length, 82);
  await tool(otherToken, "hub_get_import_connections", {}, true);
  await tool(otherToken, "hub_confirm_import_reviews", { confirmationId: randomUUID(), confirmationText: "CONFIRMO CONCILIAR" }, true);
  const connections = await tool(token, "hub_get_import_connections");
  assert.equal(connections.banks.length, 5);
  assert.equal(connections.organizze.reviewReady, true);
  assert.equal(connections.pluggyReviewReady, true);
  const rules = await tool(token, "hub_list_import_rules");
  assert.ok(rules.rules.some(rule => rule.categoryId === category.id));
  const persisted = await tool(token, "hub_refresh_import_inbox");
  assert.equal(persisted.persisted, 4);
  const find = async (key) => tool(token, "hub_get_import_movement", { sourceKey: key });
  assert.ok((await find(sourceKey(linked))).candidates.some(row => row.id === canonical.id));
  assert.deepEqual((await find(historicalKey)).tags, ["fixture"]);
  assert.equal((await tool(token, "hub_list_import_movements", { source: "pluggy", institution: "nubank", start: period.start, end: period.end, limit: 1 })).total, 4);
  const selected = async (key, action, extra = {}) => ({ sourceKey: key, expectedUpdatedAt: (await find(key)).expectedUpdatedAt, action, ...extra });
  const prepare = async (items) => tool(token, "hub_prepare_import_reviews", { items });
  const confirm = async (proposal, phrase = proposal.confirmationText, shouldFail = false) => tool(token, "hub_confirm_import_reviews", { confirmationId: proposal.confirmationId, confirmationText: phrase }, shouldFail);
  const create = { ownership: "family", confirmOrdinaryMovement: true };
  assert.equal((await prepare([await selected(sourceKey(pending), "create", create)])).confirmationId, null);
  const target = canonical => ({ target: "accounts_payable", targetId: canonical.id });
  const before = await countAccounts();
  const proposal = await prepare([
    await selected(sourceKey(pending), "classify", { categoryId: category.id, ownership: null }),
    await selected(sourceKey(linked), "link", target(canonical)),
    await selected(sourceKey(created), "create", create),
    await selected(sourceKey(conflict), "link", target(conflictCanonical)),
    await selected(historicalKey, "classify", { categoryId: category.id, ownership: "family" }),
    await selected(organizzeLink, "link", target(canonical)),
    await selected(organizzeCreate, "create", create),
  ]);
  assert.ok(proposal.confirmationId, JSON.stringify(proposal.items.map(item => item.error ?? "prepared")));
  assert.equal(await countAccounts(), before);
  await confirm(proposal, "sim", true);
  requireData(await owner.client.from("accounts_payable").update({ title: "Conflito de versão fixture" }).eq("id", conflictCanonical.id));
  const result = await confirm(proposal);
  assert.deepEqual(result.items.map(item => item.ok), [true, true, true, false, true, true, true], JSON.stringify(result.items.map(item => item.error)));
  assert.equal(result.items[3].code, "40001");
  assert.deepEqual(await confirm(proposal), result);
  assert.equal(await countAccounts(), before + 2);
  assert.equal((await find(sourceKey(pending))).ownership, null);
  assert.equal((await find(historicalKey)).selectedCategoryId, category.id);
  assert.equal((await find(sourceKey(linked))).review.targetId, canonical.id);
  assert.equal((await find(organizzeLink)).targetId, canonical.id);
  assert.equal((await find(organizzeCreate)).targetId, result.items[6].result.targetId);
  assert.equal((await find(sourceKey(created))).review.targetId, result.items[2].result.targetId);
  assert.equal((await find(sourceKey(conflict))).review.targetId, null);
  const events = requireData(await admin.from("audit_logs").select("id").eq("record_id", proposal.confirmationId));
  assert.equal(events.length, 6);
  const merchantProposal = await prepare([await selected(sourceKey(linked), "remember_merchant", { merchantName: "Comércio sintético", categoryId: category.id })]);
  assert.ok(merchantProposal.confirmationId);
  const merchantResult = await confirm(merchantProposal);
  assert.equal(merchantResult.items[0].ok, true);
  assert.deepEqual(await confirm(merchantProposal), merchantResult);
  const association = (await tool(token, "hub_list_import_rules")).merchants.find(row => row.id === merchantResult.items[0].result.associationId);
  assert.equal(association.name, "Comércio sintético");
  const recognized = await find(sourceKey(linked));
  assert.equal(recognized.merchant.status, "recognized");
  assert.equal(recognized.review.targetId, canonical.id);
  assert.equal(recognized.ownership, null);
  assert.equal((await tool(token, "hub_list_import_movements", { merchantStatus: "recognized" })).total, 1);
  const webReplay = requireData(await owner.client.rpc("save_pluggy_merchant", {
    p_change: {
      sourceKey: sourceKey(linked), expectedUpdatedAt: recognized.expectedUpdatedAt,
      name: association.name, categoryId: category.id, channel: "web", active: true,
      evidence: { original: linked.description, pattern: linked.description.toLowerCase() },
    },
  }));
  assert.equal(webReplay, association.id);
  const disabled = await prepare([{ sourceKey: association.sourceKey, expectedUpdatedAt: association.updatedAt, action: "disable_merchant" }]);
  assert.equal((await confirm(disabled)).items[0].ok, true);
  assert.notEqual((await find(sourceKey(linked))).merchant.status, "recognized");
  assert.equal(await countAccounts(), before + 2);
  console.log("PASS: OAuth/PKCE, catálogo de 82 ferramentas, isolamento, leitura, filtros e regras.");
  console.log("PASS: proposta sem escrita, classificação, vínculo, criação aprovada, conflito real, replay e auditoria.");
  console.log("PASS: associação comercial aprovada, reconhecimento, replay e desativação sem alterar o vínculo.");

  const sync = () => fetch(`${base}/api/pluggy/sync`, { headers: { Authorization: `Bearer ${cronSecret}` }, signal: AbortSignal.timeout(45_000) });
  assert.equal((await fetch(`${base}/api/pluggy/sync`)).status, 401);
  assert.equal((await fetch(`${base}/api/pluggy/sync`, { headers: { Authorization: "Bearer invalid-local-fixture" } })).status, 401);
  const run = await sync();
  assert.equal(run.status, 200);
  const report = await run.json();
  assert.equal(report.reportPersisted, true);
  assert.equal(report.results.length, 5);
  assert.equal(report.results.find(row => row.institution === "nubank").status, "recent");
  assert.equal((await tool(token, "hub_get_import_connections")).lastSync.finishedAt, report.finishedAt);
  assert.equal(requireData(await outsider.client.storage.from(bucket).list(`${owner.id}/pluggy-sync`)).length, 0);
  assert.equal(await countAccounts(), before + 2);
  console.log("PASS: cron exige bearer, relatório persistido no Storage privado, nenhuma escrita financeira.");
} finally {
  server.kill();
}
