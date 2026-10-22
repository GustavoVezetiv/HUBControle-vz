import { createClient as createSupabaseClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import { getSiteUrl, getSupabaseConfig } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/types";
import { getMcpIssuer, getMcpResource, getMcpScopes } from "@/features/mcp/oauth/constants";
import { authenticateMcpAccessToken } from "@/features/mcp/oauth/service";
import { extractBearerToken, isAllowedMcpOrigin as isAllowedOrigin } from "@/features/mcp/security";

export type McpAuthContext = {
  user: User;
  client: SupabaseClient<Database>;
  scopes: string[];
};

export async function getMcpAuthContext(request: Request): Promise<McpAuthContext | { error: string; status: number }> {
  const config = getSupabaseConfig();
  if (!config) return { error: "Supabase não está configurado.", status: 500 };

  const authorization = request.headers.get("authorization");
  const accessToken = extractBearerToken(authorization);
  if (!accessToken) {
    return { error: "Autenticação obrigatória. Conecte sua conta Hub VZ.", status: 401 };
  }

  const oauth = await authenticateMcpAccessToken(accessToken);
  if (!oauth || oauth.resource !== getMcpResource()) {
    return { error: "Token OAuth inválido, expirado ou destinado a outro recurso.", status: 401 };
  }

  const client = createSupabaseClient<Database>(config.url, config.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${oauth.session.accessToken}` } },
  }) as SupabaseClient<Database>;
  const { data, error } = await client.auth.getUser(oauth.session.accessToken);
  if (error || !data.user) {
    console.error("[hub-mcp] Authentication failed", error?.message);
    return { error: "Token de acesso inválido ou expirado.", status: 401 };
  }

  if (data.user.id !== oauth.session.userId) return { error: "Sessão OAuth inconsistente.", status: 401 };
  return { user: data.user, client, scopes: oauth.scope.split(/\s+/).filter(Boolean) };
}

export function isAllowedMcpOrigin(request: Request) {
  return isAllowedOrigin(request.headers.get("origin"), getSiteUrl(), process.env.MCP_ALLOWED_ORIGINS);
}

export function mcpAuthenticateHeader() {
  const metadataUrl = `${getMcpIssuer()}/.well-known/oauth-protected-resource/api/mcp`;
  const scope = getMcpScopes().filter((item) => item !== "offline_access").join(" ");
  return `Bearer resource_metadata="${metadataUrl}", scope="${scope}", error="invalid_token", error_description="Conecte sua conta Hub VZ para usar o MCP"`;
}
