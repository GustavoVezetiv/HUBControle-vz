"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { decideOAuthFlow, loginOAuthFlow, oauthCookieName } from "@/features/mcp/oauth/service";

export async function continueOAuthConnection(formData: FormData) {
  const flowId = text(formData, "flow");
  const csrf = text(formData, "csrf");
  const action = text(formData, "action");
  if (!/^mcp_fl_[A-Za-z0-9_-]{43}$/.test(flowId) || !csrf) redirect("/oauth/connect?error=invalid");
  const cookieStore = await cookies();
  const cookieName = oauthCookieName(flowId);
  const cookieValue = cookieStore.get(cookieName)?.value;

  if (action === "login") {
    const success = await loginOAuthFlow({
      flowId,
      cookieValue,
      csrf,
      email: text(formData, "email"),
      password: text(formData, "password"),
    });
    redirect(`/oauth/connect?flow=${encodeURIComponent(flowId)}${success ? "" : "&error=login"}`);
  }

  if (action === "approve" || action === "deny") {
    const callback = await decideOAuthFlow({
      flowId,
      cookieValue,
      csrf,
      decision: action,
    });
    if (!callback) redirect(`/oauth/connect?flow=${encodeURIComponent(flowId)}&error=invalid`);
    cookieStore.delete(cookieName);
    redirect(callback);
  }
  redirect(`/oauth/connect?flow=${encodeURIComponent(flowId)}&error=invalid`);
}

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
