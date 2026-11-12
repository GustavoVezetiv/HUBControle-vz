// Local review only: actual UI, synthetic records and a database client that
// refuses every mutation. Uses TypeScript/Webpack/Tailwind already in the repo.
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const folder = resolve(root, "tmp/reimbursements-preview");
await mkdir(folder, { recursive: true });
const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Cuiaba" }).format(
  new Date(),
);
const fixture = {
  people: [
    {
      id: "person-ana",
      name: "Ana Exemplo",
      relationship_type: "family",
      is_active: true,
    },
    {
      id: "person-marcos",
      name: "Marcos Exemplo",
      relationship_type: "client",
      is_active: true,
    },
    {
      id: "person-jose",
      name: "José Exemplo",
      relationship_type: "friend",
      is_active: true,
    },
  ],
  categories: [
    {
      id: "category-card",
      name: "Cartão de crédito",
      type: "expense",
      color: "#059669",
      icon: "cartao",
      scopes: ["expense", "invoice", "reimbursement"],
      is_active: true,
    },
    {
      id: "category-food",
      name: "Alimentação",
      type: "expense",
      color: "#ea580c",
      icon: "comida",
      scopes: ["expense", "reimbursement"],
      is_active: true,
    },
  ],
  credit_cards: [
    { id: "card-blue", name: "Cartão Azul", issuer: "Banco Exemplo", is_active: true },
  ],
  credit_card_invoices: [
    {
      id: "invoice-demo",
      credit_card_id: "card-blue",
      reference_month: day.slice(0, 7) + "-01",
      due_date: day,
      status: "open",
      total_amount: 300,
      archived_at: null,
    },
  ],
  credit_card_transactions: [
    {
      id: "transaction-demo",
      credit_card_id: "card-blue",
      invoice_id: "invoice-demo",
      category_id: "category-card",
      description: "Compra de exemplo",
      amount: 300,
      transaction_date: day,
      reimbursement_id: "reimbursement-1",
      is_reimbursable: true,
      archived_at: null,
    },
  ],
  reimbursements: [
    {
      id: "reimbursement-1",
      person_id: "person-ana",
      category_id: "category-card",
      description: "Compra compartilhada de exemplo",
      expected_amount: 300,
      received_amount: 50,
      expected_date: day,
      status: "partial",
      credit_card_transaction_id: "transaction-demo",
      credit_card_invoice_id: "invoice-demo",
      is_recurring: false,
      notes: "Demonstração local",
      archived_at: null,
    },
    {
      id: "reimbursement-2",
      person_id: "person-marcos",
      category_id: "category-food",
      description: "Almoço de exemplo",
      expected_amount: 85,
      received_amount: 0,
      expected_date: day.slice(0, 7) + "-01",
      status: "expected",
      is_recurring: true,
      notes: "Dados fictícios",
      archived_at: null,
    },
  ],
  profiles: [{ id: "fixture-user", allow_quick_table_edit: false }],
  accounts_payable: [],
  income_sources: [],
};
await writeFile(
  resolve(folder, "database.js"),
  `const fixture = ${JSON.stringify(fixture)};
fixture.reimbursements = fixture.reimbursements.map(row => ({renegotiation_source_ids:[],late_interest_enabled:false,late_interest_rate:0,late_fee_amount:0,received_date:null,credit_card_transaction_id:null,credit_card_invoice_id:null,category_id:null,account_payable_id:null,income_source_id:null,recurrence_parent_id:null,...row}));
globalThis.__previewWrites = 0;
function forbidden() { globalThis.__previewWrites++; throw new Error("Prévia local: gravações bloqueadas."); }
export function createClient() { return {
 auth: { getUser: async () => ({data:{user:{id:"fixture-user"}},error:null}) },
 from(table) { let rows = [...(fixture[table] ?? [])]; const query = {
 select() { return query; }, order() { return query; }, limit(n) { rows=rows.slice(0,n); return query; },
 eq(key,value) { rows=rows.filter(row=>row[key]===value); return query; },
 neq(key,value) { rows=rows.filter(row=>row[key]!==value); return query; },
 is(key,value) { rows=rows.filter(row=>(row[key]??null)===value); return query; },
 single: async () => ({data:rows[0]??null,error:null}), maybeSingle: async()=>({data:rows[0]??null,error:null}),
 then(resolve) { return Promise.resolve({data:rows,error:null}).then(resolve); },
 insert:forbidden, update:forbidden, upsert:forbidden, delete:forbidden,
 }; return query; }, rpc:forbidden,
}; }
`,
);
await writeFile(
  resolve(folder, "navigation.jsx"),
  `import React from "react";
const previewSearchParams = new URLSearchParams(window.location.search);
export function useSearchParams(){return previewSearchParams}
export function useRouter(){return {push(){},replace(){},refresh(){}}}
export function usePathname(){return "/dashboard/reimbursements"}
export default function Link({children,href,...props}){return <a href={href} {...props}>{children}</a>}
`,
);
await writeFile(
  resolve(folder, "entry.jsx"),
  `import React from "react";
import {createRoot} from "react-dom/client";
import {ReimbursementsCrud} from "@/features/reimbursements/components/reimbursements-crud";
window.fetch = async () => {throw new Error("Prévia sem acesso à rede externa.")};
createRoot(document.getElementById("root")).render(<main className="hub-shell mx-auto max-w-screen-2xl p-5"><div className="mb-5 rounded-lg bg-mint-100 px-4 py-3 text-sm text-mint-800">Prévia local · dados fictícios · gravações bloqueadas</div><ReimbursementsCrud/></main>);
`,
);
await writeFile(
  resolve(folder, "loader.cjs"),
  `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText}`,
);
const compiler = require("next/dist/compiled/webpack/webpack");
compiler.init();
await new Promise((ok, fail) =>
  compiler.webpack(
    {
      mode: "development",
      devtool: false,
      context: root,
      entry: resolve(folder, "entry.jsx"),
      target: "web",
      output: { path: folder, filename: "bundle.js" },
      resolve: {
        extensions: [".tsx", ".ts", ".js", ".mjs"],
        alias: {
          "@/lib/supabase/client": resolve(folder, "database.js"),
          "next/navigation": resolve(folder, "navigation.jsx"),
          "next/link": resolve(folder, "navigation.jsx"),
          "@": resolve(root, "src"),
        },
      },
      module: {
        rules: [
          {
            test: /\.[jt]sx?$/,
            exclude: /node_modules/,
            use: resolve(folder, "loader.cjs"),
          },
        ],
      },
      plugins: [
        new compiler.webpack.DefinePlugin({
          "process.env.NODE_ENV": JSON.stringify("development"),
          "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify(""),
          "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": JSON.stringify(""),
        }),
      ],
    },
    (error, stats) =>
      error || stats.hasErrors()
        ? fail(error ?? new Error(stats.toString({ all: false, errors: true })))
        : ok(),
  ),
);
await new Promise((ok, fail) => {
  const css = spawn(
    process.execPath,
    [
      resolve(root, "node_modules/tailwindcss/lib/cli.js"),
      "-i",
      "src/app/globals.css",
      "-o",
      resolve(folder, "styles.css"),
      "--minify",
    ],
    { cwd: root, stdio: "inherit", windowsHide: true },
  );
  css.once("error", fail);
  css.once("exit", (code) =>
    code === 0 ? ok() : fail(new Error(`Tailwind exited ${code}`)),
  );
});
await writeFile(
  resolve(folder, "index.html"),
  '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hub VZ — prévia local de reembolsos</title><link rel="stylesheet" href="/styles.css"><body><div id="root"></div><script src="/bundle.js"></script></body></html>',
);
const port = Number(process.env.REIMBURSEMENTS_PREVIEW_PORT ?? 3187);
if (!process.argv.includes("--build-only"))
  createServer(async (request, response) => {
    const path = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
    const files = {
      "/": ["index.html", "text/html; charset=utf-8"],
      "/bundle.js": ["bundle.js", "text/javascript"],
      "/styles.css": ["styles.css", "text/css"],
    };
    if (!files[path]) {
      response.writeHead(404).end();
      return;
    }
    try {
      response.writeHead(200, {
        "Content-Type": files[path][1],
        "Cache-Control": "no-store",
      });
      response.end(await readFile(resolve(folder, files[path][0])));
    } catch {
      response.writeHead(500).end();
    }
  }).listen(port, "127.0.0.1", () =>
    console.log(`Prévia com dados fictícios: http://127.0.0.1:${port}/?period=all`),
  );
