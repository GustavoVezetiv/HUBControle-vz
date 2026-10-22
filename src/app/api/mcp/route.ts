import { NextResponse } from "next/server";

import { getMcpAuthContext, isAllowedMcpOrigin, mcpAuthenticateHeader } from "@/features/mcp/auth";
import { areMcpWritesEnabled, isMcpEnabled } from "@/features/mcp/security";
import { acceptsMcpProtocolHeader, negotiateMcpProtocolVersion } from "@/features/mcp/protocol";
import { hubTools, runReadTool, runWriteTool, validateToolArguments } from "@/features/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
};

export async function POST(request: Request) {
  if (!isMcpEnabled()) return NextResponse.json({ error: "MCP não habilitado." }, { status: 503 });
  if (!isAllowedMcpOrigin(request)) {
    return NextResponse.json({ error: "Origem não permitida." }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Content-Type deve ser application/json." }, { status: 415 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > 65_536) {
    return NextResponse.json({ error: "Requisição MCP excede 64 KiB." }, { status: 413 });
  }
  const auth = await getMcpAuthContext(request);
  if ("error" in auth) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: auth.status === 401 ? { "WWW-Authenticate": mcpAuthenticateHeader() } : undefined },
    );
  }

  let payload: JsonRpcRequest;
  try {
    payload = (await request.json()) as JsonRpcRequest;
  } catch {
    return jsonRpcError(null, -32700, "JSON inválido.");
  }
  if (payload.jsonrpc !== "2.0" || typeof payload.method !== "string") {
    return jsonRpcError(typeof payload.id === "string" || typeof payload.id === "number" ? payload.id : null, -32600, "Requisição JSON-RPC inválida.");
  }

  const id = typeof payload.id === "string" || typeof payload.id === "number" ? payload.id : null;
  const params = payload.params && typeof payload.params === "object" && !Array.isArray(payload.params)
    ? payload.params as Record<string, unknown>
    : {};

  if (!acceptsMcpProtocolHeader(payload.method, request.headers.get("MCP-Protocol-Version"))) {
    return NextResponse.json({ error: "Versão MCP não suportada." }, { status: 400 });
  }

  try {
    if (payload.method === "initialize") {
      return jsonRpcResult(id, {
        protocolVersion: negotiateMcpProtocolVersion(params.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "hub-vz", version: "1.0.0" },
        instructions: "Hub VZ é a fonte oficial. Consultas e escritas simples autorizadas estão disponíveis. Escritas usam idempotência e auditoria; operações destrutivas ou em faturas quitadas exigem confirmação explícita na conversa.",
      });
    }
    if (payload.method === "notifications/initialized") return new NextResponse(null, { status: 202 });
    if (payload.method === "ping") return jsonRpcResult(id, {});
    if (payload.method === "tools/list") return jsonRpcResult(id, { tools: areMcpWritesEnabled() ? hubTools : hubTools.filter((tool) => tool.annotations.readOnlyHint) });
    if (payload.method === "tools/call") return await callTool(id, params, auth);
    return jsonRpcError(id, -32601, "Método MCP não encontrado.");
  } catch (error) {
    console.error("[hub-mcp] Unhandled MCP request", error);
    return jsonRpcError(id, -32603, "Erro interno ao processar a requisição.");
  }
}

export async function GET(request: Request) {
  if (!isAllowedMcpOrigin(request)) return NextResponse.json({ error: "Origem não permitida." }, { status: 403 });
  return NextResponse.json({ error: "Use POST com Streamable HTTP MCP." }, { status: 405, headers: { Allow: "POST, OPTIONS" } });
}

export async function OPTIONS(request: Request) {
  if (!isAllowedMcpOrigin(request)) return NextResponse.json({ error: "Origem não permitida." }, { status: 403 });
  return new NextResponse(null, { status: 204, headers: { Allow: "POST, OPTIONS" } });
}

async function callTool(id: string | number | null, params: Record<string, unknown>, auth: Exclude<Awaited<ReturnType<typeof getMcpAuthContext>>, { error: string; status: number }>) {
  const name = params.name;
  if (typeof name !== "string") return jsonRpcError(id, -32602, "Nome da ferramenta obrigatório.");
  try {
    const args = validateToolArguments(name, params.arguments ?? {});
    const context = { client: auth.client, userId: auth.user.id };
    const tool = hubTools.find((item) => item.name === name);
    let output: unknown;
    if (!tool) throw new Error("Ferramenta desconhecida.");
    if (!auth.scopes.includes("mcp:read")) throw new Error("Token sem permissão de leitura MCP.");
    if (!tool.annotations.readOnlyHint && !areMcpWritesEnabled()) throw new Error("Escritas MCP desativadas até a validação de segurança e configuração explícita.");
    if (!tool.annotations.readOnlyHint && !auth.scopes.includes("mcp:write")) throw new Error("Token sem permissão de escrita MCP. Reconecte o Hub VZ para conceder o novo escopo.");
    if (tool.annotations.readOnlyHint) output = await runReadTool(name, args, context);
    else output = await runWriteTool(name, args, context);
    return jsonRpcResult(id, toolResult(output));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao executar ferramenta.";
    return jsonRpcResult(id, { content: [{ type: "text", text: message }], isError: true });
  }
}

function toolResult(output: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], structuredContent: output };
}

function jsonRpcResult(id: string | number | null, result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id, result }, { headers: { "Content-Type": "application/json" } });
}

function jsonRpcError(id: string | number | null, code: number, message: string) {
  return NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } }, { headers: { "Content-Type": "application/json" } });
}
