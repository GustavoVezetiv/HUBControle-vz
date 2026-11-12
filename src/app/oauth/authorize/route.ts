import { NextResponse } from "next/server";

import { describeMcpResource, getMcpResource } from "@/features/mcp/oauth/constants";
import { beginOAuthAuthorization } from "@/features/mcp/oauth/service";
import { parseAuthorizationRequest } from "@/features/mcp/oauth/policy";
import { isMcpEnabled } from "@/features/mcp/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isMcpEnabled()) return NextResponse.json({ error: "temporarily_unavailable" }, { status: 503 });
  try {
    const requestUrl = new URL(request.url);
    const pending = parseAuthorizationRequest(requestUrl);
    const requestedResource = requestUrl.searchParams.get("resource");
    if (requestedResource !== pending.resource) {
      console.info("[hub-mcp-oauth] Resource canonicalized", {
        requestedResource: describeMcpResource(requestedResource),
        canonicalResource: pending.resource,
      });
    }
    const flow = await beginOAuthAuthorization(pending);
    const response = NextResponse.redirect(new URL(`/oauth/connect?flow=${encodeURIComponent(flow.flowId)}`, request.url));
    response.cookies.set(flow.cookieName, flow.cookieValue, {
      httpOnly: true,
      secure: new URL(request.url).protocol === "https:",
      sameSite: "lax",
      path: "/oauth",
      maxAge: 10 * 60,
    });
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    const resourceValues = new URL(request.url).searchParams.getAll("resource");
    console.error("[hub-mcp-oauth] Authorization request rejected", {
      message: error instanceof Error ? error.message : "Erro desconhecido.",
      resourceCount: resourceValues.length,
      requestedResource: describeMcpResource(resourceValues[0] ?? null),
      expectedResource: getMcpResource(),
    });
    return NextResponse.json({ error: "invalid_request", error_description: "Solicitação OAuth inválida." }, {
      status: 400,
      headers: { "cache-control": "no-store" },
    });
  }
}
