import { NextResponse } from "next/server";

import { authorizationServerMetadata } from "@/features/mcp/oauth/policy";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(authorizationServerMetadata(), {
    headers: { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" },
  });
}
