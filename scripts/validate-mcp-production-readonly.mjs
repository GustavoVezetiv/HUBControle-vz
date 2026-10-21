import assert from "node:assert/strict";

const baseUrl = new URL(
  process.env.MCP_PRODUCTION_TEST_BASE_URL ?? "https://hub.vezetiv.dev",
);
const resource = new URL("/api/mcp", baseUrl).toString();
const accessToken = process.env.MCP_PRODUCTION_TEST_ACCESS_TOKEN?.trim();
const expectedToolCount = Number(
  process.env.MCP_PRODUCTION_TEST_EXPECTED_TOOL_COUNT ?? 75,
);

const discovery = await getJson(
  new URL("/.well-known/oauth-authorization-server", baseUrl),
);
assert.equal(discovery.issuer, baseUrl.origin);
assert.equal(
  discovery.authorization_endpoint,
  new URL("/oauth/authorize", baseUrl).toString(),
);
assert.equal(discovery.token_endpoint, new URL("/oauth/token", baseUrl).toString());
assert.deepEqual(discovery.code_challenge_methods_supported, ["S256"]);
assert.ok(discovery.grant_types_supported.includes("refresh_token"));
assert.ok(discovery.scopes_supported.includes("mcp:read"));
assert.ok(discovery.scopes_supported.includes("mcp:write"));
assert.ok(discovery.scopes_supported.includes("offline_access"));
console.log("PASS: descoberta OAuth oficial, PKCE S256 e escopos MCP");

const protectedResource = await getJson(
  new URL("/.well-known/oauth-protected-resource/api/mcp", baseUrl),
);
assert.equal(protectedResource.resource, resource);
assert.deepEqual(protectedResource.authorization_servers, [baseUrl.origin]);
assert.ok(protectedResource.scopes_supported.includes("mcp:read"));
assert.ok(protectedResource.scopes_supported.includes("mcp:write"));
console.log("PASS: resource binding oficial anunciado para /api/mcp");

const unauthenticated = await rawRpc(undefined, "initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "hub-vz-production-readonly", version: "1" },
});
assert.equal(unauthenticated.response.status, 401);
const authenticate = unauthenticated.response.headers.get("www-authenticate") ?? "";
assert.match(
  authenticate,
  /resource_metadata="https:\/\/hub\.vezetiv\.dev\/\.well-known\/oauth-protected-resource\/api\/mcp"/,
);
assert.match(authenticate, /scope="mcp:read mcp:write"/);
console.log("PASS: WWW-Authenticate aponta para o metadata oficial e anuncia os escopos MCP");
console.log("PASS: endpoint MCP oficial bloqueia chamadas sem autenticacao");

if (!accessToken) {
  console.log(
    "SKIP: defina MCP_PRODUCTION_TEST_ACCESS_TOKEN para validar ferramentas autenticadas somente leitura.",
  );
  process.exit(0);
}

const initialized = await rpc(accessToken, "initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "hub-vz-production-readonly", version: "1" },
});
assert.equal(initialized.result?.protocolVersion, "2025-06-18");

const listed = await rpc(accessToken, "tools/list", {});
const toolNames = listed.result?.tools?.map((tool) => tool.name) ?? [];
assert.equal(toolNames.length, expectedToolCount);

for (const name of [
  "hub_get_financial_summary",
  "hub_list_accounts",
  "hub_list_invoices",
  "hub_list_reimbursements",
  "hub_list_goals",
  "hub_list_cards",
  "hub_list_payment_plans",
  "hub_list_places",
  "hub_list_notes",
  "hub_create_transaction",
  "hub_create_subscription",
  "hub_update_goal",
]) {
  assert.ok(toolNames.includes(name), `Ferramenta esperada ausente: ${name}`);
}
console.log(`PASS: ${toolNames.length} ferramentas oficiais publicadas`);

for (const [name, args] of [
  ["hub_get_financial_summary", {}],
  ["hub_list_accounts", { limit: 1 }],
  ["hub_list_invoices", { limit: 1 }],
  ["hub_list_reimbursements", { limit: 1 }],
  ["hub_list_goals", { limit: 1 }],
  ["hub_list_cards", { limit: 1 }],
  ["hub_list_subscriptions", { limit: 1 }],
]) {
  const result = await rpc(accessToken, "tools/call", { name, arguments: args });
  assert.equal(result.result?.isError, undefined, `${name} retornou erro MCP.`);
  console.log(`PASS: consulta nao destrutiva ${name}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      baseUrl: baseUrl.origin,
      resource,
      tools: toolNames.length,
      writesExercised: false,
    },
    null,
    2,
  ),
);

async function rpc(token, method, params) {
  const { response, body } = await rawRpc(token, method, params);
  assert.equal(response.status, 200, `${method} retornou HTTP ${response.status}.`);
  assert.equal(
    body.error,
    undefined,
    body.error?.message ?? `${method} retornou erro JSON-RPC.`,
  );
  return body;
}

async function rawRpc(token, method, params) {
  const headers = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };
  if (token) headers.authorization = `Bearer ${token}`;

  const response = await fetch(resource, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `${Date.now()}-${method}`,
      method,
      params,
    }),
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  assert.equal(response.status, 200, `${url.pathname} retornou HTTP ${response.status}.`);
  return response.json();
}
