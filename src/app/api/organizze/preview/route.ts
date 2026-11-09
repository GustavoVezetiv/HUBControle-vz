import { createOrganizzeReader, OrganizzeError } from "@/features/organizze/client";
import { validatePeriod } from "@/features/organizze/extraction";
import { loadOrganizzeReferences } from "@/features/organizze/references";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });

// This route and its upstream reader expose only GET. No official writes or
// service-role client are used, including during extraction and reconciliation.
export async function GET(request: Request) {
  const client = await createClient();
  if (!client) return json({ error: "Supabase não configurado." }, 503);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user)
    return json({ error: "Entre no Hub para consultar a prévia." }, 401);
  // Server credentials belong to one account, never to every logged-in user.
  const ownerId = process.env.ORGANIZZE_HUB_USER_ID;
  if (!ownerId)
    return json(
      {
        error:
          "Configure ORGANIZZE_HUB_USER_ID no servidor para restringir a conta Organizze.",
      },
      503,
    );
  if (data.user.id !== ownerId)
    return json({ error: "Integração indisponível para este usuário." }, 403);

  const params = new URL(request.url).searchParams;
  if (params.get("action") === "references") {
    const period = { start: params.get("start") ?? "", end: params.get("end") ?? "" };
    try {
      validatePeriod(period);
    } catch {
      return json({ error: "Período inválido." }, 400);
    }
    try {
      return json(await loadOrganizzeReferences(client, ownerId, period));
    } catch {
      return json(
        { error: "Conciliação incompleta: falha ao carregar as referências do Hub." },
        502,
      );
    }
  }
  if (params.get("action") !== "extract") return json({ error: "Ação inválida." }, 400);
  try {
    const read = createOrganizzeReader({
      email: process.env.ORGANIZZE_EMAIL ?? "",
      apiKey: process.env.ORGANIZZE_API_KEY ?? "",
      userAgent: process.env.ORGANIZZE_USER_AGENT ?? "",
    });
    const pageText = params.get("page");
    const period =
      params.has("start") || params.has("end")
        ? { start: params.get("start") ?? "", end: params.get("end") ?? "" }
        : undefined;
    return json(
      await read({
        path: params.get("path") ?? "",
        page: pageText === null ? undefined : Number(pageText),
        period,
      }),
    );
  } catch (error) {
    if (error instanceof OrganizzeError) {
      const messages: Record<string, string> = {
        not_configured:
          "Configure ORGANIZZE_EMAIL, ORGANIZZE_API_KEY e ORGANIZZE_USER_AGENT somente no servidor.",
        credentials_rejected:
          "Organizze recusou a autenticação. Confira a chave, o e-mail e a licença ativa.",
        rate_limited:
          "Limite da API Organizze atingido. Aguarde antes de retomar a extração.",
      };
      return json(
        {
          error:
            messages[error.code] ??
            `Extração interrompida (${error.code}). A prévia permanece parcial.`,
        },
        error.status,
      );
    }
    return json(
      { error: "Não foi possível consultar o Organizze. A prévia permanece parcial." },
      502,
    );
  }
}
