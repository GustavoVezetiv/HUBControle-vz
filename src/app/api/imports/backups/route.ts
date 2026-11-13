import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { createClient } from "@/lib/supabase/server";
import { pluggyConfig } from "@/features/pluggy/config";
import { validatePluggySnapshot } from "@/features/pluggy/backup";
import { validateSnapshot } from "@/features/organizze/backup";
import { remoteSnapshotStorage } from "@/features/imports/backup-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" },
});

// Restores source history only. It never calls the accounting/import RPCs.
export async function POST(request: Request) {
  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin) return json({ error: "Origem inválida." }, 403);
  const client = await createClient();
  const auth = client ? await client.auth.getUser() : null;
  const owner = auth?.data.user?.id;
  const config = pluggyConfig();
  if (!owner || auth?.error || owner !== config.ownerId) return json({ error: "Acesso restrito ao proprietário." }, 401);
  if (request.headers.get("content-type") !== "application/gzip") return json({ error: "Envie um histórico JSON compactado." }, 415);
  const source = url.searchParams.get("source");
  if (source !== "pluggy" && source !== "organizze") return json({ error: "Origem de histórico inválida." }, 400);
  if (Number(request.headers.get("content-length") ?? 0) > 4 * 1024 * 1024) return json({ error: "Arquivo compactado excede 4 MiB." }, 413);
  let content: string;
  let id: string;
  try {
    const compressed = Buffer.from(await request.arrayBuffer());
    if (compressed.length > 4 * 1024 * 1024) return json({ error: "Arquivo compactado excede 4 MiB." }, 413);
    const raw = gunzipSync(compressed, { maxOutputLength: 80 * 1024 * 1024 });
    content = raw.toString("utf8");
    const value = JSON.parse(content);
    const snapshot = source === "pluggy" ? value : value.snapshot;
    if (source === "pluggy") {
      validatePluggySnapshot(snapshot, owner, snapshot?.itemId);
      if (!config.items.some((item) => item.valid && item.itemId === snapshot.itemId && item.id === snapshot.institution))
        return json({ error: "Histórico não pertence às conexões configuradas." }, 400);
    } else validateSnapshot(snapshot, owner);
    const hash = createHash("sha256").update(raw).digest("hex").slice(0, 32);
    const uuid = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
    const date = snapshot.source === "pluggy" ? snapshot.fetchedAt : snapshot.startedAt;
    id = `${new Date(date).toISOString().replace(/[:.]/g, "-")}-${uuid}`;
  } catch { return json({ error: "Histórico inválido ou pertencente a outro usuário." }, 400); }
  try {
    const store = await remoteSnapshotStorage(source, owner);
    if ((await store.list()).includes(id)) {
      if (await store.read(id) !== content) return json({ error: "Histórico existente divergente." }, 409);
      return json({ restored: true, alreadyPresent: true });
    }
    await store.write(id, content);
    if (await store.read(id) !== content) return json({ error: "Verificação da cópia não conferiu." }, 502);
    return json({ restored: true, alreadyPresent: false });
  } catch { return json({ error: "Não foi possível preservar o histórico. Arquivo original mantido." }, 502); }
}
