// Local, resumable backup. Upstream requests are GET-only through the same reader
// used by the app. No Supabase client, database writes or credential output.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");
require("@next/env").loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const root = process.cwd();
const args = process.argv.slice(2);
const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Cuiaba" }).format(new Date());
const period = { start: "2023-01-01", end: today };
const owner = process.env.ORGANIZZE_HUB_USER_ID;
if (!owner) throw new Error("Configure ORGANIZZE_HUB_USER_ID localmente.");
const cache = new Map();
function load(file) {
  file = path.resolve(root, file);
  if (cache.has(file)) return cache.get(file);
  const holder = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, {
    URL, URLSearchParams, Buffer, AbortSignal, Date, structuredClone, fetch,
  })((name) => name === "server-only" ? {} : load(path.resolve(path.dirname(file), `${name}.ts`)), holder, holder.exports);
  cache.set(file, holder.exports);
  return holder.exports;
}
const { createOrganizzeReader, OrganizzeError } = load("src/features/organizze/client.ts");
const { createSnapshot, extract, pendingTask } = load("src/features/organizze/extraction.ts");
const resume = args.indexOf("--resume");
const folder = resume >= 0 ? path.resolve(args[resume + 1] ?? "") : path.resolve("tmp/organizze-backups", new Date().toISOString().replace(/[:.]/g, "-"));
if (!folder.startsWith(path.resolve("tmp/organizze-backups") + path.sep)) throw new Error("Backup deve ficar em tmp/organizze-backups.");
fs.mkdirSync(folder, { recursive: true });
const file = path.join(folder, "organizze-backup.json");
const snapshot = resume >= 0 ? JSON.parse(fs.readFileSync(file, "utf8")).snapshot : createSnapshot(owner, period);
if (snapshot.ownerId !== owner) throw new Error("O backup pertence a outro usuário.");
let requests = 0;
let lastSave = 0;
function save(force = false) {
  if (!force && Date.now() - lastSave < 1000) return;
  fs.writeFileSync(file, JSON.stringify({ snapshot, selectedKeys: [] }), { mode: 0o600 });
  lastSave = Date.now();
}
const transport = async (url, options) => {
  if (new URL(url).origin !== "https://api.organizze.com.br" || options.method !== "GET" || options.body) throw new Error("Somente GET Organizze.");
  await new Promise(resolve => setTimeout(resolve, 150));
  requests++;
  return fetch(url, options);
};
const reader = createOrganizzeReader({ email: process.env.ORGANIZZE_EMAIL ?? "", apiKey: process.env.ORGANIZZE_API_KEY ?? "", userAgent: process.env.ORGANIZZE_USER_AGENT ?? "" }, transport);
let progressTime = Date.now();
let failure = null;
try {
  save(true);
  await extract(snapshot, reader, () => {
    save();
    if (Date.now() - progressTime > 25000) {
      console.log(JSON.stringify({ completed: snapshot.receipts.length, planned: snapshot.tasks.length, records: snapshot.records.length }));
      progressTime = Date.now();
    }
  }, new AbortController().signal);
} catch (error) { failure = error instanceof OrganizzeError ? error.code : "extraction_stopped"; }
save(true);
const summary = { period: snapshot.period, complete: !pendingTask(snapshot) && !snapshot.errors.length && !failure, failure, requestsThisRun: requests, completed: snapshot.receipts.length, unavailable: snapshot.unavailable?.length ?? 0, planned: snapshot.tasks.length, records: snapshot.records.length, counts: Object.fromEntries(["account", "card", "category", "invoice", "transaction"].map(entity => [entity, snapshot.records.filter(row => row.entity === entity).length])), backup: path.relative(root, file), financialWrites: 0 };
fs.writeFileSync(path.join(folder, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
if (!summary.complete) process.exitCode = 2;
