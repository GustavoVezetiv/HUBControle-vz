import "server-only";
import { usesRemoteImportBackups, remoteSnapshotStorage, ImportBackupStorageError } from "../imports/backup-storage";
import { mkdir, readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { validatePeriod } from "../organizze/extraction";
import { isUuid } from "./client";
import type { PluggySnapshot } from "./types";
import { institutions } from "./types";

const folder = join(process.cwd(), "tmp", "pluggy-backups");
const pattern = /^\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9-]{36}$/;
export function validatePluggySnapshot(
  value: unknown,
  owner: string,
  item: string,
): asserts value is PluggySnapshot {
  if (!value || typeof value !== "object") throw new Error("Backup inválido.");
  const s = value as PluggySnapshot;
  if (
    s.version !== 1 ||
    s.source !== "pluggy" ||
    !institutions.some((bank) => bank.id === s.institution) ||
    s.ownerId !== owner ||
    s.itemId !== item ||
    !isUuid(item) ||
    s.complete !== true ||
    !Array.isArray(s.accounts) ||
    !Array.isArray(s.transactions) ||
    !Array.isArray(s.bills) ||
    !Array.isArray(s.receipts) ||
    !Array.isArray(s.warnings) ||
    s.transactions.length > 200000
  )
    throw new Error("Backup inválido ou de outra conexão.");
  validatePeriod(s.period);
  const accounts = new Set<string>();
  for (const row of s.accounts) {
    if (!isUuid(row.id) || accounts.has(row.id) || row.itemId !== item)
      throw new Error("Conta inválida.");
    accounts.add(row.id);
  }
  const ids = new Set<string>();
  for (const row of s.transactions) {
    const key = `${row.accountId}:${row.id}`;
    if (!isUuid(row.id) || !accounts.has(String(row.accountId)) || ids.has(key))
      throw new Error("Movimentação inválida.");
    ids.add(key);
  }
  for (const row of s.bills)
    if (!accounts.has(row.accountId) || !isUuid(row.raw?.id))
      throw new Error("Fatura inválida.");
  const investments = new Set<string>();
  for (const row of s.investments ?? []) {
    if (!isUuid(row.id) || row.itemId !== item || investments.has(row.id))
      throw new Error("Investimento inválido.");
    investments.add(row.id);
  }
  for (const row of s.investmentTransactions ?? [])
    if (!investments.has(row.investmentId) || !isUuid(row.raw?.id))
      throw new Error("Movimentação de investimento inválida.");
}
export async function savePluggyBackup(snapshot: PluggySnapshot) {
  validatePluggySnapshot(snapshot, snapshot.ownerId, snapshot.itemId);
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
  const content = JSON.stringify(snapshot);
  if (Buffer.byteLength(content) > 80 * 1024 * 1024)
    throw new Error("Backup excede 80 MiB.");
  if (usesRemoteImportBackups()) {
    await (await remoteSnapshotStorage("pluggy", snapshot.ownerId)).write(id, content);
    return id;
  }
  await mkdir(join(folder, id), { recursive: true });
  await writeFile(join(folder, id, "pluggy-backup.json"), content, {
    flag: "wx",
    mode: 0o600,
  });
  return id;
}
export async function latestPluggyBackup(owner: string, item: string) {
  const remote = usesRemoteImportBackups() ? await remoteSnapshotStorage("pluggy", owner) : null;
  const names = remote ? await remote.list() : await readdir(folder).catch(() => [] as string[]);
  for (const id of names
    .filter((name) => pattern.test(name))
    .sort()
    .reverse()) {
    try {
      const file = join(folder, id, "pluggy-backup.json");
      if (!remote && (await stat(file)).size > 80 * 1024 * 1024) continue;
      const snapshot: unknown = JSON.parse(remote ? await remote.read(id) : await readFile(file, "utf8"));
      validatePluggySnapshot(snapshot, owner, item);
      return { backupId: id, snapshot };
    } catch (error) {
      if (error instanceof ImportBackupStorageError) throw error;
      /* Never expose another user's or an incomplete backup. */
    }
  }
  return null;
}

export async function accumulatedPluggyBackup(owner: string, item: string) {
  return (await accumulatedPluggyBackups(owner, [item])).get(item) ?? null;
}

type AccumulatedBackup = {
  backupId: string;
  latestPeriod: PluggySnapshot["period"];
  snapshot: PluggySnapshot;
};

// All connections share a folder. Read each immutable snapshot once per request,
// not once per bank. No raw financial data is cached between requests/users.
export async function accumulatedPluggyBackups(owner: string, items: string[]) {
  const requested = new Set(items);
  const results = new Map<string, AccumulatedBackup>();
  if (!requested.size) return results;
  const remote = usesRemoteImportBackups() ? await remoteSnapshotStorage("pluggy", owner) : null;
  const names = (remote ? await remote.list() : await readdir(folder).catch(() => [] as string[]))
    .filter((name) => pattern.test(name))
    .sort();
  const accumulated = new Map<string, {
    latest: { backupId: string; snapshot: PluggySnapshot };
    movements: Map<string, PluggySnapshot["transactions"][number]>;
    accounts: Map<string, PluggySnapshot["accounts"][number]>;
    firstDay: string;
    lastDay: string;
  }>();
  async function read(id: string) {
    try {
      const file = join(folder, id, "pluggy-backup.json");
      if (!remote && (await stat(file)).size > 80 * 1024 * 1024) return null;
      const s: unknown = JSON.parse(remote ? await remote.read(id) : await readFile(file, "utf8"));
      const item = s && typeof s === "object" && "itemId" in s ? s.itemId : null;
      if (typeof item !== "string" || !requested.has(item)) return null;
      validatePluggySnapshot(s, owner, item);
      return { backupId: id, snapshot: s };
    } catch (error) {
      if (error instanceof ImportBackupStorageError) throw error;
      return null;
    }
  }
  // At most two downloads in flight; merge in timestamp order regardless of
  // response order, and release intermediate snapshots after each small batch.
  for (let offset = 0; offset < names.length; offset += 2) {
    const batch = await Promise.all(names.slice(offset, offset + 2).map(read));
    for (const backup of batch) {
      if (!backup) continue;
      const s = backup.snapshot;
      const state = accumulated.get(s.itemId) ?? {
        latest: backup, movements: new Map(), accounts: new Map(),
        firstDay: s.period.start, lastDay: s.period.end,
      };
      const { movements, accounts } = state;
      // Preserve old movements when the next run uses an overlapping/recent
      // window. Update identical IDs in place; never infer deletions from absence.
      for (const row of s.transactions) {
        const key = `${row.accountId}:${row.id}`;
        const old = movements.get(key);
        if (
          old &&
          typeof old.updatedAt === "string" &&
          typeof row.updatedAt === "string" &&
          Date.parse(old.updatedAt) > Date.parse(row.updatedAt)
        )
          continue;
        movements.set(key, row);
      }
      for (const row of s.accounts) accounts.set(String(row.id), row);
      state.firstDay = s.period.start < state.firstDay ? s.period.start : state.firstDay;
      state.lastDay = s.period.end > state.lastDay ? s.period.end : state.lastDay;
      state.latest = backup;
      accumulated.set(s.itemId, state);
    }
  }
  for (const [item, { latest, accounts, movements, firstDay, lastDay }] of accumulated) {
    const currentAccounts = new Set(latest.snapshot.accounts.map((row) => row.id));
    results.set(item, {
      ...latest,
      latestPeriod: latest.snapshot.period,
      snapshot: {
        ...latest.snapshot,
        accounts: [...accounts.values()],
        previousAccountIds: [...accounts.keys()].filter((id) => !currentAccounts.has(id)),
        transactions: [...movements.values()],
        period: { start: firstDay, end: lastDay },
      },
    });
  }
  return results;
}
