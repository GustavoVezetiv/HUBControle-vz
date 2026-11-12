import { createClient } from "@supabase/supabase-js";

import {
  ACCESS_TTL_SECONDS,
  CODE_TTL_SECONDS,
  FLOW_TTL_SECONDS,
  REFRESH_TTL_SECONDS,
  getMcpResource,
  getMcpIssuer,
} from "@/features/mcp/oauth/constants";
import { randomSecret, safeEqual, sha256, sha256Hex } from "@/features/mcp/oauth/crypto";
import type { AuthorizationRequest } from "@/features/mcp/oauth/policy";
import { validateChatGptClientMetadata, verifyPkce } from "@/features/mcp/oauth/policy";
import {
  claimOAuthRecord,
  createOAuthRecord,
  createOAuthRecords,
  finishOAuthRecord,
  readOAuthRecord,
  releaseOAuthRecord,
  replaceOAuthRecord,
  revokeOAuthGrant,
  revokeOAuthToken,
} from "@/features/mcp/oauth/store";
import { getSupabaseConfig } from "@/lib/supabase/config";

export type OAuthIdentitySession = {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

type OAuthFlow = {
  pending: AuthorizationRequest;
  phase: "login" | "consent";
  csrf: string;
  bindingHash: string;
  session?: OAuthIdentitySession;
};

type OAuthCode = {
  pending: AuthorizationRequest;
  session: OAuthIdentitySession;
};

type OAuthAccess = {
  grantId: string;
  clientId: string;
  resource: string;
  scope: string;
  session: OAuthIdentitySession;
};

type OAuthRefresh = OAuthAccess;

const nowSeconds = () => Math.floor(Date.now() / 1000);
const future = (seconds: number) => new Date(Date.now() + seconds * 1000);

function userAuthClient() {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Supabase não configurado.");
  return createClient(config.url, config.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function validOpaque(value: string, prefix: string) {
  return new RegExp(`^${prefix}[A-Za-z0-9_-]{43}$`).test(value);
}

function flowCookieName(flowId: string) {
  return `hub_mcp_${sha256Hex(flowId).slice(0, 20)}`;
}

function toIdentity(session: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; email?: string; is_anonymous?: boolean; factors?: Array<{ status: string }> };
}): OAuthIdentitySession {
  if (!session.user.email || session.user.is_anonymous || session.user.factors?.some((factor) => factor.status === "verified")) {
    throw new Error("Conta incompatível com este fluxo OAuth.");
  }
  return {
    userId: session.user.id,
    email: session.user.email,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: nowSeconds() + session.expires_in,
  };
}

async function verifiedFlow(flowId: string, cookieValue: string | undefined) {
  if (!validOpaque(flowId, "mcp_fl_") || !cookieValue) return null;
  const flow = await readOAuthRecord<OAuthFlow>("flow", flowId);
  if (!flow || !safeEqual(flow.bindingHash, sha256(cookieValue))) return null;
  return flow;
}

export async function beginOAuthAuthorization(pending: AuthorizationRequest) {
  if (!(await validateChatGptClientMetadata())) throw new Error("Metadados do cliente ChatGPT inválidos.");
  const flowId = randomSecret("mcp_fl_");
  const cookieValue = randomSecret();
  const flow: OAuthFlow = {
    pending,
    phase: "login",
    csrf: randomSecret(),
    bindingHash: sha256(cookieValue),
  };
  await createOAuthRecord("flow", flowId, flow, future(FLOW_TTL_SECONDS));
  return { flowId, cookieName: flowCookieName(flowId), cookieValue };
}

export async function getOAuthConnectView(flowId: string, cookieValue: string | undefined) {
  const flow = await verifiedFlow(flowId, cookieValue);
  if (!flow) return null;
  return {
    phase: flow.phase,
    csrf: flow.csrf,
    email: flow.session?.email,
    scope: flow.pending.scope,
    resource: flow.pending.resource,
  };
}

export async function loginOAuthFlow(input: {
  flowId: string;
  cookieValue?: string;
  csrf: string;
  email: string;
  password: string;
}) {
  const flow = await verifiedFlow(input.flowId, input.cookieValue);
  if (!flow || flow.phase !== "login" || !safeEqual(flow.csrf, input.csrf)) return false;
  const auth = userAuthClient();
  const result = await auth.auth.signInWithPassword({ email: input.email, password: input.password });
  if (result.error || !result.data.session) return false;
  const identity = toIdentity(result.data.session);
  flow.phase = "consent";
  flow.session = identity;
  flow.csrf = randomSecret();
  await replaceOAuthRecord("flow", input.flowId, flow, future(FLOW_TTL_SECONDS));
  return true;
}

export async function decideOAuthFlow(input: {
  flowId: string;
  cookieValue?: string;
  csrf: string;
  decision: "approve" | "deny";
}) {
  const flow = await verifiedFlow(input.flowId, input.cookieValue);
  if (!flow || flow.phase !== "consent" || !flow.session || !safeEqual(flow.csrf, input.csrf)) return null;
  const callback = new URL(flow.pending.redirectUri);
  callback.searchParams.set("state", flow.pending.state);
  callback.searchParams.set("iss", getMcpIssuer());
  if (input.decision === "deny") {
    callback.searchParams.set("error", "access_denied");
    await finishOAuthRecord("flow", input.flowId, "consumed");
    return callback.toString();
  }
  const code = randomSecret("mcp_cd_");
  await createOAuthRecord("code", code, { pending: flow.pending, session: flow.session } satisfies OAuthCode, future(CODE_TTL_SECONDS));
  await finishOAuthRecord("flow", input.flowId, "consumed");
  callback.searchParams.set("code", code);
  return callback.toString();
}

async function issueTokens(payload: OAuthAccess) {
  const accessToken = randomSecret("mcp_at_");
  const refreshToken = randomSecret("mcp_rt_");
  await createOAuthRecords([
    { kind: "access", secret: accessToken, payload, expiresAt: future(ACCESS_TTL_SECONDS) },
    { kind: "refresh", secret: refreshToken, payload, expiresAt: future(REFRESH_TTL_SECONDS) },
  ]);
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: payload.scope,
  };
}

export async function exchangeAuthorizationCode(input: {
  code: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
  resource: string;
}) {
  if (!validOpaque(input.code, "mcp_cd_")) return null;
  const code = await claimOAuthRecord<OAuthCode>("code", input.code);
  if (!code) return null;
  const valid = code.pending.clientId === input.clientId &&
    code.pending.redirectUri === input.redirectUri && code.pending.resource === input.resource &&
    verifyPkce(input.codeVerifier, code.pending.codeChallenge);
  if (!valid) {
    await finishOAuthRecord("code", input.code, "revoked");
    return null;
  }
  try {
    const tokens = await issueTokens({
      grantId: crypto.randomUUID(),
      clientId: code.pending.clientId,
      resource: code.pending.resource,
      scope: code.pending.scope,
      session: code.session,
    });
    await finishOAuthRecord("code", input.code, "consumed");
    return tokens;
  } catch (error) {
    await releaseOAuthRecord("code", input.code);
    throw error;
  }
}

export async function exchangeRefreshToken(input: {
  refreshToken: string;
  clientId: string;
  resource: string;
}) {
  if (!validOpaque(input.refreshToken, "mcp_rt_")) return null;
  const record = await claimOAuthRecord<OAuthRefresh>("refresh", input.refreshToken);
  if (!record) return null;
  if (record.clientId !== input.clientId || record.resource !== input.resource) {
    await finishOAuthRecord("refresh", input.refreshToken, "revoked");
    return null;
  }
  try {
    const result = await userAuthClient().auth.refreshSession({ refresh_token: record.session.refreshToken });
    if (result.error || !result.data.session) throw new Error("Sessão Supabase não pôde ser renovada.");
    const tokens = await issueTokens({ ...record, session: toIdentity(result.data.session) });
    await finishOAuthRecord("refresh", input.refreshToken, "consumed");
    return tokens;
  } catch (error) {
    await releaseOAuthRecord("refresh", input.refreshToken);
    throw error;
  }
}

export async function authenticateMcpAccessToken(token: string) {
  if (!validOpaque(token, "mcp_at_")) return null;
  const record = await readOAuthRecord<OAuthAccess>("access", token);
  if (!record || record.resource !== getMcpResource()) return null;
  const auth = userAuthClient();
  const result = await auth.auth.getUser(record.session.accessToken);
  if (result.error || !result.data.user || result.data.user.id !== record.session.userId) return null;
  return record;
}

export async function revokeMcpOAuthToken(token: string, clientId: string) {
  if (!validOpaque(token, "mcp_at_") && !validOpaque(token, "mcp_rt_")) return;
  const kind = validOpaque(token, "mcp_at_") ? "access" : "refresh";
  const record = await readOAuthRecord<OAuthAccess>(kind, token);
  if (!record || record.clientId !== clientId) return;
  if (record.grantId) await revokeOAuthGrant(record.grantId);
  else await revokeOAuthToken(token);
}

export function oauthCookieName(flowId: string) {
  return flowCookieName(flowId);
}
