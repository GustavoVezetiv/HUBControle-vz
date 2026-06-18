import crypto from "node:crypto";

import { getSiteUrl } from "@/lib/supabase/config";

const googleTasksReadonlyScope = "https://www.googleapis.com/auth/tasks.readonly";
const tokenEndpoint = "https://oauth2.googleapis.com/token";

export type GoogleTasksOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: string;
};

export type GoogleTokenResponse = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

export function getGoogleTasksOAuthConfig(): GoogleTasksOAuthConfig | null {
  const clientId = process.env.GOOGLE_TASKS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_TASKS_CLIENT_SECRET;
  const encryptionKey = process.env.GOOGLE_TASKS_TOKEN_ENCRYPTION_KEY;

  if (!clientId || !clientSecret || !encryptionKey) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    encryptionKey,
    redirectUri: `${getSiteUrl()}/api/routine/google-tasks/callback`,
  };
}

export function buildGoogleTasksAuthUrl(state: string) {
  const config = getGoogleTasksOAuthConfig();

  if (!config) {
    return { url: null, error: "Configure GOOGLE_TASKS_CLIENT_ID, GOOGLE_TASKS_CLIENT_SECRET e GOOGLE_TASKS_TOKEN_ENCRYPTION_KEY." };
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: googleTasksReadonlyScope,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });

  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, error: null };
}

export async function exchangeGoogleTasksCode(code: string): Promise<{ data: GoogleTokenResponse | null; error: string | null }> {
  const config = getGoogleTasksOAuthConfig();
  if (!config) return { data: null, error: "Configuração do Google Tasks ausente." };

  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    console.error("Erro técnico ao trocar código OAuth do Google Tasks:", payload);
    return { data: null, error: "Não foi possível conectar o Google Tasks." };
  }

  return { data: payload as GoogleTokenResponse, error: null };
}

export async function refreshGoogleTasksAccessToken(refreshToken: string): Promise<{ data: GoogleTokenResponse | null; error: string | null }> {
  const config = getGoogleTasksOAuthConfig();
  if (!config) return { data: null, error: "Configuração do Google Tasks ausente." };

  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    console.error("Erro técnico ao renovar token do Google Tasks:", payload);
    return { data: null, error: "Não foi possível renovar a conexão com o Google Tasks." };
  }

  return { data: payload as GoogleTokenResponse, error: null };
}

export function getGoogleTasksReadonlyScope() {
  return googleTasksReadonlyScope;
}

export function encryptToken(value: string) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptToken(value: string) {
  const key = getEncryptionKey();
  const [ivValue, tagValue, encryptedValue] = value.split(".");

  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error("Token criptografado inválido.");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

export function tokenExpiresAt(expiresInSeconds: number | undefined) {
  const date = new Date();
  date.setSeconds(date.getSeconds() + Number(expiresInSeconds ?? 3600));
  return date.toISOString();
}

function getEncryptionKey() {
  const value = process.env.GOOGLE_TASKS_TOKEN_ENCRYPTION_KEY;
  if (!value) throw new Error("GOOGLE_TASKS_TOKEN_ENCRYPTION_KEY não configurada.");

  if (/^[a-f0-9]{64}$/i.test(value)) {
    return Buffer.from(value, "hex");
  }

  return crypto.createHash("sha256").update(value).digest();
}
