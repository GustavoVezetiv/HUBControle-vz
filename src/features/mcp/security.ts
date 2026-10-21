import { createHmac, timingSafeEqual } from "node:crypto";

export function extractBearerToken(authorization: string | null) {
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1].trim() || null;
}

export function isAllowedMcpOrigin(origin: string | null, siteUrl: string, extraOrigins?: string) {
  if (!origin) return true;
  const allowed = new Set([
    new URL(siteUrl).origin,
    ...(extraOrigins ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  ]);
  return allowed.has(origin);
}

export function isMcpEnabled() {
  return process.env.MCP_ENABLED === "true" && process.env.MCP_OAUTH_READY === "true";
}

export function areMcpWritesEnabled() {
  return isMcpEnabled() && process.env.MCP_ENABLE_WRITES === "true" && process.env.MCP_DIRECT_WRITES_READY === "true";
}

export function isAllowedOAuthClient(clientId: unknown, allowlist: string | undefined) {
  if (typeof clientId !== "string" || !clientId.trim()) return false;
  return (allowlist ?? "").split(",").map((id) => id.trim()).filter(Boolean).includes(clientId);
}

export function isAuthorizedMcpToken(claims: Record<string, unknown> | null, userId: string, issuer: string, resource: string, allowlist: string | undefined, nowSeconds = Math.floor(Date.now() / 1000)) {
  const audiences = Array.isArray(claims?.aud) ? claims.aud : [claims?.aud];
  return claims?.iss === issuer && audiences.includes(resource) && claims.sub === userId &&
    typeof claims.exp === "number" && claims.exp > nowSeconds &&
    isAllowedOAuthClient(claims.client_id, allowlist);
}

export function isExecutableMcpIntent(status: string, expiresAt: string, now = Date.now()) {
  const expiry = Date.parse(expiresAt);
  return status === "pending" && Number.isFinite(expiry) && expiry > now;
}

export type McpIntent = {
  id: string;
  userId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  expiresAt: string;
};

export function signMcpIntent(intent: McpIntent, secret: string) {
  return createHmac("sha256", secret).update(canonicalJson([
    intent.id, intent.userId, intent.toolName, intent.arguments, new Date(intent.expiresAt).toISOString(),
  ])).digest("hex");
}

export function verifyMcpIntent(intent: McpIntent, signature: unknown, secret: string) {
  if (typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = Buffer.from(signMcpIntent(intent, secret), "hex");
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

export function canDecideMcpProposal(
  proposal: McpIntent & { status: string; signature: string },
  actingUserId: string,
  secret: string,
  now = Date.now(),
) {
  return proposal.userId === actingUserId &&
    ["hub_create_planned_purchase", "hub_update_planned_purchase", "hub_create_goal", "hub_update_goal"].includes(proposal.toolName) &&
    isExecutableMcpIntent(proposal.status, proposal.expiresAt, now) &&
    verifyMcpIntent(proposal, proposal.signature, secret);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
