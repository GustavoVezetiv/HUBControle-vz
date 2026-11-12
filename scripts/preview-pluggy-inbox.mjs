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
  ],
  rules: [],
  proposals: [],
  ready: true,
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
    selectedCategoryId: "food",
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
  movement(7, "Compra em processamento", { bankStatus: "PENDING" }),
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
  `import {createRoot} from "react-dom/client"; import {FinancialInbox} from "@/features/pluggy/components/financial-inbox"; import {DashboardInboxPreview} from "@/features/dashboard/components/dashboard-inbox-preview"; import {SystemPreferencesProvider} from "@/features/settings/preferences-context"; createRoot(document.getElementById("root")).render(<SystemPreferencesProvider userId="fixture-user"><main className="hub-shell mx-auto max-w-screen-2xl p-5"><p className="mb-4 text-xs text-ink-600">Prévia local · dados fictícios</p>{location.search.includes("dashboard=1") ? <DashboardInboxPreview start="${today.slice(0, 7)}-01" end="${today}" periodLabel="Período fictício" /> : <FinancialInbox/>}</main></SystemPreferencesProvider>);`,
);
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
      alias: { "next/link": resolve(folder, "link.jsx"), "@": resolve(root, "src") },
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
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/api/organizze/history") {
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
      if (body.action === "review") {
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
    await page.goto(url);
    await page.getByText("Mercado do bairro", { exact: true }).waitFor();
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
      await page.evaluate(
        (theme) => document.documentElement.classList.toggle("dark", theme === "dark"),
        theme,
      );
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
    await page.getByRole("tab", { name: /Pendentes/ }).click();
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
      await page.getByText("21–26 de 26", { exact: true }).waitFor();
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
    await page.getByRole("tab", { name: "Regras", exact: true }).click();
    await page.getByText("Regras simples de classificação", { exact: true }).waitFor();
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
    assert.deepEqual(errors, []);
    console.log(
      "PASS: 4 widths, light/dark screenshots, tabs, comparison, explicit selection, existing review payload, no external requests or financial mutations.",
    );
  } finally {
    await browser?.close();
    await new Promise((ok) => server.close(ok));
  }
}
