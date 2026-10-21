import assert from "node:assert/strict";

const accessToken = process.env.MCP_PRODUCTION_TEST_ACCESS_TOKEN?.trim();
if (!accessToken) {
  throw new Error("Teste autenticado não executado: forneça uma credencial OAuth autorizada em MCP_PRODUCTION_TEST_ACCESS_TOKEN. Não use chave administrativa nem publique o token.");
}

const base = new URL(process.env.MCP_PRODUCTION_TEST_BASE_URL ?? "https://hub.vezetiv.dev");
const resource = new URL("/api/mcp", base).toString();
const version = "2025-11-25";

async function rpc(method, params = {}, authenticated = true) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": version,
  };
  if (authenticated) headers.authorization = `Bearer ${accessToken}`;
  const response = await fetch(resource, {
    method: "POST", headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      ...(method.startsWith("notifications/") ? {} : { id: method }),
      method, params,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : undefined; } catch { throw new Error(`${method}: resposta não JSON.`); }
  return { response, body };
}

for (const method of ["initialize", "tools/list"]) {
  const result = await rpc(method, {}, false);
  assert.equal(result.response.status, 401, `${method} deve continuar protegido sem token.`);
  const challenge = result.response.headers.get("www-authenticate") ?? "";
  assert.ok(challenge.includes(`resource_metadata="${base.origin}/.well-known/oauth-protected-resource/api/mcp"`));
}

const initialized = await rpc("initialize", {
  protocolVersion: version, capabilities: {},
  clientInfo: { name: "hub-vz-authenticated-readonly-test", version: "1" },
});
assert.equal(initialized.response.status, 200, "initialize autenticado falhou; renove OAuth no host autorizado.");
assert.equal(initialized.body?.error, undefined);
assert.equal(initialized.body?.result?.protocolVersion, version);
assert.ok(initialized.body?.result?.capabilities?.tools);

const notification = await rpc("notifications/initialized");
assert.equal(notification.response.status, 202);

const listed = await rpc("tools/list");
assert.equal(listed.response.status, 200);
assert.equal(listed.body?.error, undefined);
const tools = listed.body?.result?.tools;
assert.ok(Array.isArray(tools));
assert.equal(tools.length, 75);
const names = new Set(tools.map((tool) => tool.name));
assert.equal(names.size, 75);
for (const name of ["hub_list_people", "hub_list_categories", "hub_archive_record", "hub_import_subscriptions"]) {
  assert.ok(names.has(name), `Ferramenta necessária ausente: ${name}`);
}
for (const tool of tools) {
  assert.equal(tool.securitySchemes?.length, 1, `${tool.name}: política OAuth não explícita.`);
  assert.equal(tool.securitySchemes[0].type, "oauth2");
  assert.deepEqual(tool.securitySchemes[0].scopes, tool.annotations.readOnlyHint
    ? ["mcp:read"] : ["mcp:read", "mcp:write"]);
  const visibility = tool._meta?.ui?.visibility;
  assert.ok(visibility === undefined || visibility.includes("model"), `${tool.name} oculta do modelo.`);
}

const people = await rpc("tools/call", { name: "hub_list_people", arguments: { limit: 1 } });
assert.equal(people.response.status, 200);
assert.equal(people.body?.error, undefined);
assert.notEqual(people.body?.result?.isError, true, "A consulta autenticada falhou.");
assert.ok(people.body?.result?.content);

console.log(JSON.stringify({
  ok: true, resource, protocolVersion: version,
  authenticatedTools: tools.length,
  readOnlyCall: "hub_list_people",
  writesExercised: false,
  privateResultsPrinted: false,
}, null, 2));
