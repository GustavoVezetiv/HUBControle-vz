import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getSupabaseConfig } from "@/lib/supabase/config";
import type { Database, Json, McpActionRequest } from "@/lib/supabase/types";

type ProposalInsert = {
  id: string;
  user_id: string;
  tool_name: string;
  arguments: Json;
  expires_at: string;
  intent_signature: string;
};

function createMcpAdminClient() {
  const config = getSupabaseConfig();
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!config || !serviceRole) {
    throw new Error("Armazenamento seguro do MCP não configurado.");
  }

  return createClient<Database>(config.url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export async function createMcpActionRequest(input: ProposalInsert) {
  const result = await createMcpAdminClient()
    .from("mcp_action_requests")
    .insert(input)
    .select("id,expires_at")
    .single();

  if (result.error || !result.data) {
    console.error("[hub-mcp] Failed to persist proposal", result.error);
    throw new Error("Não foi possível preparar a confirmação. Verifique a migration MCP.");
  }

  return result.data;
}

export async function listMcpActionRequests(userId: string, limit = 30) {
  const result = await createMcpAdminClient()
    .from("mcp_action_requests")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return {
    data: (result.data ?? []) as McpActionRequest[],
    error: result.error,
  };
}

export async function getMcpActionRequest(userId: string, id: string) {
  const result = await createMcpAdminClient()
    .from("mcp_action_requests")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  return {
    data: result.data as McpActionRequest | null,
    error: result.error,
  };
}

export async function getMcpActionRequestStatus(userId: string, id: string) {
  const result = await createMcpAdminClient()
    .from("mcp_action_requests")
    .select("id,tool_name,status,result,error_message,expires_at,created_at,completed_at,approved_at,rejected_at")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  return { data: result.data, error: result.error };
}

export async function executeMcpDirectWrite(input: {
  userId: string;
  idempotencyKey: string;
  toolName: string;
  arguments: Json;
}) {
  const result = await createMcpAdminClient().rpc("mcp_execute_direct_write_v2", {
    p_user_id: input.userId,
    p_idempotency_key: input.idempotencyKey,
    p_tool_name: input.toolName,
    p_arguments: input.arguments,
  });

  return { data: result.data, error: result.error };
}
