"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { canDecideMcpProposal } from "@/features/mcp/security";
import { getMcpActionRequest } from "@/features/mcp/admin";
import { createClient } from "@/lib/supabase/server";

const approvalsPath = "/dashboard/mcp-approvals";

export async function decideMcpProposal(formData: FormData) {
  const supabase = await createClient();
  if (!supabase) redirect("/login");

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const id = formData.get("id");
  const decision = formData.get("decision");
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) || !["approve", "reject"].includes(String(decision))) {
    redirect(`${approvalsPath}?notice=invalid`);
  }

  const secret = process.env.MCP_CONFIRMATION_SECRET?.trim();
  if (!secret || secret.length < 32) redirect(`${approvalsPath}?notice=unavailable`);

  const { data: proposal, error } = await getMcpActionRequest(user.id, id);
  if (error || !proposal || !canDecideMcpProposal({
    id: proposal.id,
    userId: proposal.user_id,
    toolName: proposal.tool_name,
    arguments: proposal.arguments as Record<string, unknown>,
    expiresAt: proposal.expires_at,
    signature: proposal.intent_signature,
    status: proposal.status,
  }, user.id, secret)) {
    redirect(`${approvalsPath}?notice=invalid`);
  }

  const { error: operationError } = await supabase.rpc("mcp_decide_planning_action", {
    p_request_id: id,
    p_intent_signature: proposal.intent_signature,
    p_decision: decision as string,
  });
  if (operationError) {
    console.error("[hub-mcp] Planning proposal decision failed", operationError);
    redirect(`${approvalsPath}?notice=failed`);
  }

  revalidatePath(approvalsPath);
  redirect(`${approvalsPath}?notice=${decision === "approve" ? "approved" : "rejected"}`);
}
