export const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;

export function isSupportedMcpProtocolVersion(version: unknown): version is typeof MCP_PROTOCOL_VERSIONS[number] {
  return typeof version === "string" && MCP_PROTOCOL_VERSIONS.some((supported) => supported === version);
}

export function negotiateMcpProtocolVersion(requested: unknown) {
  return isSupportedMcpProtocolVersion(requested) ? requested : MCP_PROTOCOL_VERSIONS[0];
}

export function acceptsMcpProtocolHeader(method: string, version: string | null) {
  // initialize negotiates a version; the header constrains subsequent requests.
  return method === "initialize" || version === null || isSupportedMcpProtocolVersion(version);
}
