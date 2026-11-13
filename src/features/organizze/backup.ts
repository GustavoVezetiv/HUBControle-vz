import "server-only";
import { usesRemoteImportBackups, remoteSnapshotStorage, ImportBackupStorageError } from "../imports/backup-storage";
import { mkdir, readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { validatePeriod, sourceId } from "./extraction";
import { validateTask } from "./client";
import type { Snapshot } from "./types";

const folder = join(process.cwd(), "tmp", "organizze-backups");
const namePattern = /^\d{4}-\d{2}-\d{2}T[\d-]+Z(?:-[a-f0-9-]{36})?$/;
export function validateSnapshot(value: unknown, owner: string): asserts value is Snapshot {
  if (!value || typeof value !== "object") throw new Error("Backup inválido.");
  const s = value as Snapshot;
  if (s.version !== 1 || s.source !== "organizze" || s.ownerId !== owner || !Array.isArray(s.records) || !Array.isArray(s.receipts) || !Array.isArray(s.tasks) || !Array.isArray(s.errors) || !Array.isArray(s.rejected) || s.records.length > 200000 || s.tasks.length > 50000) throw new Error("Backup inválido ou de outro usuário.");
  validatePeriod(s.period);
  const keys = new Set<string>();
  for (const row of s.records) {
    if (!row || !["category", "account", "card", "invoice", "transaction"].includes(row.entity) || !sourceId(row.sourceId) || !row.raw || typeof row.raw !== "object" || !Array.isArray(row.sources) || !row.sources.length || keys.has(row.key) || (row.entity === "invoice" ? !new RegExp(`^invoice:[1-9]\\d*:${row.sourceId}$`).test(row.key) : row.key !== `${row.entity}:${row.sourceId}`)) throw new Error("Registros de origem inválidos.");
    keys.add(row.key);
    for (const origin of row.sources) validateTask(origin.task);
  }
  for (const task of s.tasks) validateTask(task);
  for (const receipt of s.receipts) validateTask(receipt.task);
  for (const unavailable of s.unavailable ?? []) {
    validateTask(unavailable.task);
    if (!["upstream_404", "upstream_405", "upstream_410"].includes(unavailable.code)) throw new Error("Omissão de recurso inválida.");
  }
}
export async function saveOrganizzeBackup(snapshot: Snapshot, owner: string) {
  validateSnapshot(snapshot, owner);
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
  if (usesRemoteImportBackups()) {
    await (await remoteSnapshotStorage("organizze", owner)).write(id, JSON.stringify({ snapshot, selectedKeys: [] }));
    return id;
  }
  await mkdir(join(folder, id), { recursive: true });
  await writeFile(join(folder, id, "organizze-backup.json"), JSON.stringify({ snapshot, selectedKeys: [] }), { flag: "wx", mode: 0o600 });
  return id;
}
export async function readOrganizzeBackup(id: string, owner: string) {
  if (!namePattern.test(id)) throw new Error("Identificador de backup inválido.");
  const file = join(folder, id, "organizze-backup.json");
  const remote = usesRemoteImportBackups() ? await remoteSnapshotStorage("organizze", owner) : null;
  if (!remote && (await stat(file)).size > 80 * 1024 * 1024) throw new Error("Backup excede 80 MiB.");
  const value = JSON.parse(remote ? await remote.read(id) : await readFile(file, "utf8"));
  validateSnapshot(value.snapshot, owner);
  return value.snapshot as Snapshot;
}
export async function latestOrganizzeBackup(owner: string) {
  const remote = usesRemoteImportBackups() ? await remoteSnapshotStorage("organizze", owner) : null;
  const names = remote ? await remote.list() : await readdir(folder).catch(() => [] as string[]);
  for (const id of names.filter(name => namePattern.test(name)).sort().reverse()) {
    try { return { backupId: id, snapshot: await readOrganizzeBackup(id, owner) }; } catch (error) { if (error instanceof ImportBackupStorageError) throw error; /* Other owner, incomplete write or invalid backup: do not expose it. */ }
  }
  return null;
}
