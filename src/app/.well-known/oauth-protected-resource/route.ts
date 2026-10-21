import { NextResponse } from "next/server";

import { getMcpIssuer, getMcpResource, getMcpScopes } from "@/features/mcp/oauth/constants";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    resource: getMcpResource(),
    authorization_servers: [getMcpIssuer()],
    bearer_methods_supported: ["header"],
    scopes_supported: getMcpScopes(),
  }, { headers: { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" } });
}
