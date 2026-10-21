import { createClient } from "@supabase/supabase-js";

import { getSupabaseConfig } from "@/lib/supabase/config";
import { openOAuthValue, sealOAuthValue, sha256Hex } from "@/features/mcp/oauth/crypto";

export type OAuthRecordKind = "flow" | "code" | "access" | "refresh";
type OAuthRecordStatus = "active" | "processing" | "consumed" | "revoked";

type StoredOAuthRecord = {
  key_hash: string;
  kind: OAuthRecordKind;
  sealed_payload: string;
  status: OAuthRecordStatus;
  expires_at: string;
  processing_started_at: string | null;
};

function adminClient() {
  const config = getSupabaseConfig();
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!config || !serviceRole) throw new Error("Armazenamento OAuth não configurado.");
  return createClient(config.url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function binding(kind: OAuthRecordKind, keyHash: string) {
  return `hub-vz-mcp-oauth:${kind}:${keyHash}`;
}

function active(record: StoredOAuthRecord | null | undefined) {
  return record?.status === "active" && Date.parse(record.expires_at) > Date.now();
}

export async function createOAuthRecord(
  kind: OAuthRecordKind,
  secret: string,
  payload: unknown,
  expiresAt: Date,
) {
  const keyHash = sha256Hex(secret);
  const result = await adminClient().from("mcp_oauth_records").insert({
    key_hash: keyHash,
    kind,
    sealed_payload: sealOAuthValue(payload, binding(kind, keyHash)),
    status: "active",
    expires_at: expiresAt.toISOString(),
  });
  if (result.error) throw new Error("Não foi possível persistir o estado OAuth.");
}

export async function createOAuthRecords(
  records: Array<{ kind: OAuthRecordKind; secret: string; payload: unknown; expiresAt: Date }>,
) {
  const rows = records.map((record) => {
    const keyHash = sha256Hex(record.secret);
    return {
      key_hash: keyHash,
      kind: record.kind,
      sealed_payload: sealOAuthValue(record.payload, binding(record.kind, keyHash)),
      status: "active" as const,
      expires_at: record.expiresAt.toISOString(),
    };
  });
  const result = await adminClient().from("mcp_oauth_records").insert(rows);
  if (result.error) throw new Error("Não foi possível emitir credenciais OAuth.");
}

export async function readOAuthRecord<T>(kind: OAuthRecordKind, secret: string): Promise<T | null> {
  const keyHash = sha256Hex(secret);
  const result = await adminClient().from("mcp_oauth_records")
    .select("key_hash,kind,sealed_payload,status,expires_at,processing_started_at")
    .eq("key_hash", keyHash).eq("kind", kind).maybeSingle();
  const record = result.data as StoredOAuthRecord | null;
  if (result.error || !record || !active(record)) return null;
  try {
    return openOAuthValue<T>(record.sealed_payload, binding(kind, keyHash));
  } catch {
    return null;
  }
}

export async function replaceOAuthRecord(
  kind: OAuthRecordKind,
  secret: string,
  payload: unknown,
  expiresAt: Date,
) {
  const keyHash = sha256Hex(secret);
  const result = await adminClient().from("mcp_oauth_records").update({
    sealed_payload: sealOAuthValue(payload, binding(kind, keyHash)),
    expires_at: expiresAt.toISOString(),
    status: "active",
    processing_started_at: null,
  }).eq("key_hash", keyHash).eq("kind", kind).eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .select("key_hash")
    .maybeSingle();
  if (result.error || !result.data) throw new Error("Não foi possível atualizar o estado OAuth.");
}

export async function claimOAuthRecord<T>(kind: OAuthRecordKind, secret: string): Promise<T | null> {
  const keyHash = sha256Hex(secret);
  const result = await adminClient().from("mcp_oauth_records").update({
    status: "processing",
    processing_started_at: new Date().toISOString(),
  }).eq("key_hash", keyHash).eq("kind", kind).eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .select("key_hash,kind,sealed_payload,status,expires_at,processing_started_at")
    .maybeSingle();
  const record = result.data as StoredOAuthRecord | null;
  if (result.error || !record || record.status !== "processing") return null;
  try {
    return openOAuthValue<T>(record.sealed_payload, binding(kind, keyHash));
  } catch {
    await finishOAuthRecord(kind, secret, "revoked");
    return null;
  }
}

export async function finishOAuthRecord(
  kind: OAuthRecordKind,
  secret: string,
  status: Extract<OAuthRecordStatus, "consumed" | "revoked">,
) {
  const result = await adminClient().from("mcp_oauth_records").update({
    status,
    processing_started_at: null,
  }).eq("key_hash", sha256Hex(secret)).eq("kind", kind).in("status", ["active", "processing"]);
  if (result.error) throw new Error("Não foi possível finalizar o registro OAuth.");
}

export async function releaseOAuthRecord(kind: OAuthRecordKind, secret: string) {
  const result = await adminClient().from("mcp_oauth_records").update({
    status: "active",
    processing_started_at: null,
  }).eq("key_hash", sha256Hex(secret)).eq("kind", kind).eq("status", "processing");
  if (result.error) throw new Error("Não foi possível liberar o registro OAuth.");
}

export async function revokeOAuthToken(secret: string) {
  const keyHash = sha256Hex(secret);
  const result = await adminClient().from("mcp_oauth_records").update({
    status: "revoked",
    processing_started_at: null,
  }).eq("key_hash", keyHash).in("kind", ["access", "refresh"]);
  if (result.error) throw new Error("Não foi possível revogar o token OAuth.");
}

export async function revokeOAuthGrant(grantId: string) {
  const admin = adminClient();
  const records = await admin.from("mcp_oauth_records")
    .select("key_hash,kind,sealed_payload,status,expires_at,processing_started_at")
    .in("kind", ["access", "refresh"])
    .in("status", ["active", "processing"]);
  if (records.error) throw new Error("Não foi possível localizar a concessão OAuth.");

  const matchingHashes = ((records.data ?? []) as StoredOAuthRecord[]).flatMap((record) => {
    try {
      const payload = openOAuthValue<{ grantId?: string }>(
        record.sealed_payload,
        binding(record.kind, record.key_hash),
      );
      return payload.grantId === grantId ? [record.key_hash] : [];
    } catch {
      return [];
    }
  });
  if (!matchingHashes.length) return;

  const result = await admin.from("mcp_oauth_records").update({
    status: "revoked",
    processing_started_at: null,
  }).in("key_hash", matchingHashes).in("kind", ["access", "refresh"])
    .in("status", ["active", "processing"]);
  if (result.error) throw new Error("Não foi possível revogar a concessão OAuth.");
}
