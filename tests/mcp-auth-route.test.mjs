import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const fixtureOrigin = "https://mcp-route-fixture.invalid";

// These are simulated credentials, never OAuth tokens or database sessions.
export const SIMULATED_TOKENS = Object.freeze({
  full: "fixture-mcp-full-scopes",
  read: "fixture-mcp-read-scope",
  withoutRead: "fixture-mcp-without-read-scope",
  invalid: "fixture-mcp-invalid-token",
  revoked: "fixture-mcp-revoked-token",
});

// Load the actual route, catalogue, argument validators and auth challenge
// helpers. Replace only identity resolution, data execution and admin access.
// The isolated environment contains no credentials and network calls fail.
export function createHarness(options = {}) {
  const calls = { auth: [], read: [], write: [], admin: [] };
  const env = {
    MCP_ENABLED: options.enabled === false ? "false" : "true",
    MCP_OAUTH_READY: options.oauthReady === false ? "false" : "true",
    MCP_ENABLE_WRITES: options.writesEnabled === false ? "false" : "true",
    MCP_DIRECT_WRITES_READY: options.directWritesReady === false ? "false" : "true",
    MCP_PUBLIC_URL: `${fixtureOrigin}/api/mcp`,
    NEXT_PUBLIC_SITE_URL: fixtureOrigin,
  };
  const client = Object.freeze({ fixtureOnly: true });
  const user = Object.freeze({ id: "fixture-user-simulated" });
  const modules = new Map();
  const sandbox = vm.createContext({
    console,
    process: { env },
    URL,
    URLSearchParams,
    Request,
    Response,
    Headers,
    AbortSignal,
    Buffer,
    fetch: async () => {
      throw new Error("Network access is forbidden in the simulated route harness.");
    },
  });
  const admin = new Proxy({}, {
    get: (_target, name) => async (...args) => {
      calls.admin.push({ name, args });
      throw new Error("Database/admin access is forbidden in the simulated route harness.");
    },
  });

  function sourcePath(specifier, importer) {
    const candidate = specifier.startsWith("@/")
      ? resolve(projectRoot, "src", specifier.slice(2))
      : resolve(dirname(importer), specifier);
    return candidate.endsWith(".ts") ? candidate : `${candidate}.ts`;
  }

  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    assert.ok(existsSync(filename), `Missing source dependency: ${filename}`);
    const loadedModule = { exports: {} };
    modules.set(filename, loadedModule);
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    }).outputText;
    const localRequire = (specifier) => {
      if (specifier === "@/features/mcp/admin") return admin;
      if (specifier.startsWith("@/") || specifier.startsWith(".")) {
        return load(sourcePath(specifier, filename));
      }
      return require(specifier);
    };
    const execute = new vm.Script(
      `(function (exports, require, module, __filename, __dirname) {\n${compiled}\n})`,
      { filename },
    ).runInContext(sandbox);
    execute(loadedModule.exports, localRequire, loadedModule, filename, dirname(filename));

    if (filename === resolve(projectRoot, "src/features/mcp/auth.ts")) {
      loadedModule.exports.getMcpAuthContext = async (request) => {
        calls.auth.push({ authorizationPresent: request.headers.has("authorization") });
        if (options.authFailureStatus) {
          return { error: "Simulated authentication service unavailable.", status: options.authFailureStatus };
        }
        const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        const scopes = token === SIMULATED_TOKENS.full ? ["mcp:read", "mcp:write"]
          : token === SIMULATED_TOKENS.read ? ["mcp:read"]
            : token === SIMULATED_TOKENS.withoutRead ? ["mcp:write"] : null;
        return scopes
          ? { user, client, scopes }
          : { error: "Simulated missing, invalid or revoked OAuth token.", status: 401 };
      };
    }
    if (filename === resolve(projectRoot, "src/features/mcp/tools.ts")) {
      loadedModule.exports.runReadTool = async (name, args, context) => {
        calls.read.push({ name, args, context });
        return { fixtureOnly: true, people: [{ id: "fixture-person", name: "Simulated person" }] };
      };
      loadedModule.exports.runWriteTool = async (name, args, context) => {
        calls.write.push({ name, args, context });
        return { fixtureOnly: true, id: "fixture-write-result" };
      };
    }
    return loadedModule.exports;
  }

  const route = load(resolve(projectRoot, "src/app/api/mcp/route.ts"));
  const auth = load(resolve(projectRoot, "src/features/mcp/auth.ts"));
  const tools = load(resolve(projectRoot, "src/features/mcp/tools.ts"));

  async function request(method, params = {}, requestOptions = {}) {
    const token = requestOptions.token === undefined ? SIMULATED_TOKENS.full : requestOptions.token;
    const headers = new Headers({
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
      ...requestOptions.headers,
    });
    if (token !== null) headers.set("authorization", `Bearer ${token}`);
    const response = await route.POST(new Request(`${fixtureOrigin}/api/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: "fixture-request", method, params }),
    }));
    const text = await response.text();
    return { response, body: text ? JSON.parse(text) : null };
  }

  return { route, request, calls, env, client, user, tools: tools.hubTools, auth };
}

function assertNoExecution(harness) {
  assert.equal(harness.calls.read.length, 0, "A private read handler ran without authorization.");
  assert.equal(harness.calls.write.length, 0, "A write handler ran without authorization.");
  assert.equal(harness.calls.admin.length, 0, "The route reached an admin/database operation.");
}

function assertChallenge(body, error, requiredScopes) {
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.id, "fixture-request");
  assert.equal(body.result?.isError, true);
  assert.ok(body.result.content.some((item) => item.type === "text" && item.text.length > 0));
  const challenges = body.result._meta?.["mcp/www_authenticate"];
  assert.ok(Array.isArray(challenges) && challenges.length > 0, "Missing tool-level OAuth challenge.");
  assert.ok(challenges.every((challenge) => typeof challenge === "string"));
  assert.match(challenges[0], /^Bearer\s/);
  assert.ok(challenges[0].includes(`resource_metadata="${fixtureOrigin}/.well-known/oauth-protected-resource/api/mcp"`));
  assert.ok(challenges[0].includes(`error="${error}"`));
  assert.match(challenges[0], /error_description="[^"]+"/);
  if (requiredScopes) {
    const scope = /scope="([^"]*)"/.exec(challenges[0])?.[1]?.split(/\s+/).filter(Boolean);
    assert.deepEqual(scope?.sort(), [...requiredScopes].sort());
  }
}

function registerTests() {
  for (const method of ["initialize", "tools/list"]) {
    for (const [label, token] of [["missing", null], ["invalid", SIMULATED_TOKENS.invalid]]) {
      test(`${method} keeps HTTP 401 discovery protected with a ${label} simulated token`, async () => {
        const harness = createHarness();
        const { response } = await harness.request(method, {}, { token });
        assert.equal(response.status, 401);
        const challenge = response.headers.get("WWW-Authenticate");
        assert.match(challenge, /^Bearer\s/);
        assert.ok(challenge.includes(`resource_metadata="${fixtureOrigin}/.well-known/oauth-protected-resource/api/mcp"`));
        assert.ok(challenge.includes('error="invalid_token"'));
        assertNoExecution(harness);
      });
    }
  }

  for (const [label, token] of [
    ["missing", null],
    ["invalid", SIMULATED_TOKENS.invalid],
    ["revoked", SIMULATED_TOKENS.revoked],
  ]) {
    test(`tools/call with a ${label} simulated token carries the OAuth linking challenge`, async () => {
      const harness = createHarness();
      const { response, body } = await harness.request("tools/call", {
        name: "hub_list_people", arguments: {},
      }, { token });
      assert.equal(response.status, 200, "Tool auth failure must reach the host as an MCP tool result.");
      assertChallenge(body, "invalid_token");
      assertNoExecution(harness);
    });
  }

  for (const [label, args] of [
    ["valid arguments", { idempotencyKey: "fixture-person-01", name: "Simulated person" }],
    ["empty arguments", {}],
  ]) {
    test(`a read-only simulated grant cannot write with ${label} and requests both scopes`, async () => {
      const harness = createHarness();
      const { response, body } = await harness.request("tools/call", {
        name: "hub_create_person", arguments: args,
      }, { token: SIMULATED_TOKENS.read });
      assert.equal(response.status, 200);
      assertChallenge(body, "insufficient_scope", ["mcp:read", "mcp:write"]);
      assertNoExecution(harness);
    });
  }

  test("a simulated grant without mcp:read cannot read and requests its missing scope", async () => {
    const harness = createHarness();
    const { response, body } = await harness.request("tools/call", {
      name: "hub_list_people", arguments: {},
    }, { token: SIMULATED_TOKENS.withoutRead });
    assert.equal(response.status, 200);
    assertChallenge(body, "insufficient_scope", ["mcp:read"]);
    assertNoExecution(harness);
  });

  test("the authenticated real catalogue contains all 75 tools and OAuth security schemes", async () => {
    const harness = createHarness();
    const { response, body } = await harness.request("tools/list");
    assert.equal(response.status, 200);
    const listed = body.result.tools;
    assert.equal(listed.length, 75);
    assert.equal(new Set(listed.map((tool) => tool.name)).size, 75);
    for (const name of ["hub_list_people", "hub_list_categories", "hub_archive_record", "hub_import_subscriptions"]) {
      assert.ok(listed.some((tool) => tool.name === name), `Missing requested tool: ${name}`);
    }
    for (const tool of listed) {
      assert.deepEqual(tool.securitySchemes, [{
        type: "oauth2", scopes: tool.annotations.readOnlyHint ? ["mcp:read"] : ["mcp:read", "mcp:write"],
      }]);
      assert.notEqual(tool._meta?.["openai/visibility"], "private");
      if (tool._meta?.ui?.visibility) assert.ok(tool._meta.ui.visibility.includes("model"));
      if (tool._meta?.securitySchemes) assert.deepEqual(tool._meta.securitySchemes, tool.securitySchemes);
    }
    assertNoExecution(harness);
  });

  test("disabling writes preserves the 25 real read tools", async () => {
    const harness = createHarness({ writesEnabled: false });
    const { response, body } = await harness.request("tools/list");
    assert.equal(response.status, 200);
    assert.equal(body.result.tools.length, 25);
    assert.ok(body.result.tools.every((tool) => tool.annotations.readOnlyHint));
    assertNoExecution(harness);
  });

  test("a simulated valid read uses only the resolved user context", async () => {
    const harness = createHarness();
    const { response, body } = await harness.request("tools/call", {
      name: "hub_list_people", arguments: { limit: 1 },
    }, { token: SIMULATED_TOKENS.read });
    assert.equal(response.status, 200);
    assert.notEqual(body.result.isError, true);
    assert.equal(body.result.structuredContent.fixtureOnly, true);
    assert.equal(harness.calls.read.length, 1);
    assert.equal(harness.calls.read[0].context.client, harness.client);
    assert.equal(harness.calls.read[0].context.userId, harness.user.id);
    assert.equal(harness.calls.write.length, 0);
    assert.equal(harness.calls.admin.length, 0);
  });

  test("a full-scope simulated grant reaches only the simulated writer", async () => {
    const harness = createHarness();
    const { response, body } = await harness.request("tools/call", {
      name: "hub_create_person", arguments: { idempotencyKey: "fixture-person-01", name: "Simulated person" },
    });
    assert.equal(response.status, 200);
    assert.notEqual(body.result.isError, true);
    assert.equal(body.result.structuredContent.fixtureOnly, true);
    assert.equal(harness.calls.write.length, 1);
    assert.equal(harness.calls.write[0].context.client, harness.client);
    assert.equal(harness.calls.write[0].context.userId, harness.user.id);
    assert.equal(harness.calls.read.length, 0);
    assert.equal(harness.calls.admin.length, 0);
  });

  test("an invalid real argument schema never reaches even the simulated writer", async () => {
    const harness = createHarness();
    const { body } = await harness.request("tools/call", {
      name: "hub_create_person", arguments: { idempotencyKey: "short", name: "Simulated person" },
    });
    assert.equal(body.result.isError, true);
    assertNoExecution(harness);
  });

  test("the write gate still blocks a valid full-scope simulated call", async () => {
    const harness = createHarness({ writesEnabled: false });
    const { body } = await harness.request("tools/call", {
      name: "hub_create_person", arguments: { idempotencyKey: "fixture-person-01", name: "Simulated person" },
    });
    assert.equal(body.result.isError, true);
    assertNoExecution(harness);
  });

  test("unsupported subsequent MCP protocol versions remain HTTP 400", async () => {
    const harness = createHarness();
    const { response } = await harness.request("tools/list", {}, {
      headers: { "MCP-Protocol-Version": "2099-01-01" },
    });
    assert.equal(response.status, 400);
    assertNoExecution(harness);
  });

  test("an untrusted browser origin remains HTTP 403 before identity resolution", async () => {
    const harness = createHarness();
    const { response } = await harness.request("tools/list", {}, {
      headers: { origin: "https://untrusted-fixture.invalid" },
    });
    assert.equal(response.status, 403);
    assert.equal(harness.calls.auth.length, 0);
    assertNoExecution(harness);
  });

  test("an authentication service failure remains HTTP 500 without an OAuth challenge", async () => {
    const harness = createHarness({ authFailureStatus: 500 });
    const { response, body } = await harness.request("tools/call", {
      name: "hub_list_people", arguments: {},
    });
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("WWW-Authenticate"), null);
    assert.equal(body.result?._meta?.["mcp/www_authenticate"], undefined);
    assertNoExecution(harness);
  });

  for (const [label, options] of [["MCP disabled", { enabled: false }], ["OAuth unready", { oauthReady: false }]]) {
    test(`${label} remains HTTP 503 before identity resolution`, async () => {
      const harness = createHarness(options);
      const { response } = await harness.request("tools/list");
      assert.equal(response.status, 503);
      assert.equal(harness.calls.auth.length, 0);
      assertNoExecution(harness);
    });
  }
}

// Importing createHarness for Inspector fixtures does not run the test suite.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) registerTests();
