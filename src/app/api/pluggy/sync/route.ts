import { timingSafeEqual } from "node:crypto";
import { pluggyConfig } from "@/features/pluggy/config";
import {
  defaultPluggyPeriod,
  syncPluggyBank,
  pluggyMessage,
} from "@/features/pluggy/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Optional daily trigger: no Supabase client, service role or financial writes.
// It only saves owner-bound local source backups; authenticated UI stages them.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret ?? ""}`;
  if (
    !secret ||
    Buffer.byteLength(header) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(header), Buffer.from(expected))
  )
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  const config = pluggyConfig();
  const results = [];
  for (const bank of config.items) {
    if (!config.credentialsPresent || !bank.valid) {
      results.push({ institution: bank.id, status: "not_configured" });
      continue;
    }
    try {
      const result = await syncPluggyBank(bank.id, defaultPluggyPeriod(), true);
      results.push({ institution: bank.id, status: result.skipped ? "recent" : "read" });
    } catch (error) {
      results.push({
        institution: bank.id,
        status: "error",
        error: pluggyMessage(error),
      });
    }
  }
  return Response.json(
    { results, financialWrites: 0 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
