import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const require = createRequire(import.meta.url);
const owner = "11111111-1111-4111-8111-111111111111";
const id = "2026-11-13T10-00-00-000Z-22222222-2222-4222-8222-222222222222";
function harness(options = {}) {
  const paths = [], writes = [];
  let ready = !options.missing;
  const bucket = {
    list: async (prefix, paging) => {
      paths.push(prefix);
      if (options.failure) return { error: {} };
      return { data: options.pages ? options.pages[paging.offset / 1000] : [{ name: id }, { name: "../other-owner" }] };
    },
    download: async (path) => { paths.push(path); return { data: new Blob(['{"source":"fixture"}']) }; },
    upload: async (path, bytes, opts) => { paths.push(path); writes.push({ bytes, opts }); return {}; },
  };
  const client = { storage: {
    from: () => bucket,
    getBucket: async () => ready ? { data: { public: Boolean(options.public) } } : { error: { statusCode: "404" } },
    createBucket: async (name, opts) => { assert.equal(opts.public, false); ready = true; return {}; },
  } };
  const mod = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL("../src/features/imports/backup-storage.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { Buffer, process: { env: options.env ?? {} } })(
    (name) => name === "server-only" ? {} : require(name), mod, mod.exports,
  );
  return { ...mod.exports, client, paths, writes };
}
test("production always uses remote backups, local defaults to filesystem", () => {
  assert.equal(harness().usesRemoteImportBackups(), false);
  assert.equal(harness({ env: { VERCEL: "1" } }).usesRemoteImportBackups(), true);
  assert.equal(harness({ env: { IMPORT_BACKUP_STORAGE: "supabase" } }).usesRemoteImportBackups(), true);
});
test("paths are isolated by owner and source; traversal is rejected before any read", async () => {
  const h = harness(); const store = h.createSnapshotStorage(h.client, "pluggy", owner);
  assert.deepEqual([...(await store.list())], [id]);
  await store.read(id);
  await assert.rejects(store.read("../other-owner"));
  assert.ok(h.paths.every((path) => path.startsWith(`${owner}/pluggy`)));
  assert.throws(() => h.createSnapshotStorage(h.client, "pluggy", "../user"));
});
test("public buckets are refused and missing buckets are provisioned private", async () => {
  const publicStore = harness({ public: true });
  await assert.rejects(publicStore.createSnapshotStorage(publicStore.client, "pluggy", owner).list());
  const missing = harness({ missing: true });
  assert.deepEqual([...(await missing.createSnapshotStorage(missing.client, "organizze", owner).list())], [id]);
});
test("complete history is paginated and transport errors never look like an empty history", async () => {
  const h = harness({ pages: [Array.from({ length: 1000 }, () => ({ name: id })), [{ name: id }]] });
  assert.equal((await h.createSnapshotStorage(h.client, "pluggy", owner).list()).length, 1001);
  const failed = harness({ failure: true });
  await assert.rejects(failed.createSnapshotStorage(failed.client, "pluggy", owner).list());
});
test("snapshots are immutable private JSON uploads", async () => {
  const h = harness(); await h.createSnapshotStorage(h.client, "pluggy", owner).write(id, "{}");
  assert.equal(h.writes[0].opts.upsert, false);
  assert.equal(h.writes[0].opts.contentType, "application/json");
  assert.equal(h.writes[0].bytes.toString(), "{}");
});
