import {
  CHATGPT_CLIENT_ID,
  CHATGPT_REDIRECT_URI,
  canonicalizeMcpResource,
  getMcpResource,
  getMcpScopes,
} from "./constants.ts";
import { sha256 } from "./crypto.ts";

export type AuthorizationRequest = {
  clientId: string;
  redirectUri: string;
  state: string;
  resource: string;
  scope: string;
  codeChallenge: string;
};

const verifierPattern = /^[A-Za-z0-9._~-]{43,128}$/;

function single(params: URLSearchParams, name: string) {
  const values = params.getAll(name);
  if (values.length !== 1) throw new Error(`Parâmetro OAuth inválido: ${name}.`);
  return values[0];
}

export function parseAuthorizationRequest(url: URL): AuthorizationRequest {
  const params = url.searchParams;
  const clientId = single(params, "client_id");
  const redirectUri = single(params, "redirect_uri");
  const state = single(params, "state");
  const requestedResource = single(params, "resource");
  const scope = single(params, "scope");
  const codeChallenge = single(params, "code_challenge");
  if (single(params, "response_type") !== "code") throw new Error("response_type não suportado.");
  if (single(params, "code_challenge_method") !== "S256") throw new Error("PKCE S256 obrigatório.");
  if (clientId !== CHATGPT_CLIENT_ID || redirectUri !== CHATGPT_REDIRECT_URI) {
    throw new Error("Cliente OAuth não permitido.");
  }
  const resource = canonicalizeMcpResource(requestedResource);
  if (!resource) throw new Error("Resource OAuth inválido.");
  if (!state || state.length > 1024 || !verifierPattern.test(codeChallenge)) {
    throw new Error("State ou code_challenge inválido.");
  }
  const requestedScopes = scope.split(/\s+/).filter(Boolean);
  const allowedScopes = getMcpScopes();
  if (!requestedScopes.includes("mcp:read") || requestedScopes.some((item) => !allowedScopes.includes(item))) {
    throw new Error("Escopo OAuth não permitido.");
  }
  return { clientId, redirectUri, state, resource, scope: requestedScopes.join(" "), codeChallenge };
}

export function verifyPkce(verifier: string, challenge: string) {
  return verifierPattern.test(verifier) && sha256(verifier) === challenge;
}

export async function validateChatGptClientMetadata(fetcher: typeof fetch = fetch) {
  const response = await fetcher(CHATGPT_CLIENT_ID, {
    redirect: "manual",
    signal: AbortSignal.timeout(5000),
    headers: { accept: "application/json" },
  });
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return false;
  const text = await response.text();
  if (text.length > 16_384) return false;
  const data = JSON.parse(text) as Record<string, unknown>;
  const methods = data.token_endpoint_auth_methods_supported ?? [data.token_endpoint_auth_method];
  return data.client_id === CHATGPT_CLIENT_ID &&
    Array.isArray(data.redirect_uris) && data.redirect_uris.includes(CHATGPT_REDIRECT_URI) &&
    Array.isArray(methods) && methods.includes("none");
}

export function authorizationServerMetadata() {
  const issuer = new URL(getMcpResource()).origin;
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
    scopes_supported: getMcpScopes(),
  };
}
