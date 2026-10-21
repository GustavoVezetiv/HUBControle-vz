import { NextResponse } from "next/server";

import {
  CHATGPT_CLIENT_ID,
  CHATGPT_REDIRECT_URI,
  canonicalizeMcpResource,
  describeMcpResource,
  getMcpResource,
} from "@/features/mcp/oauth/constants";
import { exchangeAuthorizationCode, exchangeRefreshToken } from "@/features/mcp/oauth/service";
import { isMcpEnabled } from "@/features/mcp/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isMcpEnabled()) return oauthError("temporarily_unavailable", 503);
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) {
    return oauthError("invalid_request", 415);
  }
  try {
    const text = await request.text();
    if (text.length > 16_384) return oauthError("invalid_request", 413);
    const params = new URLSearchParams(text);
    for (const key of params.keys()) if (params.getAll(key).length !== 1) return oauthError("invalid_request", 400);
    const grantType = params.get("grant_type");
    const clientId = params.get("client_id") ?? "";
    const requestedResource = params.get("resource") ?? "";
    if (clientId !== CHATGPT_CLIENT_ID) return oauthError("invalid_client", 401);
    const resource = canonicalizeMcpResource(requestedResource);
    if (!resource) {
      console.error("[hub-mcp-oauth] Token request rejected", {
        reason: "invalid_target",
        requestedResource: describeMcpResource(requestedResource),
        expectedResource: getMcpResource(),
      });
      return oauthError("invalid_target", 400);
    }
    if (requestedResource !== resource) {
      console.info("[hub-mcp-oauth] Token resource canonicalized", {
        requestedResource: describeMcpResource(requestedResource),
        canonicalResource: resource,
      });
    }
    if (grantType === "authorization_code" && params.get("redirect_uri") !== CHATGPT_REDIRECT_URI) {
      return oauthError("invalid_grant", 400);
    }

    const result = grantType === "authorization_code"
      ? await exchangeAuthorizationCode({
          code: params.get("code") ?? "",
          codeVerifier: params.get("code_verifier") ?? "",
          clientId,
          redirectUri: params.get("redirect_uri") ?? "",
          resource,
        })
      : grantType === "refresh_token"
        ? await exchangeRefreshToken({
            refreshToken: params.get("refresh_token") ?? "",
            clientId,
            resource,
          })
        : undefined;
    if (grantType !== "authorization_code" && grantType !== "refresh_token") {
      return oauthError("unsupported_grant_type", 400);
    }
    if (!result) return oauthError("invalid_grant", 400);
    return NextResponse.json(result, { headers: { "cache-control": "no-store", pragma: "no-cache" } });
  } catch (error) {
    console.error("[hub-mcp-oauth] Token exchange failed", error instanceof Error ? error.message : error);
    return oauthError("temporarily_unavailable", 503);
  }
}

function oauthError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "cache-control": "no-store", pragma: "no-cache" } });
}
