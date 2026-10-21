"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { isAllowedOAuthClient, isMcpEnabled } from "@/features/mcp/security";

export async function decideOAuthAuthorization(formData: FormData) {
  const authorizationId = typeof formData.get("authorizationId") === "string" ? String(formData.get("authorizationId")) : "";
  const decision = formData.get("decision");
  if (!authorizationId || authorizationId.length > 200 || (decision !== "approve" && decision !== "deny")) {
    redirect("/login");
  }

  const supabase = await createClient();
  const { data: auth } = await supabase?.auth.getUser() ?? { data: { user: null } };
  if (!supabase || !auth.user) redirect(`/login?redirect=${encodeURIComponent(`/oauth/consent?authorization_id=${authorizationId}`)}`);

  const { data: details, error: detailsError } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (detailsError || !details || !("authorization_id" in details) || details.user.id !== auth.user.id ||
      !isMcpEnabled() || !isAllowedOAuthClient(details.client.id, process.env.MCP_ALLOWED_OAUTH_CLIENT_IDS)) {
    redirect("/oauth/consent?error=authorization_failed");
  }

  const result = decision === "approve"
    ? await supabase.auth.oauth.approveAuthorization(authorizationId)
    : await supabase.auth.oauth.denyAuthorization(authorizationId);
  if (result.error || !result.data?.redirect_url) {
    redirect(`/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}&error=authorization_failed`);
  }
  redirect(result.data.redirect_url);
}
