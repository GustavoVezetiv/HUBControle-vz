import "server-only";
import { randomUUID } from "node:crypto";
import {
  remoteSnapshotStorage,
  usesRemoteImportBackups,
} from "../imports/backup-storage";
import type { Institution } from "./types";

export type SyncResult = {
  institution: Institution;
  status: "not_configured" | "recent" | "read" | "error";
  startedAt: string;
  finishedAt: string;
  error?: string;
};
export type SyncReport = {
  startedAt: string;
  finishedAt: string;
  results: SyncResult[];
  financialWrites: 0;
};

export async function preserveSyncReport(owner: string, report: SyncReport) {
  if (!usesRemoteImportBackups()) return false;
  const id = `${report.finishedAt.replace(/[:.]/g, "-")}-${randomUUID()}`;
  await (
    await remoteSnapshotStorage("pluggy-sync", owner)
  ).write(id, JSON.stringify(report));
  return true;
}

export async function lastSyncReport(owner: string): Promise<SyncReport | null> {
  if (!usesRemoteImportBackups()) return null;
  const store = await remoteSnapshotStorage("pluggy-sync", owner);
  const id = (await store.list()).sort().at(-1);
  if (!id) return null;
  return JSON.parse(await store.read(id)) as SyncReport;
}
