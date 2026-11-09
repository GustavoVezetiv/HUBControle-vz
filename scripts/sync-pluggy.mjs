// Optional personal daily job. Only GET financial data + local private backups.
// No Supabase session/service role, financial write, bank connection creation.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");
require("@next/env").loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const root = process.cwd();
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const holder = { exports: {} };
  cache.set(file, holder.exports);
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const scoped = (name) =>
    name === "server-only"
      ? {}
      : name.startsWith("node:")
        ? require(name)
        : load(
            path.resolve(
              name.startsWith("@/") ? path.join(root, "src") : path.dirname(file),
              `${name.startsWith("@/") ? name.slice(2) : name}.ts`,
            ),
          );
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, {
    URL,
    URLSearchParams,
    Buffer,
    AbortSignal,
    Date,
    structuredClone,
    fetch,
    process,
  })(scoped, holder, holder.exports);
  return holder.exports;
}
const { pluggyConfig } = load(path.join(root, "src/features/pluggy/config.ts"));
const { syncPluggyBank, defaultPluggyPeriod, pluggyMessage } = load(
  path.join(root, "src/features/pluggy/service.ts"),
);
const config = pluggyConfig();
const results = [];
for (const bank of config.items) {
  if (!config.credentialsPresent || !bank.valid) {
    results.push({
      institution: bank.id,
      status: "not_configured",
      itemVariable: bank.env,
    });
    continue;
  }
  try {
    const outcome = await syncPluggyBank(
      bank.id,
      defaultPluggyPeriod(),
      !process.argv.includes("--force"),
    );
    results.push({ institution: bank.id, status: outcome.skipped ? "recent" : "read" });
  } catch (error) {
    results.push({ institution: bank.id, status: "error", error: pluggyMessage(error) });
  }
}
console.log(JSON.stringify({ results, financialWrites: 0 }));
if (
  results.every((row) => row.status === "not_configured") ||
  results.some((row) => row.status === "error")
)
  process.exitCode = 2;
