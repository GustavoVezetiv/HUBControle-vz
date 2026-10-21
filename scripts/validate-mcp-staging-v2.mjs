import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

const env = process.env;
const expectedRef = env.MCP_STAGING_EXPECTED_PROJECT_REF;
assert.equal(env.MCP_STAGING_CONFIRM, "isolated-synthetic-only", "Confirmação explícita do staging é obrigatória.");
assert.match(expectedRef ?? "", /^[a-z0-9]{20}$/, "MCP_STAGING_EXPECTED_PROJECT_REF é obrigatório.");

const required = [
  "MCP_STAGING_SUPABASE_URL",
  "MCP_STAGING_SUPABASE_ANON_KEY",
  "MCP_STAGING_SERVICE_ROLE_KEY",
  "MCP_STAGING_USER_A_EMAIL",
  "MCP_STAGING_USER_A_PASSWORD",
  "MCP_STAGING_USER_B_EMAIL",
  "MCP_STAGING_USER_B_PASSWORD",
];
for (const name of required) assert.ok(env[name], `${name} é obrigatório.`);

const stagingUrl = new URL(env.MCP_STAGING_SUPABASE_URL);
assert.equal(stagingUrl.protocol, "https:");
assert.equal(stagingUrl.hostname, `${expectedRef}.supabase.co`, "A URL não pertence ao staging autorizado.");
assert.notEqual(env.MCP_STAGING_USER_A_EMAIL, env.MCP_STAGING_USER_B_EMAIL);

const localEnvPath = new URL("../.env.local", import.meta.url);
if (existsSync(localEnvPath)) {
  const localEnv = readFileSync(localEnvPath, "utf8");
  const productionUrl = /^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m.exec(localEnv)?.[1]?.trim().replace(/^['"]|['"]$/g, "");
  if (productionUrl) assert.notEqual(stagingUrl.origin, new URL(productionUrl).origin, "O teste se recusa a usar o projeto configurado localmente.");
}

const clientOptions = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const admin = createClient(stagingUrl.origin, env.MCP_STAGING_SERVICE_ROLE_KEY, clientOptions);

async function ensureUser(email, password, label) {
  const existing = await findUser(email);
  if (existing) {
    const updated = await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true, user_metadata: { test_fixture: "hub-mcp-staging", label } });
    assert.ifError(updated.error);
    return existing.id;
  }
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { test_fixture: "hub-mcp-staging", label } });
  assert.ifError(created.error);
  assert.ok(created.data.user);
  return created.data.user.id;
}

async function findUser(email) {
  for (let page = 1; page <= 10; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 100 });
    assert.ifError(result.error);
    const found = result.data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (result.data.users.length < 100) return null;
  }
  throw new Error("Limite de busca de usuários excedido.");
}

async function login(email, password) {
  const client = createClient(stagingUrl.origin, env.MCP_STAGING_SUPABASE_ANON_KEY, clientOptions);
  const result = await client.auth.signInWithPassword({ email, password });
  assert.ifError(result.error);
  assert.ok(result.data.user && result.data.session);
  return { client, user: result.data.user, accessToken: result.data.session.access_token };
}

const userAId = await ensureUser(env.MCP_STAGING_USER_A_EMAIL, env.MCP_STAGING_USER_A_PASSWORD, "A");
const userBId = await ensureUser(env.MCP_STAGING_USER_B_EMAIL, env.MCP_STAGING_USER_B_PASSWORD, "B");
assert.notEqual(userAId, userBId);
const userA = await login(env.MCP_STAGING_USER_A_EMAIL, env.MCP_STAGING_USER_A_PASSWORD);
const userB = await login(env.MCP_STAGING_USER_B_EMAIL, env.MCP_STAGING_USER_B_PASSWORD);

const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const categoryA = await userA.client.from("categories").insert({
  user_id: userA.user.id,
  name: `MCP Staging ${stamp}`,
  type: "planned_purchase",
  color: "#0f766e",
}).select("id").single();
assert.ifError(categoryA.error);

const accountA = await userA.client.from("accounts_payable").insert({
  user_id: userA.user.id,
  category_id: categoryA.data.id,
  title: `Conta fictícia MCP ${stamp}`,
  amount: 123.45,
  due_date: new Date().toISOString().slice(0, 10),
  status: "pending",
}).select("id").single();
assert.ifError(accountA.error);

const incomeA = await userA.client.from("income_sources").insert({
  user_id: userA.user.id,
  name: `Receita fictícia MCP ${stamp}`,
  amount: 500,
  expected_date: new Date().toISOString().slice(0, 10),
  inflow_kind: "real_income",
  status: "expected",
}).select("id").single();
assert.ifError(incomeA.error);

const ownRead = await userA.client.from("accounts_payable").select("id,title").eq("id", accountA.data.id).single();
assert.ifError(ownRead.error);
const crossRead = await userB.client.from("accounts_payable").select("id").eq("id", accountA.data.id);
assert.ifError(crossRead.error);
assert.equal(crossRead.data.length, 0, "Usuário B não pode ler a conta do usuário A.");
const crossUpdate = await userB.client.from("accounts_payable").update({ title: "Tentativa cruzada" }).eq("id", accountA.data.id).select("id");
assert.ifError(crossUpdate.error);
assert.equal(crossUpdate.data.length, 0, "Usuário B não pode alterar a conta do usuário A.");

for (const table of ["mcp_action_requests", "mcp_oauth_records", "mcp_write_operations"]) {
  const denied = await userA.client.from(table).select("*").limit(1);
  assert.ok(denied.error, `${table} deve ser inacessível ao papel authenticated.`);
}

const directWrite = (userId, idempotencyKey, toolName, args) => admin.rpc("mcp_execute_direct_write_v1", {
  p_user_id: userId,
  p_idempotency_key: idempotencyKey,
  p_tool_name: toolName,
  p_arguments: args,
});

const purchaseTitle = `Compra planejada MCP ${stamp}`;
const createArgs = { title: purchaseTitle, estimatedAmount: 777.77, categoryId: categoryA.data.id, notes: "Dado sintético" };
const createKey = `staging.purchase.${stamp}`;
const created = await directWrite(userA.user.id, createKey, "hub_create_planned_purchase", createArgs);
assert.ifError(created.error);
assert.equal(created.data.title, purchaseTitle);

const replay = await directWrite(userA.user.id, createKey, "hub_create_planned_purchase", createArgs);
assert.ifError(replay.error);
assert.equal(replay.data.operationId, created.data.operationId);
assert.equal(replay.data.idempotentReplay, true);

const tampered = await directWrite(userA.user.id, createKey, "hub_create_planned_purchase", { ...createArgs, estimatedAmount: 1 });
assert.ok(tampered.error, "A mesma chave com argumentos diferentes deve falhar.");

const purchaseCount = await userA.client.from("planned_purchases").select("id", { count: "exact", head: true }).eq("title", purchaseTitle);
assert.ifError(purchaseCount.error);
assert.equal(purchaseCount.count, 1, "Replay não pode duplicar o registro.");

const purchase = await userA.client.from("planned_purchases").select("id,updated_at").eq("id", created.data.id).single();
assert.ifError(purchase.error);
const updated = await directWrite(userA.user.id, `staging.purchase.update.${stamp}`, "hub_update_planned_purchase", {
  id: purchase.data.id,
  expectedUpdatedAt: purchase.data.updated_at,
  estimatedAmount: 800,
});
assert.ifError(updated.error);
assert.equal(updated.data.estimatedAmount, 800);

const stale = await directWrite(userA.user.id, `staging.purchase.stale.${stamp}`, "hub_update_planned_purchase", {
  id: purchase.data.id,
  expectedUpdatedAt: purchase.data.updated_at,
  estimatedAmount: 900,
});
assert.ok(stale.error, "Versão desatualizada deve falhar.");

const crossWrite = await directWrite(userB.user.id, `staging.cross.${stamp}`, "hub_update_planned_purchase", {
  id: purchase.data.id,
  expectedUpdatedAt: updated.data.updatedAt,
  estimatedAmount: 1,
});
assert.ok(crossWrite.error, "Usuário B não pode editar compra do usuário A.");

const authenticatedRpc = await userA.client.rpc("mcp_execute_direct_write_v1", {
  p_user_id: userA.user.id,
  p_idempotency_key: `staging.bypass.${stamp}`,
  p_tool_name: "hub_create_goal",
  p_arguments: { name: `Bypass ${stamp}` },
});
assert.ok(authenticatedRpc.error, "Papel authenticated não pode executar a RPC server-only.");

const duplicateKey = `staging.duplicate.${stamp}`;
const duplicate = await directWrite(userA.user.id, duplicateKey, "hub_create_planned_purchase", createArgs);
assert.ok(duplicate.error, "Duplicidade de negócio deve provocar rollback.");
const failedReceipt = await admin.from("mcp_write_operations").select("id").eq("user_id", userA.user.id).eq("idempotency_key", duplicateKey);
assert.ifError(failedReceipt.error);
assert.equal(failedReceipt.data.length, 0, "Falha não pode persistir recibo idempotente.");

const audit = await userA.client.from("audit_logs").select("id,metadata").eq("record_id", created.data.id).eq("action", "create").single();
assert.ifError(audit.error);
assert.equal(audit.data.metadata.idempotencyKey, createKey);

if (env.MCP_STAGING_BASE_URL && env.MCP_STAGING_ACCESS_TOKEN_A) {
  const endpoint = new URL("/api/mcp", env.MCP_STAGING_BASE_URL).toString();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.MCP_STAGING_ACCESS_TOKEN_A}`,
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "hub_list_accounts", arguments: { limit: 20 } } }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result?.isError, undefined);
  assert.ok(body.result?.structuredContent?.items?.some((item) => item.id === accountA.data.id));

  const directBypass = createClient(stagingUrl.origin, env.MCP_STAGING_SUPABASE_ANON_KEY, {
    ...clientOptions,
    global: { headers: { Authorization: `Bearer ${env.MCP_STAGING_ACCESS_TOKEN_A}` } },
  });
  const bypass = await directBypass.from("accounts_payable").select("id").limit(1);
  assert.ok(bypass.error, "Token opaco do MCP não pode autenticar na Data API.");
} else {
  console.log("SKIP HTTP MCP: configure MCP_STAGING_BASE_URL e MCP_STAGING_ACCESS_TOKEN_A após publicar um ambiente isolado.");
}

console.log(JSON.stringify({
  ok: true,
  projectRef: expectedRef,
  users: [userA.user.id, userB.user.id],
  fixtures: { categoryId: categoryA.data.id, accountId: accountA.data.id, incomeId: incomeA.data.id, plannedPurchaseId: created.data.id },
  checks: [
    "two-user-rls",
    "cross-user-update-denied",
    "private-mcp-tables-denied",
    "server-only-direct-rpc",
    "direct-create-update",
    "replay-idempotency",
    "tampered-key-denied",
    "optimistic-concurrency",
    "duplicate-rollback",
    "audit-created",
  ],
}, null, 2));
