import { NextResponse } from "next/server";

import { CHATGPT_CLIENT_ID } from "@/features/mcp/oauth/constants";
import { revokeMcpOAuthToken } from "@/features/mcp/oauth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) {
    return NextResponse.json({ error: "invalid_request" }, { status: 415 });
  }
  const text = await request.text();
  if (text.length > 16_384) return NextResponse.json({ error: "invalid_request" }, { status: 413 });
  const params = new URLSearchParams(text);
  for (const key of params.keys()) {
    if (params.getAll(key).length !== 1) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (params.get("client_id") !== CHATGPT_CLIENT_ID) {
    return NextResponse.json({ error: "invalid_client" }, { status: 401 });
  }
  await revokeMcpOAuthToken(params.get("token") ?? "", CHATGPT_CLIENT_ID);
  return new NextResponse(null, { status: 200, headers: { "cache-control": "no-store" } });
}
