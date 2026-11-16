// Isolated visual review: actual components, fictitious data, no bank/database client.
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const folder = resolve(root, "tmp/pluggy-inbox-preview");
await mkdir(folder, { recursive: true });
const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Cuiaba" }).format(
  new Date(),
);
const ids = ["nubank", "xp", "sicredi", "caixa", "mercado_pago"];
const names = ["Nubank", "XP Banking", "Sicredi", "Caixa", "Mercado Pago"];
const fixture = {
  banks: ids.map((id, index) => ({
    id,
    name: names[index],
    state: "available",
    configured: true,
    fetchedAt: new Date().toISOString(),
    lastUpdatedAt: today,
    warnings: [],
    summary: { accounts: 1, cards: 1 },
  })),
  movements: [],
  accounts: [],
  bills: [],
  investments: [],
  investmentTransactions: [],
  categories: [
    { id: "food", name: "Alimentação", type: "expense", parent_category_id: null },
    { id: "income", name: "Salário", type: "income", parent_category_id: null },
    { id: "services", name: "Serviços digitais", type: "expense", parent_category_id: null },
  ],
  rules: [],
  proposals: [
    { pattern: "mercado", category: "Alimentação", categoryId: "food", count: 6, tags: ["Família"], kind: "expense", conflicts: false, firstDate: "2026-09-01", lastDate: today },
    { pattern: "salario de novembro", category: "Salário", categoryId: "income", count: 2, tags: [], kind: "income", conflicts: false, firstDate: "2025-11-01", lastDate: today },
    { pattern: "compra de exemplo", category: "Alimentação", categoryId: "food", count: 3, tags: [], kind: "expense", conflicts: false, firstDate: "2026-09-01", lastDate: today },
  ],
  ready: true,
  stagingPending: false,
  history: { total: 1956, categories: 110, tags: 20 },
  missingCredentials: [],
  financialWrites: 0,
};
function movement(id, description, overrides = {}) {
  return {
    sourceKey: `fixture-${id}`,
    id: `fixture-${id}`,
    providerId: null,
    accountId: "card",
    account: "Cartão de exemplo",
    accountType: "CREDIT",
    institutionId: "nubank",
    bank: "Nubank",
    date: today,
    description,
    amount: -85.9,
    direction: "DEBIT",
    operationType: "",
    requiresPaymentReview: false,
    currency: "BRL",
    bankStatus: "POSTED",
    category: "Alimentação",
    categoryId: null,
    ownership: null,
    origin: "pluggy",
    kind: "expense",
    invoiceId: null,
    installment: null,
    installments: null,
    candidates: [],
    historical: [],
    status: "pending_classification",
    alerts: [],
    review: {
      state: "new",
      categoryId: null,
      ownership: null,
      reviewed: false,
      updatedAt: "2026-11-09T12:00:00Z",
    },
    classification: { categoryId: null, ownership: null, ambiguous: false, ruleIds: [] },
    selectedCategoryId: null,
    selectedOwnership: null,
    changedAfterLink: false,
    ...overrides,
  };
}
fixture.movements = [
  movement(1, "Mercado do bairro"),
  movement(2, "Salário de novembro", {
    operationType: "PORTABILIDADE_SALARIO",
    requiresPaymentReview: true,
    kind: "income",
    amount: 4500,
    direction: "CREDIT",
    account: "Conta corrente",
    accountType: "BANK",
    institutionId: "sicredi",
    bank: "Sicredi",
  }),
  movement(3, "Microsoft Family · renovação mensal", {
    institutionId: "xp",
    bank: "XP Banking",
    account: "XP Visa Infinite",
    category: "Software",
    selectedCategoryId: "services",
    selectedOwnership: "shared",
  }),
  movement(
    4,
    "Restaurante com uma descrição muito longa que precisa continuar legível e não invadir as colunas de valor ou situação",
  ),
  movement(5, "Netflix", {
    amount: -55.9,
    candidates: [
      {
        id: "existing",
        bank: "nubank",
        confidence: { label: "Alta", score: 98, bankMatch: true },
        table: "credit_card_transactions",
        description: "Netflix",
        date: today,
        receivedDate: null,
        amount: 55.9,
        origin: "manual",
        ownership: "personal",
        linkedTo: "Assinatura",
        reason: "Mesmo valor; mesma data; descrição equivalente. Confirmar vínculo.",
      },
    ],
  }),
  movement(6, "PIX enviado", { operationType: "PIX", accountType: "BANK" }),
  movement(7, "Compra em processamento", { bankStatus: "PENDING", review: { state: "pending", categoryId: null, ownership: null, reviewed: false, updatedAt: "2026-11-09T12:00:00Z" } }),
  movement(8, "Pagamento da fatura", {
    kind: "invoice_payment",
    operationType: "PAGAMENTO_FATURA",
    amount: -1200,
  }),
  movement(9, "Estorno técnico", { operationType: "ESTORNO_TECNICO" }),
  movement(10, "Aplicação de reserva", { operationType: "APLICACAO", amount: -300 }),
  movement(11, "PIX recebido em revisão", {
    kind: "income",
    direction: "CREDIT",
    accountType: "BANK",
    operationType: "PIX",
    amount: 120,
  }),
  ...Array.from({ length: 22 }, (_, i) => movement(20 + i, `Compra de exemplo ${i + 1}`)),
];
const historyFixture = {
  source: "organizze",
  fetchedAt: new Date().toISOString(),
  period: { start: "2023-01-01", end: today },
  total: 2,
  categories: [{ id: "food", name: "Alimentação", parentId: null, type: "expense" }],
  tags: ["Família"],
  movements: [
    {
      sourceKey: "transaction:1",
      sourceId: "1",
      description: "Mercado no histórico",
      date: today,
      amountCents: -8590,
      kind: "expense",
      categoryId: "food",
      category: "Alimentação",
      categoryPath: "Alimentação",
      account: "Conta XP",
      accountType: "BANK",
      tags: ["Família"],
    },
  ],
};
await writeFile(
  resolve(folder, "link.jsx"),
  "export default function Link({children,href,...props}){return <a href={href} {...props}>{children}</a>}",
);
await writeFile(
  resolve(folder, "entry.jsx"),
  `import {createRoot} from "react-dom/client"; import {useState,useCallback} from "react"; import {Sidebar} from "@/components/layout/sidebar"; import {navigationGroups} from "@/lib/navigation"; import {FinancialInbox} from "@/features/pluggy/components/financial-inbox"; import {DashboardInboxPreview} from "@/features/dashboard/components/dashboard-inbox-preview"; import {SystemPreferencesProvider} from "@/features/settings/preferences-context";
  function SidebarFixture(){const [mobileOpen,setMobileOpen]=useState(false); const [collapsed,setCollapsed]=useState(true); const [openGroups,setOpenGroups]=useState([]); const close=useCallback(()=>setMobileOpen(false),[]); return <div className="hub-shell lg:flex" data-navigation-motion="enabled"><Sidebar groups={navigationGroups} collapsed={collapsed} mobileOpen={mobileOpen} openGroups={openGroups} onToggleGroup={id=>setOpenGroups(old=>old.includes(id)?old.filter(value=>value!==id):[...old,id])} onOpenGroup={id=>{setCollapsed(false);setOpenGroups([id])}} onToggleCollapsed={()=>setCollapsed(!collapsed)} onCloseMobile={close}/><main className="p-6"><button className="border p-3" onClick={()=>setMobileOpen(true)}>Abrir menu de teste</button><p>Prévia fictícia da navegação</p></main></div>}
  createRoot(document.getElementById("root")).render(<SystemPreferencesProvider userId="fixture-user">{location.search.includes("sidebar=1") ? <SidebarFixture/> : <main className="hub-shell mx-auto max-w-screen-2xl p-5"><p className="mb-4 text-xs text-ink-600">Prévia local · dados fictícios</p>{location.search.includes("dashboard=1") ? <DashboardInboxPreview start="${today.slice(0, 7)}-01" end="${today}" periodLabel="Período fictício" /> : <FinancialInbox/>}</main>}</SystemPreferencesProvider>);`,
);
await writeFile(resolve(folder, "navigation.js"), 'export const usePathname=()=>"/dashboard/imports";');
await writeFile(
  resolve(folder, "loader.cjs"),
  `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText}`,
);
const compiler = require("next/dist/compiled/webpack/webpack");
await writeFile(
  resolve(folder, "css-module-loader.cjs"),
  `module.exports=function(source){return 'const style=document.createElement("style");style.textContent='+JSON.stringify(source.replace(/:global\\(([^)]+)\\)/g,'$1'))+';document.head.appendChild(style);export default new Proxy({}, {get:(_,key)=>key});';}`,
);
compiler.init();
await new Promise((ok, fail) => {
  const build = compiler.webpack({
    mode: "development",
    devtool: false,
    context: root,
    entry: resolve(folder, "entry.jsx"),
    target: "web",
    output: { path: folder, filename: "bundle.js" },
    resolve: {
      extensions: [".tsx", ".ts", ".js", ".mjs"],
      alias: { "next/link": resolve(folder, "link.jsx"), "next/navigation": resolve(folder, "navigation.js"), "@": resolve(root, "src") },
    },
    module: {
      rules: [
        { test: /\.module\.css$/, use: resolve(folder, "css-module-loader.cjs") },
        {
          test: /\.[jt]sx?$/,
          exclude: /node_modules/,
          use: resolve(folder, "loader.cjs"),
        },
      ],
    },
  });
  build.run((error, stats) =>
    build.close(() =>
      error || stats.hasErrors()
        ? fail(error ?? new Error(stats.toString({ all: false, errors: true })))
        : ok(),
    ),
  );
});
const tailwind = require("tailwindcss");
const css = await require("postcss")([
  tailwind(resolve(root, "tailwind.config.ts")),
]).process(await readFile(resolve(root, "src/app/globals.css"), "utf8"), {
  from: resolve(root, "src/app/globals.css"),
});
await writeFile(resolve(folder, "styles.css"), css.css);
const html =
  '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hub VZ - prévia fictícia Pluggy</title><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const actions = [];
let rejectRule = "";
let releaseStaging;
let stagingGate;
let failedReads = 0;
let failedRefreshes = 0;
let sessionExpired = false;
let failSync = false;
let releaseReview;
let reviewGate;
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/api/organizze/history") {
      if (sessionExpired) {
        response.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Sessão fictícia expirada" }));
        return;
      }
      response
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify(historyFixture));
      return;
    }
    if (url.pathname === "/api/pluggy/dashboard") {
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      actions.push({ ...body, method: request.method });
      if (sessionExpired) {
        response.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Sessão fictícia expirada" }));
        return;
      }
      if (request.method === "GET" && failedReads > 0) {
        failedReads--;
        response.writeHead(502, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Leitura fictícia indisponível." }));
        return;
      }
      if (body.action === "refresh" && failedRefreshes > 0) {
        failedRefreshes--;
        response.writeHead(502, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Atualização fictícia indisponível." }));
        return;
      }
      if (body.action === "refresh" && stagingGate) await stagingGate;
      if (body.action === "refresh") fixture.stagingPending = false;
      if (body.action === "sync" && request.headers.accept?.includes("application/x-ndjson")) {
        response.writeHead(200, { "Content-Type": "application/x-ndjson" });
        response.write(JSON.stringify({ type: "progress", progress: { phase: "accounts", percent: 12, message: "Consultando contas fictícias" } }) + "\n");
        await new Promise(ok => setTimeout(ok, 300));
        response.write(JSON.stringify({ type: "progress", progress: { phase: "transactions", percent: 60, message: "Movimentações fictícias: página 1" } }) + "\n");
        await new Promise(ok => setTimeout(ok, 1000));
        response.end(JSON.stringify(failSync ? { type: "error", error: "Banco fictício indisponível." } : { type: "result", data: fixture }) + "\n");
        return;
      }
      if (body.action === "review") {
        if (reviewGate) await reviewGate;
        const row = fixture.movements.find((row) => row.sourceKey === body.sourceKey);
        assert.equal(body.confirm, true);
        assert.equal(body.expectedUpdatedAt, row.review.updatedAt);
        row.review = {
          ...row.review,
          ...body.review,
          reviewed: true,
          updatedAt: new Date().toISOString(),
        };
      }
      if (body.action === "rule") {
        if (body.rule.pattern === rejectRule) {
          response.writeHead(409, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Falha fictícia ao salvar regra" }));
          return;
        }
        assert.equal(body.confirm, true);
        assert.equal(body.rule.ownership, null);
        assert.equal(fixture.rules.some(rule => rule.pattern === body.rule.pattern), false);
        fixture.rules.push({ ...body.rule, id: `rule-${fixture.rules.length}` });
      }
      response
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify(fixture));
      return;
    }
    if (url.pathname === "/bundle.js" || url.pathname === "/styles.css") {
      response
        .writeHead(200, {
          "Content-Type": url.pathname.endsWith("js") ? "text/javascript" : "text/css",
        })
        .end(await readFile(resolve(folder, url.pathname.slice(1))));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html);
  } catch {
    response.writeHead(500).end();
  }
});
const checking = process.argv.includes("--check");
await new Promise((ok) => server.listen(checking ? 0 : 3188, "127.0.0.1", ok));
const url = `http://127.0.0.1:${server.address().port}`;
if (!checking) console.log(`Prévia fictícia: ${url}`);
else {
  let browser;
  const errors = [];
  try {
    const { chromium } = require(process.env.PLUGGY_PLAYWRIGHT_PATH || "playwright");
    browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: ["--disable-gpu", "--renderer-process-limit=1"],
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === url ? route.continue() : route.abort(),
    );
    fixture.stagingPending = true;
    stagingGate = new Promise(resolve => { releaseStaging = resolve; });
    await page.goto(url);
    await page.getByText("Mercado do bairro", { exact: true }).waitFor();
    await page.getByText("Atualizando revisões da caixa de entrada…", { exact: true }).waitFor();
    assert.equal(actions[0].method, "GET", "opening must not wait for a write");
    assert.equal(actions[1].action, "refresh");
    assert.equal(await page.getByRole("button", { name: "Sincronizar novamente", exact: true }).isDisabled(), true);
    fixture.stagingPending = false;
    releaseStaging();
    stagingGate = null;
    await page.getByText("Atualizando revisões da caixa de entrada…", { exact: true }).waitFor({ state: "hidden" });
    const afterStaging = actions.length;
    await page.reload();
    await page.getByText("Mercado do bairro", { exact: true }).waitFor();
    assert.deepEqual(actions.slice(afterStaging).map(action => action.method), ["GET"], "unchanged opening is read-only");
    failedReads = 1;
    fixture.stagingPending = true;
    await page.reload();
    await page.getByRole("alert").filter({ hasText: "Leitura fictícia indisponível." }).waitFor();
    const beforeRetry = actions.length;
    await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
    await page.getByText("Mercado do bairro", { exact: true }).waitFor();
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent.includes('Sincronizar novamente'))?.disabled);
    assert.deepEqual(actions.slice(beforeRetry).map(action => action.action ?? action.method), ["GET", "refresh"], "retry must stage new sources before unlocking reviews");
    assert.equal(await page.getByRole("alert").count(), 0, "successful recovery clears old errors");
    const beforeRefreshFailure = actions.length;
    fixture.stagingPending = true;
    failedRefreshes = 1;
    await page.getByRole("button", { name: "Atualizar tela", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Atualização fictícia indisponível." }).waitFor();
    assert.equal(await page.getByText("Mercado do bairro", { exact: true }).isVisible(), true);
    const failedRefreshRow = page.getByRole("article").filter({ hasText: "Mercado do bairro" });
    await failedRefreshRow.getByRole("button", { name: "Revisar", exact: true }).click();
    assert.equal(await failedRefreshRow.getByRole("button", { name: "Salvar classificação", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
    await page.getByRole("alert").waitFor({ state: "hidden" });
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent.includes('Sincronizar novamente'))?.disabled);
    assert.equal(await failedRefreshRow.getByRole("button", { name: "Salvar classificação", exact: true }).isDisabled(), false);
    assert.equal(actions.slice(beforeRefreshFailure).some(action => action.action === "sync"), false, "recovery does not start bank synchronization");
    await failedRefreshRow.getByRole("button", { name: "Revisar", exact: true }).click();
    await page.getByRole("textbox", { name: "Buscar movimentação", exact: true }).fill("servicos digitais");
    await page.getByText("Microsoft Family · renovação mensal", { exact: true }).waitFor();
    assert.equal(await page.getByRole("article").count(), 1, "search includes Hub category without accents");
    await page.getByRole("textbox", { name: "Buscar movimentação", exact: true }).fill("nenhum item correspondente");
    await page.getByText("Nenhum resultado para os filtros", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Limpar filtros ativos", exact: true }).click();
    await page.getByText("Mercado do bairro", { exact: true }).waitFor();
    await page.getByRole("button", { name: /Entradas na conta/ }).click();
    await page.getByRole("tab", { name: /Ignorados/ }).click();
    await page.getByText("Pagamento da fatura", { exact: true }).waitFor();
    await page.getByRole("tab", { name: /Caixa de entrada/ }).click();
    await page.getByRole("button", { name: "Mais filtros", exact: true }).click();
    await page.getByLabel("De", { exact: true }).fill("2099-12-31");
    await page.getByRole("alert").filter({ hasText: "A data inicial deve ser anterior ou igual à data final." }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Sincronizar novamente", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Limpar filtros", exact: true }).click();
    await page.getByRole("button", { name: "Recolher filtros", exact: true }).click();
    await page.getByRole("region", { name: "Composição dos itens a revisar" }).waitFor();
    assert.equal(await page.locator("#pluggy-connections").getAttribute("open"), null);
    assert.equal(await page.getByText("Pagamento da fatura", { exact: true }).count(), 0);
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        `Overflow at ${width}`,
      );
    }
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme === "dark" ? "light" : "dark" });
      await page.evaluate(
        (theme) => document.documentElement.classList.toggle("dark", theme === "dark"),
        theme,
      );
      await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== "running"));
      const linkColor = await page.getByRole("button", { name: "Aproveitar categorias do Organizze" }).evaluate(element => getComputedStyle(element).color);
      assert.equal(linkColor, theme === "dark" ? "rgb(125, 211, 252)" : "rgb(3, 105, 161)");
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.screenshot({
          path: resolve(folder, `${theme}-${width}.png`),
          fullPage: true,
        });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("tab", { name: /Conciliação/ }).click();
    await page.getByRole("button", { name: "Comparar" }).click();
    await page.getByText(/Confiança alta.*98\/100/).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Vincular selecionado" }).isDisabled(),
      true,
    );
    await page.getByRole("button", { name: "Preparar novo" }).click();
    await page.getByText(/Nenhuma importação foi aplicada/).waitFor();
    assert.equal(actions.filter((item) => item.action === "review").length, 0);
    await page.screenshot({ path: resolve(folder, "comparison.png"), fullPage: true });
    await page.getByRole("radio").check();
    await page.getByRole("button", { name: "Vincular selecionado" }).click();
    await page.getByRole("button", { name: "Ver vínculo" }).waitFor();
    assert.equal(actions.filter((item) => item.action === "review").length, 1);
    assert.equal(
      actions.find((item) => item.action === "review").review.targetId,
      "existing",
    );
    await page.getByRole("tab", { name: /^Revisar/ }).click();
    await page.getByText("PIX enviado", { exact: true }).waitFor();
    await page.getByRole("tab", { name: /Ignorados/ }).click();
    await page.getByText("Pagamento da fatura", { exact: true }).waitFor();
    await page.getByRole("tab", { name: /Histórico Organizze/ }).click();
    await page.getByText("Mercado no histórico", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Categorias", exact: true }).click();
    await page.getByRole("button", { name: "Alimentação", exact: true }).waitFor();
    await page.getByRole("button", { name: "Tags", exact: true }).click();
    await page.getByRole("button", { name: /#Família/ }).click();
    await page.getByText("Mercado no histórico", { exact: true }).waitFor();
    sessionExpired = true;
    await page.getByRole("button", { name: "Atualizar leitura do backup", exact: true }).click();
    await page.getByRole("link", { name: "Entrar novamente", exact: true }).waitFor();
    assert.equal(await page.getByText("Mercado no histórico", { exact: true }).count(), 0);
    sessionExpired = false;
    await page.getByRole("button", { name: "Atualizar leitura do backup", exact: true }).click();
    await page.getByText("Mercado no histórico", { exact: true }).waitFor();
    await page.getByRole("tab", { name: /Caixa de entrada/ }).click();
    await page.getByRole("button", { name: /Entradas na conta/ }).click();
    await page.getByRole("checkbox", { name: "Ver todas as filas" }).check();
    await page.getByText("Salário de novembro", { exact: true }).waitFor();
    await page.getByText("PIX recebido em revisão", { exact: true }).waitFor();
    const entryChart = page.getByRole("region", {
      name: "Composição dos itens a revisar",
    });
    assert.match(await entryChart.innerText(), /2 item\(ns\) a revisar/);
    await page.getByRole("button", { name: /^Todos / }).click();
    await page.getByRole("checkbox", { name: "Ver todas as filas" }).uncheck();
    for (const mode of ["top", "bottom", "keep"]) {
      await page.evaluate((mode) => {
        localStorage.setItem(
          "hubvz:system-preferences:fixture-user",
          JSON.stringify({ paginationScroll: mode }),
        );
        window.dispatchEvent(new Event("hubvz:preferences-updated"));
        window.matchMedia = () => ({ matches: true });
      }, mode);
      await page.getByRole("button", { name: "Próxima", exact: true }).click();
      await page.getByText("21–27 de 27", { exact: true }).waitFor();
      if (mode === "top") {
        const position = await page
          .getByRole("heading", { name: "O que chegou" })
          .evaluate((element) => {
            const target = element.parentElement;
            const expected = Math.min(
              Math.max(
                0,
                target.getBoundingClientRect().top +
                  scrollY -
                  parseFloat(getComputedStyle(target).scrollMarginTop),
              ),
              document.documentElement.scrollHeight - innerHeight,
            );
            return { actual: scrollY, expected };
          });
        assert.ok(
          Math.abs(position.actual - position.expected) < 3,
          JSON.stringify(position),
        );
      }
      if (mode === "bottom")
        assert.ok(
          (await page
            .getByRole("button", { name: "Próxima", exact: true })
            .evaluate((element) => element.getBoundingClientRect().bottom)) <= 1000,
        );
      await page.getByRole("button", { name: "Anterior", exact: true }).click();
      await page.getByText("Mercado do bairro", { exact: true }).waitFor();
    }
    await page.getByRole("tab", { name: "Classificar em lote", exact: true }).click();
    await page.getByRole("heading", { name: "Aproveitar o Organizze", exact: true }).waitFor();
    await page.getByRole("checkbox", { name: "Selecionar regra mercado", exact: true }).check();
    await page.getByRole("button", { name: "Salvar 1 regras", exact: true }).click();
    await page.getByText(/1 de 1 regras salvas/).waitFor();
    assert.equal(actions.filter(item => item.action === "rule").length, 1);
    assert.equal(await page.getByRole("checkbox", { name: "Selecionar regra mercado", exact: true }).isDisabled(), true);
    await page.screenshot({ path: resolve(folder, "rules-batch-dark.png"), fullPage: true });
    await page.getByRole("checkbox", { name: "Selecionar regra salario de novembro", exact: true }).check();
    await page.getByRole("checkbox", { name: "Selecionar regra compra de exemplo", exact: true }).check();
    rejectRule = "compra de exemplo";
    await page.getByRole("button", { name: "Salvar 2 regras", exact: true }).click();
    await page.getByText(/1 de 2 regras salvas/).waitFor();
    assert.equal(fixture.rules.length, 2);
    rejectRule = "";
    await page.getByRole("button", { name: "Salvar 1 regras", exact: true }).click();
    await page.getByText(/1 de 1 regras salvas/).waitFor();
    assert.equal(fixture.rules.length, 3);
    assert.equal(new Set(fixture.rules.map(rule => rule.pattern)).size, 3);
    actions.length = 0;
    await page.goto(`${url}/?dashboard=1`);
    await page.getByRole("region", { name: "Composição dos itens a revisar" }).waitFor();
    assert.ok(actions.length > 0 && actions.every((action) => action.method === "GET"));
    const inboxLink = page.getByRole("link", { name: "Revisar movimentações" });
    assert.equal(
      new URL(await inboxLink.getAttribute("href"), url).searchParams.get("from"),
      `${today.slice(0, 7)}-01`,
    );
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (theme) => document.documentElement.classList.toggle("dark", theme === "dark"),
        theme,
      );
      await page.screenshot({
        path: resolve(folder, `dashboard-${theme}.png`),
        fullPage: true,
      });
    }
    await page.goto(url);
    await page.getByText("Compra em processamento", { exact: true }).waitFor();
    assert.equal(await page.getByText("PIX enviado", { exact: true }).count(), 0);
    const pendingRow = page.getByRole("article").filter({ hasText: "Compra em processamento" });
    await pendingRow.getByRole("button", { name: "Revisar", exact: true }).click();
    assert.equal(await pendingRow.getByRole("combobox", { name: "Categoria Hub", exact: true }).isDisabled(), false);
    assert.equal(await pendingRow.getByRole("link", { name: "Preparar cadastro no Hub" }).count(), 0);
    await pendingRow.getByRole("combobox", { name: "Categoria Hub", exact: true }).fill("Alimentação");
    await page.getByRole("option", { name: "Alimentação", exact: true }).click();
    await pendingRow.getByRole("button", { name: "Salvar classificação", exact: true }).click();
    await pendingRow.getByRole("button", { name: "Revisar", exact: true }).waitFor();
    const pendingSave = actions.findLast(item => item.action === "review");
    assert.equal(pendingSave.review.state, "new");
    assert.equal(pendingSave.review.categoryId, "food");
    assert.equal(pendingSave.review.ownership, null);
    await page.getByRole("tab", { name: /^Caixa de entrada/ }).click();
    await page.getByRole("combobox").nth(0).selectOption("xp");
    await page.getByRole("button", { name: "Sincronizar novamente", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("progress")?.value === 60);
    assert.equal(await page.getByRole("button", { name: "Sincronizar novamente", exact: true }).isDisabled(), true);
    await page.screenshot({ path: resolve(folder, "sync-progress.png"), fullPage: true });
    await page.getByText(/Consulta concluída: 0 novos movimentos/).waitFor();
    await page.getByRole("progressbar").waitFor({ state: "hidden" });

    reviewGate = new Promise(resolve => { releaseReview = resolve; });
    const afterSyncRow = page.getByRole("article").filter({ hasText: "Microsoft Family" });
    await afterSyncRow.getByRole("button", { name: "Revisar", exact: true }).click();
    await afterSyncRow.getByRole("button", { name: "Salvar classificação", exact: true }).click();
    await page.getByText("Salvando revisão…", { exact: true }).waitFor();
    assert.equal(await page.getByRole("progressbar").count(), 0, "a completed sync must not reappear while saving");
    releaseReview(); reviewGate = null;
    await page.getByText("Salvando revisão…", { exact: true }).waitFor({ state: "hidden" });
    failSync = true;
    await page.getByRole("button", { name: "Sincronizar novamente", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: /conexão\(ões\) falharam/ }).waitFor();
    await page.getByRole("button", { name: /conexão\(ões\) precisam de atenção/ }).click();
    assert.equal(await page.locator("#pluggy-connections").getAttribute("open"), "");
    assert.equal(await page.getByText("Banco fictício indisponível.", { exact: true }).isVisible(), true);
    assert.equal(await page.getByRole("progressbar").count(), 0);
    await page.screenshot({ path: resolve(folder, "connection-error.png"), fullPage: true });
    failSync = false;
    await page.getByRole("button", { name: "Sincronizar XP Banking", exact: true }).click();
    await page.getByText(/Consulta concluída: 0 novos movimentos/).waitFor();
    assert.equal(await page.getByRole("button", { name: /conexão\(ões\) precisam de atenção/ }).count(), 0);

    sessionExpired = true;
    await page.getByRole("button", { name: "Atualizar tela", exact: true }).click();
    await page.getByRole("link", { name: "Entrar novamente", exact: true }).waitFor();
    assert.equal(await page.getByRole("article").count(), 0, "an expired session does not keep financial rows visible");
    sessionExpired = false;
    fixture.banks[0].fetchedAt = "invalid historical date";
    await page.getByRole("button", { name: "Atualizar tela", exact: true }).click();
    await page.getByText("Microsoft Family · renovação mensal", { exact: true }).waitFor();
    assert.deepEqual(errors, [], "a malformed historical timestamp cannot crash the screen");
    fixture.banks[0].fetchedAt = new Date().toISOString();

    await page.setViewportSize({ width: 390, height: 640 });
    await page.goto(`${url}/?sidebar=1`);
    const opener = page.getByRole("button", { name: "Abrir menu de teste" });
    await opener.click();
    const drawer = page.getByRole("dialog", { name: "Menu de navegação" });
    await drawer.waitFor();
    assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");
    for (const group of ["Financeiro", "Planejamento", "Rotina e pessoal", "Lazer e lugares", "Sistema"]) await drawer.getByRole("button", { name: group, exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] .hub-sidebar-panel')].every(element => getComputedStyle(element).opacity === "1"));
    assert.equal(await drawer.evaluate(element => element.scrollHeight > element.clientHeight), true);
    await drawer.getByRole("link", { name: "Sistema • Configurações", exact: true }).scrollIntoViewIfNeeded();
    assert.equal(await drawer.getByRole("button", { name: "Fechar menu", exact: true }).evaluate(element => { const rect = element.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight; }), true);
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => document.documentElement.classList.toggle("dark", theme === "dark"), theme);
      await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== "running"));
      const textColor = await drawer.getByRole("link", { name: "Sistema • Configurações", exact: true }).evaluate(element => getComputedStyle(element).color);
      const channels = textColor.match(/\d+/g).slice(0, 3).map(Number);
      assert.ok(theme === "dark" ? Math.min(...channels) >= 180 : Math.max(...channels) <= 130);
      await page.screenshot({ path: resolve(folder, `sidebar-mobile-${theme}.png`) });
    }
    await drawer.getByRole("link", { name: "Sistema • Configurações", exact: true }).focus();
    await page.keyboard.press("Tab");
    assert.equal(await drawer.getByRole("button", { name: "Fechar menu", exact: true }).evaluate(element => element === document.activeElement), true);
    await page.keyboard.press("Shift+Tab");
    assert.equal(await drawer.getByRole("link", { name: "Sistema • Configurações", exact: true }).evaluate(element => element === document.activeElement), true);
    await page.keyboard.press("Escape");
    await drawer.waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => document.body.style.overflow), "");
    assert.equal(await opener.evaluate(element => element === document.activeElement), true);
    await opener.click();
    await drawer.getByRole("link", { name: "Financeiro • Importações", exact: true }).click();
    await drawer.waitFor({ state: "hidden" });
    assert.deepEqual(errors, []);
    console.log(
      "PASS: initial/review refresh failures recover without bank sync, category search and filter reset, sync progress isolation, actionable bank errors, expired session recovery, invalid timestamp handling, saved values visible before staging, 4 widths, both themes, pending classification, rule batch retries, mobile navigation, no external requests or financial mutations.",
    );
  } finally {
    releaseStaging?.();
    releaseReview?.();
    await browser?.close();
    await new Promise((ok) => server.close(ok));
  }
}
