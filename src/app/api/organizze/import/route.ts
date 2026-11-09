import { createClient } from "@/lib/supabase/server";
import { readOrganizzeBackup, saveOrganizzeBackup, latestOrganizzeBackup, validateSnapshot } from "@/features/organizze/backup";
import { loadOrganizzeReferences } from "@/features/organizze/references";
import { buildOrganizzeImport } from "@/features/imports/organizze";
import type { ReconciliationDecisions } from "@/features/imports/organizze";
import type { Json } from "@/lib/supabase/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" } });
async function session() {
  const client = await createClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  if (error || !data.user || data.user.id !== process.env.ORGANIZZE_HUB_USER_ID) return null;
  return { client, owner: data.user.id };
}
export async function GET() {
  const auth = await session();
  if (!auth) return json({ error: "Entre com o usuário proprietário da integração." }, 401);
  const result = await latestOrganizzeBackup(auth.owner);
  return result ? json(result) : json({ error: "Nenhum backup local disponível. Extraia ou abra um JSON salvo." }, 404);
}
export async function POST(request: Request) {
  // Next may build request.url with localhost while the browser uses 127.0.0.1.
  // Match the actual HTTP Host and scheme; keep cross-origin requests blocked.
  const requestUrl = new URL(request.url);
  let sameOrigin = false;
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    const protocol = request.headers.get("x-forwarded-proto") ?? requestUrl.protocol.slice(0, -1);
    sameOrigin = origin.host.toLowerCase() === (request.headers.get("host") ?? requestUrl.host).toLowerCase() && origin.protocol === `${protocol}:`;
  } catch { /* Missing or malformed Origin is rejected. */ }
  if (!sameOrigin) return json({ error: "Origem inválida." }, 403);
  const auth = await session();
  if (!auth) return json({ error: "Entre com o usuário proprietário da integração." }, 401);
  if (Number(request.headers.get("content-length") ?? 0) > 80 * 1024 * 1024) return json({ error: "Backup excede 80 MiB." }, 413);
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > 80 * 1024 * 1024) return json({ error: "Backup excede 80 MiB." }, 413);
    const body = JSON.parse(text);
    if (body.action === "backup") {
      validateSnapshot(body.snapshot, auth.owner);
      return json({ backupId: await saveOrganizzeBackup(body.snapshot, auth.owner) });
    }
    if (!["preview", "confirm"].includes(body.action) || typeof body.backupId !== "string") return json({ error: "Ação inválida." }, 400);
    const snapshot = await readOrganizzeBackup(body.backupId, auth.owner);
    const references = await loadOrganizzeReferences(auth.client, auth.owner, snapshot.period);
    const mappings = body.cardMappings ?? {};
    if (typeof mappings !== "object" || Array.isArray(mappings) || Object.values(mappings).some(value => typeof value !== "string")) return json({ error: "Vínculos de cartão inválidos." }, 400);
    const decisions = body.decisions ?? {};
    if (!decisions || typeof decisions !== "object" || Array.isArray(decisions) || Object.keys(decisions).length > 200000) return json({ error: "Decisões de conciliação inválidas." }, 400);
    const plan = buildOrganizzeImport(snapshot, references, mappings, decisions as ReconciliationDecisions);
    if (body.action === "preview") {
      const ready = await auth.client.rpc("organizze_reconciliation_ready");
      return json({ summary: plan.summary, ready: !ready.error && ready.data === true, reviews: plan.reviews, blockers: plan.blockers, notes: plan.operations.filter(row => row.reason).map(row => ({ sourceKey: row.sourceKey, reason: row.reason })) });
    }
    if (body.confirm !== true) return json({ error: "Confirme explicitamente a conciliação." }, 400);
    if (plan.blockers.length) return json({ error: "Resolva as decisões pendentes antes de confirmar; nenhum dado foi importado." }, 409);
    const readiness = await auth.client.rpc("organizze_reconciliation_ready");
    if (readiness.error || readiness.data !== true) return json({ error: "A nova migration de conciliação precisa ser aplicada antes de confirmar." }, 409);
    const result = await auth.client.rpc("confirm_organizze_reconciliation", { p_rows: plan.operations as unknown as Json, p_period: snapshot.period });
    if (result.error) return json({ error: result.error.code === "PGRST202" ? "O banco ainda precisa da migration Organizze antes de importar." : "A importação foi revertida. Atualize a prévia e confira os vínculos antes de tentar novamente." }, 409);
    return json({ result: result.data });
  } catch {
    return json({ error: "Não foi possível preparar a importação. Confira o backup, a cobertura e os vínculos. Nenhuma importação parcial foi confirmada." }, 400);
  }
}
