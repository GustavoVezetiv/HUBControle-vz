import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const directory = path.resolve(
  process.argv[2] ?? "tmp/hub-vz-mcp-fix-1.1.2/candidate/hub-vz-official",
);
const readJson = (file) => JSON.parse(readFileSync(path.join(directory, file), "utf8"));
const manifest = readJson("plugin.json");
const overlay = readJson(".codex-plugin/plugin.json");
const openai = manifest.extensions?.["com.openai"];

assert.equal(manifest.name, "hub-vz-official");
assert.equal(openai?.apps, "./.app.json", "O manifesto efetivo precisa vincular o App MCP registrado no ChatGPT.");
assert.equal(overlay.apps, openai.apps, "O manifesto de compatibilidade deve preservar o mesmo vínculo.");
assert.equal(overlay.version, manifest.version);
assert.equal(overlay.name, manifest.name);

const mapping = readJson(".app.json");
assert.deepEqual(mapping, {
  apps: {
    "dev-6aca52a8dda48191a140827e184f4495": {
      id: "asdk_app_6aca52a8dda48191a140827e184f4495",
    },
  },
}, "Reutilizar o App existente; não criar outro servidor nem outro ID.");

for (const file of ["mcp.json", ".mcp.json"]) {
  const servers = readJson(file).mcpServers;
  assert.deepEqual(Object.keys(servers), ["hub-vz-official"]);
  const server = servers["hub-vz-official"];
  assert.equal(server.type, "streamable-http");
  assert.equal(server.url, "https://hub.vezetiv.dev/api/mcp");
  assert.deepEqual(server.extensions?.["com.openai"]?.auth, {
    type: "oauth",
    client: { mode: "cimd" },
    baseScopes: ["mcp:read", "offline_access", "mcp:write"],
  }, "Preservar OAuth obrigatório, CIMD e descoberta automática sem segredos ou endpoints substitutos.");
}

assert.equal(openai.interface.logo, "./assets/icon.svg");
assert.equal(openai.interface.composerIcon, "./assets/icon.svg");
assert.ok(readFileSync(path.join(directory, "assets/icon.svg"), "utf8").startsWith("<svg"));
assert.match(readFileSync(path.join(directory, "skills/hub-vz/SKILL.md"), "utf8"), /^---\r?\nname: hub-vz\r?\n/);

console.log(JSON.stringify({
  ok: true,
  version: manifest.version,
  existingApp: mapping.apps["dev-6aca52a8dda48191a140827e184f4495"].id,
  oauth: "cimd",
  endpoint: "https://hub.vezetiv.dev/api/mcp",
  liveAuthorizationVerified: false,
}, null, 2));
