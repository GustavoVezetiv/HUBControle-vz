import { timingSafeEqual } from "node:crypto";
import { pluggyConfig } from "@/features/pluggy/config";
import {
  preserveSyncReport,
  type SyncReport,
  type SyncResult,
} from "@/features/pluggy/sync-report";
import {
  defaultPluggyPeriod,
  syncPluggyBank,
  pluggyMessage,
} from "@/features/pluggy/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
// The scheduled call saves owner-bound source snapshots and an audit report.
// Review and import remain separate, authenticated operations.
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
  const startedAt = new Date().toISOString();
  const results: SyncResult[] = [];
  for (const bank of config.items) {
    const bankStartedAt = new Date().toISOString();
    if (!config.credentialsPresent || !bank.valid) {
      results.push({
        institution: bank.id,
        status: "not_configured",
        startedAt: bankStartedAt,
        finishedAt: new Date().toISOString(),
      });
      continue;
    }
    try {
      const result = await syncPluggyBank(bank.id, defaultPluggyPeriod(), true);
      results.push({
        institution: bank.id,
        status: result.skipped ? "recent" : "read",
        startedAt: bankStartedAt,
        finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      results.push({
        institution: bank.id,
        status: "error",
        startedAt: bankStartedAt,
        finishedAt: new Date().toISOString(),
        error: pluggyMessage(error),
      });
    }
  }
  const report: SyncReport = {
    startedAt,
    finishedAt: new Date().toISOString(),
    results,
    financialWrites: 0,
  };
  for (const entry of results) console.info("[pluggy-sync]", entry);
  let reportPersisted = false;
  let reportError = false;
  try {
    reportPersisted = await preserveSyncReport(config.ownerId, report);
  } catch {
    reportError = true;
    console.error("[pluggy-sync] relatório privado indisponível");
  }
  return Response.json(
    { ...report, reportPersisted },
    {
      status:
        reportError ||
        results.every((row) => row.status === "error" || row.status === "not_configured")
          ? 503
          : 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
