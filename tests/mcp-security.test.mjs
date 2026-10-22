import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  extractBearerToken,
  isAllowedMcpOrigin,
  areMcpWritesEnabled,
  canDecideMcpProposal,
  isExecutableMcpIntent,
  isMcpEnabled,
  signMcpIntent,
  verifyMcpIntent,
} from "../src/features/mcp/security.ts";
import { openOAuthValue, sealOAuthValue, sha256 } from "../src/features/mcp/oauth/crypto.ts";
import { parseAuthorizationRequest, verifyPkce } from "../src/features/mcp/oauth/policy.ts";
import { canonicalizeMcpResource } from "../src/features/mcp/oauth/constants.ts";
import { acceptsMcpProtocolHeader, negotiateMcpProtocolVersion } from "../src/features/mcp/protocol.ts";

test("negotiates current and older MCP clients instead of rejecting initialization", () => {
  for (const version of ["2025-11-25", "2025-06-18", "2025-03-26"]) {
    assert.equal(negotiateMcpProtocolVersion(version), version);
    assert.equal(acceptsMcpProtocolHeader("tools/list", version), true);
  }
  assert.equal(negotiateMcpProtocolVersion("2099-01-01"), "2025-11-25");
  assert.equal(negotiateMcpProtocolVersion(undefined), "2025-11-25");
  assert.equal(acceptsMcpProtocolHeader("initialize", "2099-01-01"), true);
  assert.equal(acceptsMcpProtocolHeader("tools/list", "2099-01-01"), false);
  assert.equal(acceptsMcpProtocolHeader("tools/call", "invalid"), false);
  assert.equal(acceptsMcpProtocolHeader("notifications/initialized", "2025-11-25"), true);
  assert.equal(acceptsMcpProtocolHeader("tools/list", null), true);
});

test("rejects missing and malformed MCP authentication", () => {
  assert.equal(extractBearerToken(null), null);
  assert.equal(extractBearerToken("Basic abc"), null);
  assert.equal(extractBearerToken("Bearer "), null);
  assert.equal(extractBearerToken("Bearer user-token"), "user-token");
});

test("allows server-to-server requests and only known browser origins", () => {
  assert.equal(isAllowedMcpOrigin(null, "https://hub.vezetiv.dev"), true);
  assert.equal(isAllowedMcpOrigin("https://hub.vezetiv.dev", "https://hub.vezetiv.dev"), true);
  assert.equal(isAllowedMcpOrigin("http://localhost:3000", "https://hub.vezetiv.dev"), false);
  assert.equal(isAllowedMcpOrigin("http://localhost:3000", "http://localhost:3000"), true);
  assert.equal(isAllowedMcpOrigin("https://untrusted.example", "https://hub.vezetiv.dev"), false);
});

test("requires the ChatGPT client, canonical MCP resource, redirect and PKCE S256", () => {
  const previous = process.env.MCP_PUBLIC_URL;
  process.env.MCP_PUBLIC_URL = "https://mcp-staging.example/api/mcp";
  try {
    const verifier = "v".repeat(43);
    const url = new URL("https://mcp-staging.example/oauth/authorize");
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: "https://chatgpt.com/oauth/client.json",
      redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
      state: "state-1",
      resource: "https://mcp-staging.example/api/mcp",
      scope: "mcp:read offline_access",
      code_challenge: sha256(verifier),
      code_challenge_method: "S256",
    }).toString();
    const parsed = parseAuthorizationRequest(url);
    assert.equal(parsed.resource, process.env.MCP_PUBLIC_URL);
    const trailingSlash = new URL(url);
    trailingSlash.searchParams.set("resource", `${process.env.MCP_PUBLIC_URL}/`);
    assert.equal(parseAuthorizationRequest(trailingSlash).resource, process.env.MCP_PUBLIC_URL);
    assert.equal(canonicalizeMcpResource(`${process.env.MCP_PUBLIC_URL}/`), process.env.MCP_PUBLIC_URL);
    for (const rejectedResource of [
      "https://mcp-staging.example",
      "https://mcp-staging.example/api/mcp/extra",
      "https://mcp-staging.example/api/mcp?tenant=other",
      "https://other.example/api/mcp",
      "authenticated",
    ]) {
      const rejected = new URL(url);
      rejected.searchParams.set("resource", rejectedResource);
      assert.throws(() => parseAuthorizationRequest(rejected), /Resource/);
    }
    assert.equal(verifyPkce(verifier, parsed.codeChallenge), true);
    assert.equal(verifyPkce("x".repeat(43), parsed.codeChallenge), false);
    const plainPkce = new URL(url);
    plainPkce.searchParams.set("code_challenge_method", "plain");
    assert.throws(() => parseAuthorizationRequest(plainPkce), /S256/);
  } finally {
    if (previous === undefined) delete process.env.MCP_PUBLIC_URL;
    else process.env.MCP_PUBLIC_URL = previous;
  }
});

test("OAuth records are encrypted and bound to their record identity", () => {
  const previous = process.env.MCP_OAUTH_ENCRYPTION_KEY;
  process.env.MCP_OAUTH_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64url");
  try {
    const sealed = sealOAuthValue({ accessToken: "supabase-secret", userId: "user-a" }, "access:key-a");
    assert.doesNotMatch(sealed, /supabase-secret|user-a/);
    assert.deepEqual(openOAuthValue(sealed, "access:key-a"), { accessToken: "supabase-secret", userId: "user-a" });
    assert.throws(() => openOAuthValue(sealed, "access:key-b"));
    const tampered = `${sealed.slice(0, -1)}${sealed.endsWith("A") ? "B" : "A"}`;
    assert.throws(() => openOAuthValue(tampered, "access:key-a"));
  } finally {
    if (previous === undefined) delete process.env.MCP_OAUTH_ENCRYPTION_KEY;
    else process.env.MCP_OAUTH_ENCRYPTION_KEY = previous;
  }
});

test("direct write access fails closed without both explicit staging gates", () => {
  const previous = [process.env.MCP_ENABLED, process.env.MCP_OAUTH_READY, process.env.MCP_ENABLE_WRITES, process.env.MCP_DIRECT_WRITES_READY];
  try {
    process.env.MCP_ENABLED = "true";
    process.env.MCP_OAUTH_READY = "false";
    assert.equal(isMcpEnabled(), false);
    process.env.MCP_OAUTH_READY = "true";
    assert.equal(isMcpEnabled(), true);
    process.env.MCP_ENABLE_WRITES = "true";
    delete process.env.MCP_DIRECT_WRITES_READY;
    assert.equal(areMcpWritesEnabled(), false);
    process.env.MCP_DIRECT_WRITES_READY = "true";
    assert.equal(areMcpWritesEnabled(), true);
    process.env.MCP_ENABLED = "false";
    assert.equal(areMcpWritesEnabled(), false);
  } finally {
    ["MCP_ENABLED", "MCP_OAUTH_READY", "MCP_ENABLE_WRITES", "MCP_DIRECT_WRITES_READY"].forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
});

test("signed preparation is bound to user, action, arguments and expiry", () => {
  const secret = "isolated-test-secret";
  const intent = { id: "action-1", userId: "user-1", toolName: "hub_update_goal", arguments: { name: "Meta", _version: null }, expiresAt: "2026-10-07T12:00:00.000Z" };
  const signature = signMcpIntent(intent, secret);
  assert.equal(verifyMcpIntent({ ...intent, arguments: { _version: null, name: "Meta" }, expiresAt: "2026-10-07T12:00:00+00:00" }, signature, secret), true);
  assert.equal(verifyMcpIntent({ ...intent, userId: "user-2" }, signature, secret), false);
  assert.equal(verifyMcpIntent({ ...intent, arguments: { name: "Outra" } }, signature, secret), false);
  assert.equal(verifyMcpIntent({ ...intent, toolName: "hub_create_transaction" }, signature, secret), false);
  assert.equal(verifyMcpIntent({ ...intent, expiresAt: "2026-10-07T12:01:00.000Z" }, signature, secret), false);
  assert.equal(verifyMcpIntent(intent, "bad", secret), false);
});

test("only pending, unexpired intentions can be approved in the Hub", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  assert.equal(isExecutableMcpIntent("pending", "2026-10-07T12:00:01Z", now), true);
  assert.equal(isExecutableMcpIntent("pending", "2026-10-07T12:00:00Z", now), false);
  assert.equal(isExecutableMcpIntent("completed", "2026-10-07T12:00:01Z", now), false);
  assert.equal(isExecutableMcpIntent("processing", "2026-10-07T12:00:01Z", now), false);
  assert.equal(isExecutableMcpIntent("pending", "invalid", now), false);
  const secret = "isolated-test-secret";
  const proposal = { id: "action-1", userId: "user-1", toolName: "hub_update_goal", arguments: { id: "goal-1", name: "Nova meta", _version: "v1" }, expiresAt: "2026-10-07T12:00:01Z", status: "pending" };
  const signed = { ...proposal, signature: signMcpIntent(proposal, secret) };
  assert.equal(canDecideMcpProposal(signed, "user-1", secret, now), true);
  assert.equal(canDecideMcpProposal(signed, "user-2", secret, now), false);
  assert.equal(canDecideMcpProposal({ ...signed, arguments: { ...signed.arguments, name: "Outra" } }, "user-1", secret, now), false);
  assert.equal(canDecideMcpProposal({ ...signed, status: "completed" }, "user-1", secret, now), false);
  assert.equal(canDecideMcpProposal(signed, "user-1", secret, now + 1000), false);
  assert.equal(canDecideMcpProposal({ ...signed, toolName: "hub_create_transaction" }, "user-1", secret, now), false);
});

test("static MCP contract exposes direct writes with idempotency and no dashboard proposal", () => {
  const tools = readFileSync(new URL("../src/features/mcp/tools.ts", import.meta.url), "utf8");
  const admin = readFileSync(new URL("../src/features/mcp/admin.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../src/app/api/mcp/route.ts", import.meta.url), "utf8");
  const consent = readFileSync(new URL("../src/app/oauth/connect/page.tsx", import.meta.url), "utf8");
  assert.match(tools, /write\("hub_create_account"/);
  assert.match(tools, /write\("hub_create_transaction"/);
  assert.match(tools, /write\("hub_register_reimbursement_receipt"/);
  assert.match(tools, /idempotencyKey/);
  assert.match(tools, /mcp:write/);
  assert.match(tools, /executeMcpDirectWrite/);
  assert.match(admin, /\.rpc\("mcp_execute_direct_write_v2"/);
  assert.match(admin, /p_user_id: input\.userId/);
  assert.doesNotMatch(tools, /hub_confirm_action/);
  assert.doesNotMatch(route, /prepareWriteTool/);
  assert.match(route, /runWriteTool/);
  assert.match(route, /auth\.scopes\.includes\("mcp:write"\)/);
  assert.match(consent, /Autorizar leitura e escrita/);
  assert.match(consent, /view\.scope\.includes\("mcp:write"\)/);
});

test("extended MCP contract keeps a closed module allowlist and confirmation boundaries", () => {
  const tools = readFileSync(new URL("../src/features/mcp/module-tools.ts", import.meta.url), "utf8");
  const sql = readFileSync(
    new URL("../supabase/migrations/202610120001_mcp_complete_modules.sql", import.meta.url),
    "utf8",
  );

  for (const tool of [
    "hub_search_people",
    "hub_search_categories",
    "hub_create_account_detailed",
    "hub_create_subscription",
    "hub_import_subscriptions",
    "hub_create_installment",
    "hub_register_installment_payment",
    "hub_create_payment_plan",
    "hub_create_place",
    "hub_create_note",
    "hub_archive_record",
  ]) {
    assert.match(tools, new RegExp(`"${tool}"`));
  }
  for (const tool of [
    "hub_create_account_detailed",
    "hub_create_subscription",
    "hub_import_subscriptions",
    "hub_create_installment",
    "hub_register_installment_payment",
    "hub_create_payment_plan",
    "hub_create_place",
    "hub_create_note",
    "hub_archive_record",
  ]) {
    assert.match(sql, new RegExp(`'${tool}'`));
  }

  assert.match(sql, /create or replace function public\.mcp_execute_direct_write_v2/);
  assert.match(sql, /return public\.mcp_execute_direct_write_v1/);
  assert.match(sql, /mcp_require_owned_reference_v1/);
  assert.match(sql, /min\(id::text\)::uuid/);
  assert.match(sql, /insert into public\.subscription_members/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /idempotentReplay/);
  assert.match(sql, /CONFIRMO ARQUIVAR/);
  assert.match(sql, /CONFIRMO EXCLUIR/);
  assert.match(sql, /CONFIRMO ALTERAR FATURA QUITADA/);
  assert.match(sql, /'updatedAt',v_after->>'updated_at'/);
  assert.match(sql, /grant execute on function public\.mcp_execute_direct_write_v2\(uuid, text, text, jsonb\) to service_role/);
  assert.doesNotMatch(sql, /grant execute on function public\.mcp_execute_direct_write_v2\([^)]*\) to authenticated/);
  assert.match(sql, /v_table := case v_module/);
  assert.doesNotMatch(sql, /execute immediate/);
});

test("static migration keeps OAuth sessions and proposal signatures server-only", () => {
  const sql = readFileSync(new URL("../supabase/migrations/202610070001_mcp_action_requests.sql", import.meta.url), "utf8");
  const admin = readFileSync(new URL("../src/features/mcp/admin.ts", import.meta.url), "utf8");
  const tools = readFileSync(new URL("../src/features/mcp/tools.ts", import.meta.url), "utf8");
  const approvals = readFileSync(new URL("../src/app/dashboard/mcp-approvals/actions.ts", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.mcp_oauth_records/);
  assert.match(sql, /revoke all on public\.mcp_oauth_records from public, anon, authenticated/);
  assert.match(sql, /grant select, insert, update, delete on public\.mcp_oauth_records to service_role/);
  assert.doesNotMatch(sql, /auth\.jwt\(\) ->> 'client_id'/);
  assert.match(sql, /revoke all on public\.mcp_action_requests from public, anon, authenticated/);
  assert.match(sql, /grant select, insert, update on public\.mcp_action_requests to service_role/);
  assert.doesNotMatch(sql, /mcp_action_requests_insert_own/);
  assert.doesNotMatch(sql, /grant select, insert on public\.mcp_action_requests to authenticated/);
  assert.match(admin, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(admin, /\.eq\("user_id", userId\)/);
  assert.doesNotMatch(tools, /createMcpActionRequest/);
  assert.match(approvals, /getMcpActionRequest\(user\.id, id\)/);
  assert.match(sql, /security definer/);
  assert.match(sql, /for update;/);
  assert.match(sql, /insert into public\.audit_logs/);
  assert.match(sql, /update public\.mcp_action_requests\s+set status = 'completed'/);
  assert.match(sql, /alter function public\.set_updated_at\(\) set search_path/);
  assert.match(sql, /revoke all on function public\.handle_new_user\(\) from public, anon, authenticated/);
});

test("authenticated API grants exclude private MCP tables", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/202610090001_authenticated_app_table_grants.sql", import.meta.url),
    "utf8",
  );

  assert.match(sql, /c\.relname not in \('mcp_action_requests', 'mcp_oauth_records'\)/);
  assert.match(sql, /grant select, insert, update, delete on table public\.%I to authenticated/);
  assert.match(sql, /revoke all on table public\.mcp_action_requests from public, anon, authenticated/);
  assert.match(sql, /revoke all on table public\.mcp_oauth_records from public, anon, authenticated/);
});

test("direct-write migration is atomic, idempotent, audited and server-private", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/202610100001_mcp_direct_writes.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /create table if not exists public\.mcp_write_operations/);
  assert.match(sql, /unique \(user_id, idempotency_key\)/);
  assert.match(sql, /revoke all on public\.mcp_write_operations from public, anon, authenticated/);
  assert.match(sql, /create or replace function public\.mcp_execute_direct_write_v1/);
  assert.match(sql, /security definer/);
  assert.match(sql, /p_user_id uuid/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /idempotentReplay/);
  assert.match(sql, /insert into public\.audit_logs/);
  assert.match(sql, /reimbursement_received/);
  assert.match(sql, /CONFIRMO ALTERAR FATURA QUITADA/);
  assert.match(sql, /revoke all on function public\.mcp_decide_planning_action\(uuid, text, text\) from public, anon, authenticated/);
  assert.match(sql, /revoke all on function public\.mcp_execute_direct_write_v1\(uuid, text, text, jsonb\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.mcp_execute_direct_write_v1\(uuid, text, text, jsonb\) to service_role/);
  assert.doesNotMatch(sql, /grant execute on function public\.mcp_execute_direct_write_v1\([^)]*\) to authenticated/);
  assert.doesNotMatch(sql, /grant .*mcp_write_operations.*authenticated/);
});

test("official production migration is consolidated, reversible and does not widen app grants", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/202610110001_mcp_official_production.sql", import.meta.url),
    "utf8",
  );
  const rollback = readFileSync(
    new URL("../docs/MCP_PRODUCTION_ROLLBACK.sql", import.meta.url),
    "utf8",
  );

  assert.match(sql, /^-- Consolidated production migration/m);
  assert.match(sql, /begin;/);
  assert.match(sql, /commit;/);
  assert.match(sql, /set local lock_timeout = '5s'/);
  assert.match(sql, /create table if not exists public\.mcp_oauth_records/);
  assert.match(sql, /create table if not exists public\.mcp_write_operations/);
  assert.match(sql, /unique \(user_id, idempotency_key\)/);
  assert.match(sql, /alter function public\.set_updated_at\(\)\s+set search_path = pg_catalog, public/);
  assert.match(sql, /alter function public\.create_default_categories_for_current_user\(\)\s+set search_path = pg_catalog, public, auth/);
  assert.match(sql, /revoke all on function public\.handle_new_user\(\) from public, anon, authenticated/);
  assert.match(sql, /create or replace function public\.mcp_execute_direct_write_v1/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /insert into public\.audit_logs/);
  assert.match(sql, /grant execute on function public\.mcp_execute_direct_write_v1\(uuid, text, text, jsonb\) to service_role/);
  assert.doesNotMatch(sql, /grant (select|insert|update|delete).*authenticated/);
  assert.doesNotMatch(sql, /grant execute .* to authenticated/);
  assert.doesNotMatch(sql, /create table if not exists public\.mcp_action_requests/);
  assert.match(rollback, /drop function if exists public\.mcp_execute_direct_write_v1/);
  assert.match(rollback, /set status = 'revoked'/);
  assert.doesNotMatch(rollback, /drop table/);
});

test("official private plugin is isolated from staging and points to production MCP", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../plugins/hub-vz-official/plugin.json", import.meta.url), "utf8"),
  );
  const mcp = JSON.parse(
    readFileSync(new URL("../plugins/hub-vz-official/mcp.json", import.meta.url), "utf8"),
  );
  const skill = readFileSync(
    new URL("../plugins/hub-vz-official/skills/hub-vz/SKILL.md", import.meta.url),
    "utf8",
  );

  assert.equal(manifest.name, "hub-vz-official");
  assert.equal(manifest.extensions["com.openai"].interface.displayName, "Hub VZ - Oficial");
  assert.ok(manifest.extensions["com.openai"].interface.shortDescription.length <= 30);
  assert.equal(
    mcp.mcpServers["hub-vz-official"].url,
    "https://hub.vezetiv.dev/api/mcp",
  );
  assert.doesNotMatch(JSON.stringify({ manifest, mcp }), /staging|zoafgwedojkpyptvmpgt/i);
  assert.match(skill, /chave de idempotencia estavel/);
  assert.match(skill, /confirmacao explicita do usuario/);
  assert.match(skill, /Nao execute pagamentos bancarios/);
});

test("OAuth token revocation is grant-wide", () => {
  const store = readFileSync(new URL("../src/features/mcp/oauth/store.ts", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/features/mcp/oauth/service.ts", import.meta.url), "utf8");

  assert.match(store, /export async function revokeOAuthGrant/);
  assert.match(store, /payload\.grantId === grantId/);
  assert.match(store, /\.in\("key_hash", matchingHashes\)/);
  assert.match(service, /grantId: crypto\.randomUUID\(\)/);
  assert.match(service, /revokeOAuthGrant\(record\.grantId\)/);
});
