import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const cache = new Map();
function load(path) {
  if (cache.has(path)) return cache.get(path);
  const mod = { exports: {} };
  cache.set(path, mod.exports);
  const code = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, {
    Buffer, process, URL, URLSearchParams, Date,
  })((name) => name === "server-only" ? {} : name.startsWith("node:") || !name.startsWith(".")
    ? require(name) : load(resolve(dirname(path), `${name}.ts`)), mod, mod.exports);
  return mod.exports;
}
const args = process.argv.slice(2);
const option = (key) => args[args.indexOf(key) + 1];
const owner = args.includes("--owner") ? option("--owner") : "";
const project = args.includes("--project") ? option("--project") : "";
if (!/^[a-f0-9-]{36}$/.test(owner) || !/^[a-z]{20}$/.test(project))
  throw new Error("Informe --owner UUID --project REFERENCIA; --apply confirma a cópia privada.");
const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
if (url.hostname !== `${project}.supabase.co`) throw new Error("Projeto Supabase diferente do solicitado.");
const files = [];
for (const source of ["pluggy", "organizze"]) {
  const { validatePluggySnapshot, validateSnapshot } = load(resolve(`src/features/${source}/backup.ts`));
  const folder = resolve(`tmp/${source}-backups`);
  for (const id of await readdir(folder)) {
    if (!/^\d{4}-\d{2}-\d{2}T[\d-]+Z(?:-[a-f0-9-]{36})?$/.test(id)) continue;
    const bytes = await readFile(resolve(folder, id, `${source}-backup.json`));
    const value = JSON.parse(bytes);
    const snapshot = source === "pluggy" ? value : value.snapshot;
    if (source === "pluggy") validatePluggySnapshot(snapshot, owner, snapshot.itemId);
    else validateSnapshot(snapshot, owner);
    files.push({ path: `${owner}/${source}/${id}/${source}-backup.json`, bytes });
  }
}
console.log(`Validados ${files.length} históricos locais; nenhum registro financeiro será importado.`);
if (!args.includes("--apply")) {
  console.log("Dry run concluído. Use --apply para preservar os históricos no Storage privado.");
  process.exit(0);
}
const client = createClient(url.href, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const bucket = "hub-import-backups";
const existing = await client.storage.getBucket(bucket);
if (existing.error) {
  if (String(existing.error.statusCode) !== "404") throw new Error("Sem acesso ao bucket privado.");
  const created = await client.storage.createBucket(bucket, {
    public: false, allowedMimeTypes: ["application/json"], fileSizeLimit: 50 * 1024 * 1024,
  });
  if (created.error) throw new Error("Não foi possível criar o bucket privado.");
} else if (existing.data.public) throw new Error("Bucket público recusado; nenhuma cópia efetuada.");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
let uploaded = 0;
for (const file of files) {
  const old = await client.storage.from(bucket).download(file.path);
  if (old.data) {
    if (hash(Buffer.from(await old.data.arrayBuffer())) !== hash(file.bytes))
      throw new Error("Histórico existente divergente; cópia interrompida sem sobrescrever.");
  } else {
    if (old.error && !["404", "400"].includes(String(old.error.statusCode)))
      throw new Error("Falha ao conferir histórico existente.");
    const { error } = await client.storage.from(bucket).upload(file.path, file.bytes, {
      contentType: "application/json", upsert: false, cacheControl: "0",
    });
    if (error) throw new Error("Falha na cópia privada; arquivos locais preservados.");
    uploaded++;
  }
  const check = await client.storage.from(bucket).download(file.path);
  if (!check.data || hash(Buffer.from(await check.data.arrayBuffer())) !== hash(file.bytes))
    throw new Error("Verificação SHA-256 do histórico não conferiu.");
}
console.log(`Storage privado: ${uploaded} cópias novas; ${files.length} hashes SHA-256 conferidos.`);
