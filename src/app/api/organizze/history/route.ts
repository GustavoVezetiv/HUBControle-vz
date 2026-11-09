import { createClient } from "@/lib/supabase/server";
import { latestOrganizzeBackup } from "@/features/organizze/backup";
import { organizzeHistory } from "@/features/organizze/history";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store, private" } });
export async function GET() {
  const client = await createClient();
  const user = client ? await client.auth.getUser() : null;
  if (
    user?.error ||
    !user?.data.user ||
    user.data.user.id !== process.env.ORGANIZZE_HUB_USER_ID
  )
    return json({ error: "Entre como proprietário da integração." }, 401);
  const backup = await latestOrganizzeBackup(user.data.user.id);
  return backup
    ? json(organizzeHistory(backup.snapshot))
    : json({ error: "Nenhum backup local do Organizze disponível." }, 404);
}
