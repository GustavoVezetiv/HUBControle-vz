import "server-only";
import { pluggyConfig } from "./config";
import { configuredPluggyReader, PluggyError } from "./client";
import { accumulatedPluggyBackup, latestPluggyBackup, savePluggyBackup } from "./backup";
import { latestOrganizzeBackup } from "../organizze/backup";
import { organizzeHistory } from "../organizze/history";
import { loadOrganizzeReferences } from "../organizze/references";
import { buildPluggyPreview } from "./preview";
import { loadPluggyLedger, stageRows, stagePluggy } from "./queries";
import { matchRules, suggestRules } from "./reconciliation";
import type { AppSupabaseClient } from "../shared/types";
import type { Institution } from "./types";
import type { Period } from "../organizze/types";

export const pluggyToday = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Cuiaba" }).format(new Date());
export const defaultPluggyPeriod = () => ({
  start: new Date(Date.parse(`${pluggyToday()}T12:00:00Z`) - 45 * 86400000)
    .toISOString()
    .slice(0, 10),
  end: pluggyToday(),
});
export function pluggyMessage(error: unknown) {
  const code = error instanceof PluggyError ? error.code : "local_or_reference_error";
  const messages: Record<string, string> = {
    upstream_401: "Credenciais recusadas pela Pluggy. Confira a aplicação demo.",
    upstream_403:
      "Autorize esta conexão no conector Meu Pluggy da aplicação demo; não crie conexão bancária direta.",
    not_meu_pluggy_proxy:
      "Este item não é um proxy real Meu Pluggy. Copie o itemId da conexão na aplicação demo.",
    upstream_429: "Limite de consultas atingido. Aguarde para consultar novamente.",
    not_configured:
      "Configure as credenciais e o itemId desta instituição em .env.local.",
  };
  return messages[code] ?? `Consulta interrompida (${code}). Backup anterior preservado.`;
}
const active = new Map<string, Promise<{ skipped: boolean }>>();
export async function syncPluggyBank(
  institution: Institution,
  period: Period,
  onlyIfDue = false,
) {
  const config = pluggyConfig();
  const bank = config.items.find((bank) => bank.id === institution);
  if (!config.credentialsPresent || !bank?.valid)
    throw new PluggyError("not_configured", 503);
  const key = `${config.ownerId}:${bank.itemId}`;
  const running = active.get(key);
  if (running) {
    await running;
    return { skipped: true };
  }
  const job = (async () => {
    const old = await latestPluggyBackup(config.ownerId, bank.itemId);
    if (
      onlyIfDue &&
      old &&
      Date.now() - Date.parse(old.snapshot.fetchedAt) < 24 * 60 * 60 * 1000
    )
      return { skipped: true };
    const snapshot = await configuredPluggyReader({
      ...config,
      itemId: bank.itemId,
      institution,
      includeInvestments: true,
    }).sync(period);
    await savePluggyBackup(snapshot);
    return { skipped: false };
  })();
  active.set(key, job);
  try {
    return await job;
  } finally {
    active.delete(key);
  }
}

export async function pluggyDashboard(
  client: AppSupabaseClient,
  owner: string,
  stage = false,
) {
  const config = pluggyConfig();
  if (config.ownerId !== owner) throw new Error("Outro proprietário.");
  const [backups, historyBackup, references, initialLedger] = await Promise.all([
    Promise.all(
      config.items.map((bank) =>
        bank.valid ? accumulatedPluggyBackup(owner, bank.itemId) : null,
      ),
    ),
    latestOrganizzeBackup(owner),
    loadOrganizzeReferences(client, owner, { start: "2000-01-01", end: pluggyToday() }),
    loadPluggyLedger(client, owner),
  ]);
  const history = historyBackup ? organizzeHistory(historyBackup.snapshot) : null;
  const views = backups.map((backup) =>
    backup ? buildPluggyPreview(backup.snapshot, references, history) : null,
  );
  if (stage && initialLedger.ready)
    for (let index = 0; index < backups.length; index++) {
      const backup = backups[index];
      const preview = views[index];
      if (backup && preview)
        await stagePluggy(
          client,
          stageRows(backup.snapshot, preview, initialLedger.rules, references.categories),
        );
    }
  const data =
    stage && initialLedger.ready ? await loadPluggyLedger(client, owner) : initialLedger;
  const banks = config.items.map((bank, index) => {
    const view = views[index];
    const snapshot = backups[index]?.snapshot;
    const state = !config.credentialsPresent
      ? "missing_credentials"
      : !bank.itemId
        ? "missing_proxy"
        : !bank.valid
          ? "invalid_proxy"
          : !snapshot
            ? "not_validated"
            : snapshot.item.status === "UPDATED" &&
                snapshot.item.executionStatus === "SUCCESS"
              ? snapshot.unavailable?.length
                ? "partial"
                : "available"
              : "needs_attention";
    return {
      id: bank.id,
      name: bank.name,
      env: bank.env,
      state,
      configured: config.credentialsPresent && bank.valid,
      fetchedAt: snapshot?.fetchedAt ?? null,
      lastUpdatedAt: snapshot?.item.lastUpdatedAt ?? null,
      summary: view?.summary ?? null,
      warnings: snapshot?.warnings ?? [],
      unavailable: snapshot?.unavailable ?? [],
    };
  });
  const ledgerByKey = new Map(data.ledger.map((entry) => [entry.sourceKey, entry]));
  const movements = views
    .flatMap((view, index) =>
      (view?.movements ?? []).map((row) => {
        const entry = ledgerByKey.get(row.sourceKey);
        const classification = matchRules(
          row.description,
          row.kind,
          data.rules,
          references.categories,
        );
        const review = entry?.review ?? {
          state:
            row.candidates.length ||
            row.bankStatus !== "POSTED" ||
            !["expense", "income"].includes(row.kind)
              ? ("pending" as const)
              : ("new" as const),
          categoryId: classification.categoryId,
          ownership: classification.ownership,
          target: null,
          targetId: null,
          reviewed: false,
        };
        const changedAfterLink =
          review.state === "reconciled" &&
          entry &&
          ((entry.linkedRaw ?? entry.raw).amount !== entry.latest.amount ||
            (entry.linkedRaw ?? entry.raw).date !== entry.latest.date);
        return {
          ...row,
          bank: config.items[index].name,
          institutionId: config.items[index].id,
          review,
          classification,
          selectedCategoryId: review.reviewed
            ? review.categoryId
            : (classification.categoryId ?? review.categoryId),
          selectedOwnership: review.reviewed
            ? review.ownership
            : (classification.ownership ?? review.ownership),
          changedAfterLink: Boolean(changedAfterLink),
        };
      }),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  return {
    banks,
    movements,
    accounts: views.flatMap((view) =>
      (view?.accounts ?? []).map((row) => ({
        ...row,
        institutionId: view!.institutionId,
      })),
    ),
    bills: views.flatMap((view) =>
      (view?.bills ?? []).map((row) => ({ ...row, institutionId: view!.institutionId })),
    ),
    investments: views.flatMap((view) =>
      (view?.investments ?? []).map((row) => ({
        ...row,
        institutionId: view!.institutionId,
      })),
    ),
    investmentTransactions: views.flatMap((view) =>
      (view?.investmentTransactions ?? []).map((row) => ({
        ...row,
        institutionId: view!.institutionId,
      })),
    ),
    categories: references.categories,
    rules: data.rules,
    proposals: suggestRules(history, references.categories),
    ready: data.ready,
    history: history
      ? {
          total: history.total,
          categories: history.categories.length,
          tags: history.tags.length,
        }
      : null,
    missingCredentials: ["PLUGGY_CLIENT_ID", "PLUGGY_CLIENT_SECRET"].filter(
      (key) => !process.env[key],
    ),
    financialWrites: 0,
  };
}
export type PluggyDashboard = Awaited<ReturnType<typeof pluggyDashboard>>;
