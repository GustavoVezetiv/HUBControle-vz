import { redirect } from "next/navigation";

import { decideOAuthAuthorization } from "@/app/oauth/consent/actions";
import { createClient } from "@/lib/supabase/server";
import { isAllowedOAuthClient, isMcpEnabled } from "@/features/mcp/security";

export const metadata = { title: "Autorizar integração" };

export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string; error?: string }>;
}) {
  const { authorization_id: authorizationId, error: queryError } = await searchParams;
  if (!authorizationId || authorizationId.length > 200) redirect("/login");

  const supabase = await createClient();
  if (!supabase) return <ConsentError message="Supabase não está configurado." />;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect(`/login?redirect=${encodeURIComponent(`/oauth/consent?authorization_id=${authorizationId}`)}`);

  const { data: details, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !details) return <ConsentError message="A solicitação de autorização expirou ou é inválida." />;
  if (!("authorization_id" in details)) redirect(details.redirect_url);
  if (!isMcpEnabled() || !isAllowedOAuthClient(details.client.id, process.env.MCP_ALLOWED_OAUTH_CLIENT_IDS)) {
    return <ConsentError message="Este cliente OAuth não foi habilitado para o Hub VZ." />;
  }

  const scopes = (details.scope ?? "").split(" ").filter(Boolean);
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <section className="w-full max-w-xl rounded-lg border border-ink-950/10 bg-white p-8 shadow-soft dark:border-white/10 dark:bg-slate-950">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-mint-600">Hub VZ</p>
        <h1 className="mt-3 text-2xl font-semibold text-ink-950 dark:text-slate-100">Autorizar conexão MCP</h1>
        <p className="mt-3 text-sm leading-6 text-ink-600 dark:text-slate-300">
          <strong className="text-ink-950 dark:text-slate-100">{details.client.name}</strong> solicitou acesso à sua conta no Hub VZ. As ferramentas financeiras estão disponíveis somente para consulta. Propostas de planejamento, quando habilitadas, exigem aprovação separada no Hub.
        </p>
        <p className="mt-3 text-sm leading-6 text-amber-800 dark:text-amber-200">
          O token OAuth também pode consultar seus dados diretamente pela Data API do Supabase. A proteção adicional contra escrita direta depende da migration MCP aplicada e testada neste ambiente. Autorize somente um cliente de confiança.
        </p>
        <div className="mt-6 rounded-md border border-ink-950/10 bg-slate-50 p-4 text-sm dark:border-white/10 dark:bg-white/5">
          <p className="font-semibold text-ink-950 dark:text-slate-100">Permissões solicitadas</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-600 dark:text-slate-300">
            {scopes.length > 0 ? scopes.map((scope) => <li key={scope}>{scope}</li>) : <li>Acesso autenticado aos seus dados do Hub VZ.</li>}
          </ul>
        </div>
        {queryError ? <p className="mt-4 text-sm text-danger-600">Não foi possível concluir a autorização. Tente novamente.</p> : null}
        <form action={decideOAuthAuthorization} className="mt-7 flex flex-wrap gap-3">
          <input type="hidden" name="authorizationId" value={authorizationId} />
          <button className="rounded-md bg-mint-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-mint-700" name="decision" value="approve">Autorizar</button>
          <button className="rounded-md border border-ink-950/15 px-4 py-2.5 text-sm font-semibold text-ink-800 transition hover:bg-slate-100 dark:border-white/15 dark:text-slate-100 dark:hover:bg-white/10" name="decision" value="deny">Cancelar</button>
        </form>
      </section>
    </main>
  );
}

function ConsentError({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <section className="w-full max-w-lg rounded-lg border border-danger-600/25 bg-white p-8 shadow-soft dark:bg-slate-950">
        <h1 className="text-xl font-semibold text-ink-950 dark:text-slate-100">Não foi possível autorizar a conexão</h1>
        <p className="mt-3 text-sm text-ink-600 dark:text-slate-300">{message}</p>
      </section>
    </main>
  );
}
