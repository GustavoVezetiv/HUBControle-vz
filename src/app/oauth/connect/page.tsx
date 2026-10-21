import { cookies } from "next/headers";

import { continueOAuthConnection } from "@/app/oauth/connect/actions";
import { getOAuthConnectView, oauthCookieName } from "@/features/mcp/oauth/service";

export const metadata = { title: "Conectar ChatGPT ao Hub VZ" };
export const dynamic = "force-dynamic";

export default async function OAuthConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ flow?: string; error?: string }>;
}) {
  const { flow = "", error } = await searchParams;
  const cookieStore = await cookies();
  const cookieValue = /^mcp_fl_[A-Za-z0-9_-]{43}$/.test(flow)
    ? cookieStore.get(oauthCookieName(flow))?.value
    : undefined;
  const view = await getOAuthConnectView(flow, cookieValue);
  if (!view) return <OAuthError />;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <section className="w-full max-w-xl border border-slate-200 bg-white p-8 shadow-soft dark:border-slate-700 dark:bg-slate-900">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-mint-600">Hub VZ</p>
        <h1 className="mt-3 text-2xl font-semibold">Conectar ao ChatGPT</h1>
        {view.phase === "login" ? (
          <>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Entre com sua conta do Hub. A sessão do Supabase fica criptografada no servidor; o ChatGPT recebe somente um token opaco restrito a este MCP.
            </p>
            {error === "login" ? <p role="alert" className="mt-4 border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-100">E-mail ou senha inválidos, ou a conta exige MFA.</p> : null}
            <form action={continueOAuthConnection} className="mt-6 space-y-4">
              <input type="hidden" name="flow" value={flow} />
              <input type="hidden" name="csrf" value={view.csrf} />
              <input type="hidden" name="action" value="login" />
              <label className="block text-sm font-medium">E-mail<input className="mt-1 block w-full border border-slate-300 bg-white px-3 py-2 text-slate-950 outline-none focus:border-mint-600 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" type="email" name="email" autoComplete="username" required maxLength={254} /></label>
              <label className="block text-sm font-medium">Senha<input className="mt-1 block w-full border border-slate-300 bg-white px-3 py-2 text-slate-950 outline-none focus:border-mint-600 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" type="password" name="password" autoComplete="current-password" required maxLength={1024} /></label>
              <button className="bg-mint-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-mint-700" type="submit">Entrar</button>
            </form>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Autorizar <strong className="text-slate-950 dark:text-white">ChatGPT</strong> a consultar os dados de <strong className="text-slate-950 dark:text-white">{view.email}</strong> no Hub VZ?
            </p>
            <div className="mt-5 border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-700 dark:bg-slate-950">
              <p className="font-semibold">Permissões</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600 dark:text-slate-300">
                <li>Consultar somente os dados do usuário autenticado.</li>
                {view.scope.includes("mcp:write") ? <li>Criar e editar registros financeiros simples diretamente, com validação, auditoria e idempotência.</li> : <li>Nenhuma alteração de dados.</li>}
                <li>Renovar a conexão por até 30 dias.</li>
              </ul>
            </div>
            <p className="mt-4 break-all text-xs text-slate-500">Recurso autorizado: {view.resource}</p>
            {error ? <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-300">A autorização não pôde ser concluída. Tente novamente.</p> : null}
            <form action={continueOAuthConnection} className="mt-7 flex flex-wrap gap-3">
              <input type="hidden" name="flow" value={flow} />
              <input type="hidden" name="csrf" value={view.csrf} />
              <button className="bg-mint-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-mint-700" name="action" value="approve">
                {view.scope.includes("mcp:write") ? "Autorizar leitura e escrita" : "Autorizar leitura"}
              </button>
              <button className="border border-slate-300 px-4 py-2.5 text-sm font-semibold transition hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800" name="action" value="deny">Cancelar</button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}

function OAuthError() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12 dark:bg-slate-950">
      <section className="w-full max-w-lg border border-red-300 bg-white p-8 text-slate-950 dark:border-red-800 dark:bg-slate-900 dark:text-slate-100">
        <h1 className="text-xl font-semibold">Solicitação expirada ou inválida</h1>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Volte ao ChatGPT e inicie a conexão novamente.</p>
      </section>
    </main>
  );
}
