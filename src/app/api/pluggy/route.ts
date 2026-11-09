import { createClient } from "@/lib/supabase/server";
import { configuredPluggyReader, PluggyError } from "@/features/pluggy/client";
import { latestPluggyBackup, savePluggyBackup } from "@/features/pluggy/backup";
import { latestOrganizzeBackup } from "@/features/organizze/backup";
import { organizzeHistory } from "@/features/organizze/history";
import { loadOrganizzeReferences } from "@/features/organizze/references";
import { buildPluggyPreview } from "@/features/pluggy/preview";
import { validatePeriod } from "@/features/organizze/extraction";
import type { PluggySnapshot } from "@/features/pluggy/types";

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
function config() {
  return {
    clientId: process.env.PLUGGY_CLIENT_ID ?? "",
    clientSecret: process.env.PLUGGY_CLIENT_SECRET ?? "",
    itemId: process.env.PLUGGY_NUBANK_ITEM_ID ?? "",
    ownerId: process.env.PLUGGY_HUB_USER_ID ?? process.env.ORGANIZZE_HUB_USER_ID ?? "",
  };
}
async function session() {
  const client = await createClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  return !error && data.user && data.user.id === config().ownerId
    ? { client, owner: data.user.id }
    : null;
}
async function preview(
  auth: NonNullable<Awaited<ReturnType<typeof session>>>,
  snapshot: PluggySnapshot,
) {
  const [references, history] = await Promise.all([
    loadOrganizzeReferences(auth.client, auth.owner, snapshot.period),
    latestOrganizzeBackup(auth.owner),
  ]);
  return buildPluggyPreview(
    snapshot,
    references,
    history ? organizzeHistory(history.snapshot) : null,
  );
}
export async function GET(request: Request) {
  const auth = await session();
  if (!auth)
    return json(
      {
        error:
          "Entre como proprietário; configure PLUGGY_HUB_USER_ID no servidor (ou reutilize ORGANIZZE_HUB_USER_ID).",
      },
      401,
    );
  const settings = config();
  try {
    const backup = settings.itemId
      ? await latestPluggyBackup(auth.owner, settings.itemId)
      : null;
    const action = new URL(request.url).searchParams.get("action") ?? "status";
    if (action === "backup")
      return backup
        ? json({
            preview: await preview(auth, backup.snapshot),
            backupId: backup.backupId,
          })
        : json({ error: "Nenhuma prévia local desta conexão." }, 404);
    if (action === "download")
      return backup
        ? new Response(JSON.stringify(backup.snapshot), {
            headers: {
              "Content-Type": "application/json",
              "Content-Disposition": 'attachment; filename="pluggy-backup.json"',
              "Cache-Control": "no-store, private",
            },
          })
        : json({ error: "Nenhum backup disponível." }, 404);
    if (action !== "status") return json({ error: "Ação inválida." }, 400);
    const missing = [
      ["PLUGGY_CLIENT_ID", settings.clientId],
      ["PLUGGY_CLIENT_SECRET", settings.clientSecret],
      ["PLUGGY_NUBANK_ITEM_ID", settings.itemId],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);
    return json({
      configured: !missing.length,
      missing,
      historyAvailable: Boolean(await latestOrganizzeBackup(auth.owner)),
      backupAvailable: Boolean(backup),
    });
  } catch {
    return json(
      {
        error:
          "Não foi possível carregar a prévia ou as referências. Nenhum dado financeiro foi alterado.",
      },
      502,
    );
  }
}
export async function POST(request: Request) {
  const url = new URL(request.url);
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    if (
      origin.host.toLowerCase() !==
        (request.headers.get("host") ?? url.host).toLowerCase() ||
      origin.protocol !==
        `${request.headers.get("x-forwarded-proto") ?? url.protocol.slice(0, -1)}:`
    )
      return json({ error: "Origem inválida." }, 403);
  } catch {
    return json({ error: "Origem inválida." }, 403);
  }
  const auth = await session();
  if (!auth) return json({ error: "Entre como proprietário da integração." }, 401);
  let body;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > 2048)
      return json({ error: "Pedido excede o limite." }, 413);
    body = JSON.parse(text);
    if (
      !body ||
      body.action !== "preview" ||
      body.nubankConfirmed !== true ||
      Object.keys(body).some(
        (key) => !["action", "period", "nubankConfirmed"].includes(key),
      )
    )
      throw new Error();
    validatePeriod(body.period);
  } catch {
    return json(
      {
        error:
          "Informe período válido e confirme que a conexão configurada é do Nubank. Apenas prévia é permitida.",
      },
      400,
    );
  }
  try {
    const snapshot = await configuredPluggyReader(config()).sync(body.period);
    const backupId = await savePluggyBackup(snapshot);
    return json({ preview: await preview(auth, snapshot), backupId });
  } catch (error) {
    if (error instanceof PluggyError) {
      const messages: Record<string, string> = {
        not_configured:
          "Configure as credenciais e o item proxy Nubank somente no servidor.",
        upstream_401:
          "Autenticação Pluggy recusada. Confira as credenciais da aplicação demo.",
        upstream_403:
          "Acesso Pluggy não autorizado. Confira o consentimento e a conexão proxy na aplicação demo.",
        upstream_429: "Limite Pluggy atingido. Aguarde antes de tentar novamente.",
        not_meu_pluggy_proxy:
          "Use o item real do conector Meu Pluggy na aplicação demo, vinculado ao Nubank.",
      };
      return json(
        {
          error:
            messages[error.code] ??
            `Leitura interrompida (${error.code}). Nenhum lançamento foi importado.`,
        },
        error.status,
      );
    }
    return json(
      {
        error:
          "Não foi possível preparar a prévia. Nenhum dado financeiro foi alterado; confira também as referências do Hub e o armazenamento local.",
      },
      502,
    );
  }
}
