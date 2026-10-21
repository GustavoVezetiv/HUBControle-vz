export const CHATGPT_CLIENT_ID = "https://chatgpt.com/oauth/client.json";
export const CHATGPT_REDIRECT_URI = "https://chatgpt.com/connector_platform_oauth_redirect";
export const MCP_READ_SCOPE = "mcp:read";
export const MCP_WRITE_SCOPE = "mcp:write";
export const OFFLINE_ACCESS_SCOPE = "offline_access";

export const FLOW_TTL_SECONDS = 10 * 60;
export const CODE_TTL_SECONDS = 90;
export const ACCESS_TTL_SECONDS = 5 * 60;
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

export function getMcpResource() {
  const configured = process.env.MCP_PUBLIC_URL?.trim();
  const resource = configured || `${getMcpSiteUrl()}/api/mcp`;
  const parsed = new URL(resource);
  if (parsed.pathname !== "/api/mcp" || parsed.search || parsed.hash) {
    throw new Error("MCP_PUBLIC_URL deve terminar exatamente em /api/mcp.");
  }
  return parsed.toString();
}

export function canonicalizeMcpResource(value: string) {
  let candidate: URL;
  try {
    candidate = new URL(value);
  } catch {
    return null;
  }

  const expected = new URL(getMcpResource());
  const isExpectedPath = candidate.pathname === expected.pathname ||
    candidate.pathname === `${expected.pathname}/`;
  if (
    candidate.origin !== expected.origin ||
    !isExpectedPath ||
    candidate.username ||
    candidate.password ||
    candidate.search ||
    candidate.hash
  ) {
    return null;
  }

  return expected.toString();
}

export function describeMcpResource(value: string | null) {
  if (!value) return "<ausente>";
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`.slice(0, 256);
  } catch {
    return "<uri-invalida>";
  }
}

export function getMcpIssuer() {
  return new URL(getMcpResource()).origin;
}

export function getMcpScopes() {
  const writesEnabled = process.env.MCP_ENABLED === "true" &&
    process.env.MCP_OAUTH_READY === "true" &&
    process.env.MCP_ENABLE_WRITES === "true" &&
    process.env.MCP_DIRECT_WRITES_READY === "true";

  return writesEnabled
    ? [MCP_READ_SCOPE, OFFLINE_ACCESS_SCOPE, MCP_WRITE_SCOPE]
    : [MCP_READ_SCOPE, OFFLINE_ACCESS_SCOPE];
}

function getMcpSiteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_VERCEL_URL;
  const normalized = configured?.trim().replace(/\/+$/, "");

  if (!normalized) {
    return "http://localhost:3000";
  }

  return /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
}
