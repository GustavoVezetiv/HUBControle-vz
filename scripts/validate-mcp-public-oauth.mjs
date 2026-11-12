import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";

const baseUrl = requiredUrl("MCP_PUBLIC_TEST_BASE_URL");
const resource = new URL("/api/mcp", baseUrl).toString();
const clientId = "https://chatgpt.com/oauth/client.json";
const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";
const expectedTools = Number(process.env.MCP_PUBLIC_TEST_EXPECTED_TOOL_COUNT ?? 14);
const supabaseUrl = requiredUrl("MCP_PUBLIC_TEST_SUPABASE_URL");
const supabaseKey = required("MCP_PUBLIC_TEST_SUPABASE_ANON_KEY");
const serviceRoleKey = required("MCP_PUBLIC_TEST_SERVICE_ROLE_KEY");

const users = [
  { label: "Alpha", email: required("MCP_PUBLIC_TEST_USER_A_EMAIL"), password: required("MCP_PUBLIC_TEST_USER_A_PASSWORD") },
  { label: "Beta", email: required("MCP_PUBLIC_TEST_USER_B_EMAIL"), password: required("MCP_PUBLIC_TEST_USER_B_PASSWORD") },
];

const discovery = await getJson(new URL("/.well-known/oauth-authorization-server", baseUrl));
assert.equal(discovery.issuer, baseUrl.origin);
assert.equal(discovery.authorization_endpoint, new URL("/oauth/authorize", baseUrl).toString());
assert.equal(discovery.token_endpoint, new URL("/oauth/token", baseUrl).toString());
assert.deepEqual(discovery.code_challenge_methods_supported, ["S256"]);
assert.ok(discovery.grant_types_supported.includes("refresh_token"));
console.log("PASS: discovery OAuth publico e PKCE S256");

const protectedResource = await getJson(new URL("/.well-known/oauth-protected-resource/api/mcp", baseUrl));
assert.equal(protectedResource.resource, resource);
assert.deepEqual(protectedResource.authorization_servers, [baseUrl.origin]);
console.log("PASS: resource binding anunciado para /api/mcp");

const sessions = [];
for (const user of users) {
  const tokens = await authorize(user);
  const initialize = await rpc(tokens.access_token, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "hub-vz-staging-test", version: "1" },
  });
  assert.equal(initialize.result?.protocolVersion, "2025-06-18");

  const listed = await rpc(tokens.access_token, "tools/list", {});
  const toolNames = listed.result?.tools?.map((tool) => tool.name) ?? [];
  assert.equal(toolNames.length, expectedTools);
  assert.ok(toolNames.includes("hub_get_financial_summary"));
  assert.ok(toolNames.includes("hub_list_accounts"));
  assert.ok(toolNames.every((name) => !/^hub_(create|update|delete|pay|move)_/.test(name)), "Ferramenta de escrita publicada.");

  const summary = await rpc(tokens.access_token, "tools/call", {
    name: "hub_get_financial_summary",
    arguments: {},
  });
  assert.equal(summary.result?.isError, undefined);
  const accounts = await rpc(tokens.access_token, "tools/call", {
    name: "hub_list_accounts",
    arguments: { limit: 100 },
  });
  assert.equal(accounts.result?.isError, undefined);
  sessions.push({ user, tokens, accountIds: collectIds(accounts.result), summary: summary.result });
  console.log(`PASS: ${user.label} autenticou e consultou ${toolNames.length} ferramentas somente leitura`);
}

const alphaIds = new Set(sessions[0].accountIds);
const betaIds = new Set(sessions[1].accountIds);
for (const id of alphaIds) assert.ok(!betaIds.has(id), "Alpha e Beta receberam o mesmo registro financeiro.");
assert.notDeepEqual(sessions[0].summary, sessions[1].summary, "Os resumos dos dois usuarios ficaram indistinguiveis; revise as fixtures.");
console.log("PASS: respostas financeiras de Alpha e Beta permanecem isoladas");

const alpha = sessions[0];
const bypass = await fetch(new URL("/rest/v1/accounts_payable?select=id&limit=1", supabaseUrl), {
  headers: { apikey: supabaseKey, authorization: `Bearer ${alpha.tokens.access_token}` },
});
assert.equal(bypass.status, 401);
console.log("PASS: token opaco foi rejeitado pela Data API do Supabase");

const accessHash = createHash("sha256").update(alpha.tokens.access_token).digest("hex");
const expireAccess = await fetch(new URL(`/rest/v1/mcp_oauth_records?key_hash=eq.${accessHash}&kind=eq.access`, supabaseUrl), {
  method: "PATCH",
  headers: {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json",
    prefer: "return=minimal",
  },
  body: JSON.stringify({ expires_at: new Date(Date.now() - 1_000).toISOString() }),
});
assert.ok([200, 204].includes(expireAccess.status));
assert.equal((await rawRpc(alpha.tokens.access_token, "tools/list", {})).status, 401);
console.log("PASS: access token expirado foi recusado pelo MCP publicado");

const refreshed = await tokenRequest({
  grant_type: "refresh_token",
  refresh_token: alpha.tokens.refresh_token,
  client_id: clientId,
  resource,
});
assert.equal(refreshed.response.status, 200);
assert.ok(refreshed.body.access_token?.startsWith("mcp_at_"));
assert.ok(refreshed.body.refresh_token?.startsWith("mcp_rt_"));

const refreshReplay = await tokenRequest({
  grant_type: "refresh_token",
  refresh_token: alpha.tokens.refresh_token,
  client_id: clientId,
  resource,
});
assert.equal(refreshReplay.response.status, 400);
console.log("PASS: refresh rotativo e replay do refresh antigo bloqueado");

const refreshedCall = await rpc(refreshed.body.access_token, "tools/call", {
  name: "hub_list_accounts",
  arguments: { limit: 1 },
});
assert.equal(refreshedCall.result?.isError, undefined);

const revoke = await fetch(new URL("/oauth/revoke", baseUrl), {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ token: refreshed.body.access_token, client_id: clientId }),
});
assert.equal(revoke.status, 200);
assert.equal((await rawRpc(refreshed.body.access_token, "tools/list", {})).status, 401);
const revokedRefresh = await tokenRequest({
  grant_type: "refresh_token",
  refresh_token: refreshed.body.refresh_token,
  client_id: clientId,
  resource,
});
assert.equal(revokedRefresh.response.status, 400);
console.log("PASS: revogacao invalidou access e refresh da concessao");

for (const session of sessions.slice(1)) {
  await fetch(new URL("/oauth/revoke", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: session.tokens.access_token, client_id: clientId }),
  });
}

console.log(JSON.stringify({
  ok: true,
  baseUrl: baseUrl.origin,
  resource,
  users: users.map((user) => user.label),
  tools: expectedTools,
  writesEnabled: false,
}, null, 2));

async function authorize(user) {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(24));
  const authorizeUrl = new URL("/oauth/authorize", baseUrl);
  authorizeUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "mcp:read offline_access",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource,
  });

  const started = await fetch(authorizeUrl, { redirect: "manual" });
  assert.ok([302, 303, 307, 308].includes(started.status));
  const location = requiredHeader(started, "location");
  const cookie = requiredHeader(started, "set-cookie").split(";", 1)[0];
  const connectUrl = new URL(location, baseUrl);

  const loginPage = await fetch(connectUrl, { headers: { cookie } });
  assert.equal(loginPage.status, 200);
  const loginHtml = await loginPage.text();
  const loginInputs = parseInputs(loginHtml);
  const loginAction = findAction(loginInputs);
  assert.equal(loginInputs.action, "login");

  const loginResult = await postAction(connectUrl, cookie, loginAction, {
    flow: loginInputs.flow,
    csrf: loginInputs.csrf,
    action: "login",
    email: user.email,
    password: user.password,
  });
  assert.ok([302, 303].includes(loginResult.status));
  const consentUrl = new URL(requiredHeader(loginResult, "location"), baseUrl);
  assert.ok(!consentUrl.searchParams.has("error"), `${user.label}: login OAuth recusado.`);

  const consentPage = await fetch(consentUrl, { headers: { cookie } });
  assert.equal(consentPage.status, 200);
  const consentInputs = parseInputs(await consentPage.text());
  const consentAction = findAction(consentInputs);

  const approved = await postAction(consentUrl, cookie, consentAction, {
    flow: consentInputs.flow,
    csrf: consentInputs.csrf,
    action: "approve",
  });
  assert.ok([302, 303].includes(approved.status));
  const callback = new URL(requiredHeader(approved, "location"));
  assert.equal(callback.origin + callback.pathname, redirectUri);
  assert.equal(callback.searchParams.get("state"), state);
  assert.equal(callback.searchParams.get("iss"), baseUrl.origin);
  const code = callback.searchParams.get("code");
  assert.ok(code?.startsWith("mcp_cd_"));

  const exchanged = await tokenRequest({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    client_id: clientId,
    redirect_uri: redirectUri,
    resource,
  });
  assert.equal(exchanged.response.status, 200);
  assert.ok(exchanged.body.access_token?.startsWith("mcp_at_"));
  assert.ok(exchanged.body.refresh_token?.startsWith("mcp_rt_"));

  const replay = await tokenRequest({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    client_id: clientId,
    redirect_uri: redirectUri,
    resource,
  });
  assert.equal(replay.response.status, 400);
  return exchanged.body;
}

async function postAction(url, cookie, actionName, values) {
  const body = new FormData();
  body.set(actionName, "");
  for (const [key, value] of Object.entries(values)) body.set(key, value ?? "");
  return fetch(url, {
    method: "POST",
    headers: { cookie, origin: baseUrl.origin, referer: url.toString() },
    body,
    redirect: "manual",
  });
}

function parseInputs(html) {
  const inputs = {};
  for (const tag of html.match(/<input\b[^>]*>/gi) ?? []) {
    const attrs = {};
    for (const match of tag.matchAll(/([:$\w-]+)="([^"]*)"/g)) attrs[match[1]] = decodeHtml(match[2]);
    if (attrs.name) inputs[attrs.name] = attrs.value ?? "";
  }
  return inputs;
}

function findAction(inputs) {
  const name = Object.keys(inputs).find((key) => key.startsWith("$ACTION_ID_"));
  assert.ok(name, "Server Action nao encontrada no formulario OAuth.");
  return name;
}

function decodeHtml(value) {
  return value.replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&#x27;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
}

async function tokenRequest(values) {
  const response = await fetch(new URL("/oauth/token", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
  });
  return { response, body: await response.json() };
}

async function rpc(token, method, params) {
  const response = await rawRpc(token, method, params);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.error, undefined, body.error?.message);
  return body;
}

function rawRpc(token, method, params) {
  return fetch(resource, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

function collectIds(value, result = new Set()) {
  if (Array.isArray(value)) for (const item of value) collectIds(item, result);
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === "id" && typeof item === "string") result.add(item);
      else collectIds(item, result);
    }
  }
  return [...result];
}

async function getJson(url) {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return response.json();
}

function required(name) {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} e obrigatorio.`);
  return value;
}

function requiredUrl(name) {
  const value = new URL(required(name));
  assert.equal(value.protocol, "https:");
  return value;
}

function requiredHeader(response, name) {
  const value = response.headers.get(name);
  assert.ok(value, `Header ${name} ausente.`);
  return value;
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}
