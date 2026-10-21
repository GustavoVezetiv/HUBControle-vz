import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

function encryptionKey() {
  const value = process.env.MCP_OAUTH_ENCRYPTION_KEY?.trim();
  if (!value) throw new Error("MCP OAuth encryption key ausente.");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== 32) throw new Error("MCP_OAUTH_ENCRYPTION_KEY deve ter 32 bytes em base64url.");
  return decoded;
}

export function randomSecret(prefix = "") {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

export function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

export function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function sealOAuthValue(value: unknown, binding: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(binding, "utf8"));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function openOAuthValue<T>(sealed: string, binding: string): T {
  const [ivValue, tagValue, dataValue, extra] = sealed.split(".");
  if (!ivValue || !tagValue || !dataValue || extra) throw new Error("Registro OAuth inválido.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAAD(Buffer.from(binding, "utf8"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(dataValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plain) as T;
}
