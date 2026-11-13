import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { gzipSync } from "node:zlib";
import ts from "typescript";
const require = createRequire(import.meta.url);
const owner = "11111111-1111-4111-8111-111111111111";
const item = "22222222-2222-4222-8222-222222222222";
const snapshot = { source: "pluggy", ownerId: owner, itemId: item, institution: "nubank", fetchedAt: "2026-11-09T00:00:00Z" };
function harness(user = owner) {
  const objects = new Map(); let writes = 0;
  const store = { list: async () => [...objects.keys()], read: async (id) => objects.get(id), write: async (id, content) => { writes++; objects.set(id, content); } };
  const overrides = {
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: user ? { id: user } : null } }) } }) },
    "@/features/pluggy/config": { pluggyConfig: () => ({ ownerId: owner, items: [{ valid: true, itemId: item, id: "nubank" }] }) },
    "@/features/pluggy/backup": { validatePluggySnapshot: (value, owner) => { assert.equal(value.ownerId, owner); } },
    "@/features/organizze/backup": { validateSnapshot: (value, owner) => { assert.equal(value.ownerId, owner); } },
    "@/features/imports/backup-storage": { remoteSnapshotStorage: async () => store },
  };
  const mod = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL("../src/app/api/imports/backups/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { Buffer, URL, Response, Date })(
    (name) => overrides[name] ?? require(name), mod, mod.exports,
  );
  const request = (value = snapshot, headers = {}, source = "pluggy") => new Request(`https://hub.example/api/imports/backups?source=${source}`, {
    method: "POST", headers: { Origin: "https://hub.example", "Content-Type": "application/gzip", ...headers }, body: gzipSync(JSON.stringify(value)),
  });
  return { ...mod.exports, request, objects, writes: () => writes };
}
test("restore requires same origin and the configured authenticated owner", async () => {
  const foreignOrigin = harness();
  assert.equal((await foreignOrigin.POST(foreignOrigin.request(snapshot, { Origin: "https://foreign.example" }))).status, 403);
  for (const user of [null, "33333333-3333-4333-8333-333333333333"]) {
    const h = harness(user); assert.equal((await h.POST(h.request())).status, 401); assert.equal(h.writes(), 0);
  }
});
test("restore rejects cross-owner snapshots and unconfigured connections without writes", async () => {
  const h = harness();
  assert.equal((await h.POST(h.request({ ...snapshot, ownerId: "other" }))).status, 400);
  assert.equal((await h.POST(h.request({ ...snapshot, itemId: "other" }))).status, 400);
  assert.equal(h.writes(), 0);
});
test("restoration is idempotent, verifies exact bytes, and only writes source snapshots", async () => {
  const h = harness();
  assert.equal((await h.POST(h.request())).status, 200);
  assert.equal((await h.POST(h.request())).status, 200);
  assert.equal(h.writes(), 1);
  assert.equal([...h.objects.values()][0], JSON.stringify(snapshot));
});
test("invalid content type, source and oversized requests fail before storage", async () => {
  const h = harness();
  assert.equal((await h.POST(h.request(snapshot, { "Content-Type": "application/json" }))).status, 415);
  assert.equal((await h.POST(h.request(snapshot, {}, "unknown"))).status, 400);
  assert.equal((await h.POST(h.request(snapshot, { "Content-Length": String(5 * 1024 * 1024) }))).status, 413);
  assert.equal(h.writes(), 0);
});
