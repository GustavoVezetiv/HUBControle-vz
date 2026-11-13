import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const IMPORT_BACKUP_BUCKET = "hub-import-backups";
const MAX_BYTES = 80 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const BACKUP_ID = /^\d{4}-\d{2}-\d{2}T[\d-]+Z(?:-[a-f0-9-]{36})?$/;
type Source = "pluggy" | "organizze";

export class ImportBackupStorageError extends Error {}

export function usesRemoteImportBackups() {
  return process.env.VERCEL === "1" || process.env.IMPORT_BACKUP_STORAGE === "supabase";
}

// No public URLs or browser credentials: callers authenticate the owner before
// reaching this server-only store. Each object also contains its validated owner.
export function createSnapshotStorage(
  client: Pick<SupabaseClient, "storage">,
  source: Source,
  owner: string,
) {
  if (!UUID.test(owner) || !["pluggy", "organizze"].includes(source))
    throw new ImportBackupStorageError("Proprietário ou origem de backup inválido.");
  const prefix = `${owner}/${source}`;
  const bucket = client.storage.from(IMPORT_BACKUP_BUCKET);
  async function privateBucket() {
    let { data, error } = await client.storage.getBucket(IMPORT_BACKUP_BUCKET);
    if (String(error?.statusCode) === "404") {
      await client.storage.createBucket(IMPORT_BACKUP_BUCKET, {
        public: false, allowedMimeTypes: ["application/json"], fileSizeLimit: 50 * 1024 * 1024,
      });
      ({ data, error } = await client.storage.getBucket(IMPORT_BACKUP_BUCKET));
    }
    if (error || !data || data.public)
      throw new ImportBackupStorageError("Armazenamento privado de importações indisponível.");
  }
  function path(id: string) {
    if (!BACKUP_ID.test(id)) throw new ImportBackupStorageError("Backup inválido.");
    return `${prefix}/${id}/${source}-backup.json`;
  }
  return {
    async list() {
      await privateBucket();
      const names: string[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await bucket.list(prefix, {
          limit: 1000, offset, sortBy: { column: "name", order: "asc" },
        });
        if (error || !data) throw new ImportBackupStorageError("Falha ao listar históricos de importação.");
        names.push(...data.map((row) => row.name).filter((name) => BACKUP_ID.test(name)));
        if (data.length < 1000) return names;
      }
    },
    async read(id: string) {
      const file = path(id);
      await privateBucket();
      const { data, error } = await bucket.download(file);
      if (error || !data) throw new ImportBackupStorageError("Falha ao ler histórico de importação.");
      if (data.size > MAX_BYTES) throw new ImportBackupStorageError("Backup excede 80 MiB.");
      return data.text();
    },
    async write(id: string, content: string) {
      const file = path(id);
      if (Buffer.byteLength(content) > MAX_BYTES)
        throw new ImportBackupStorageError("Backup excede 80 MiB.");
      await privateBucket();
      const { error } = await bucket.upload(file, Buffer.from(content), {
        contentType: "application/json", upsert: false, cacheControl: "0",
      });
      if (error) throw new ImportBackupStorageError("Falha ao preservar histórico de importação.");
    },
  };
}

export async function remoteSnapshotStorage(source: Source, owner: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ImportBackupStorageError("Armazenamento privado não configurado.");
  const { createClient } = await import("@supabase/supabase-js");
  return createSnapshotStorage(createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }), source, owner);
}
