import { redirect } from "next/navigation";

import { decideMcpProposal } from "./actions";
import { listMcpActionRequests } from "@/features/mcp/admin";
import { canDecideMcpProposal } from "@/features/mcp/security";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Aprovações MCP" };
export const dynamic = "force-dynamic";

const labels: Record<string, string> = {
  hub_create_planned_purchase: "Criar compra planejada",
  hub_update_planned_purchase: "Editar compra planejada",
  hub_create_goal: "Criar meta",
  hub_update_goal: "Editar meta",
  title: "Nome", estimatedAmount: "Valor estimado", targetDate: "Data alvo",
  categoryId: "Categoria (ID)", project: "Projeto", notes: "Observações",
  id: "Registro (ID)", name: "Nome", status: "Status",
  goalType: "Tipo", goalKind: "Natureza", targetAmount: "Valor objetivo",
};

const notices: Record<string, string> = {
  approved: "Proposta aprovada e aplicada.",
  rejected: "Proposta rejeitada. Nenhum registro foi alterado.",
  invalid: "Proposta inválida, alterada, expirada ou já decidida.",
  unavailable: "Aprovações MCP indisponíveis nesta instalação.",
  failed: "Não foi possível aplicar a proposta. Nenhuma alteração parcial foi mantida.",
};

export default async function McpApprovalsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const supabase = await createClient();
  if (!supabase) redirect("/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { notice } = await searchParams;
  const { data, error } = await listMcpActionRequests(user.id);
  const secret = process.env.MCP_CONFIRMATION_SECRET?.trim();
  const proposals = data;

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-6 text-slate-900 dark:text-slate-100">
      <header>
        <h1 className="text-2xl font-semibold">Aprovações MCP</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Revise propostas de planejamento feitas pelo ChatGPT. Nada é aplicado antes da sua decisão aqui no Hub.</p>
      </header>
      {notice && notices[notice] && <p role="status" className="border border-teal-600/30 bg-teal-50 px-3 py-2 text-sm text-teal-900 dark:bg-teal-950 dark:text-teal-100">{notices[notice]}</p>}
      {error && <p role="alert" className="border border-red-500/30 bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-100">Não foi possível carregar propostas. Verifique se a migration MCP está aplicada neste ambiente.</p>}
      {!error && proposals.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-300">Nenhuma proposta registrada.</p>}
      <div className="space-y-3">
        {proposals.map((proposal) => {
          const args = proposal.arguments && typeof proposal.arguments === "object" && !Array.isArray(proposal.arguments)
            ? proposal.arguments as Record<string, unknown> : {};
          const canDecide = Boolean(secret && secret.length >= 32 && canDecideMcpProposal({
            id: proposal.id, userId: proposal.user_id, toolName: proposal.tool_name,
            arguments: args, expiresAt: proposal.expires_at, signature: proposal.intent_signature,
            status: proposal.status,
          }, user.id, secret));
          return (
            <section key={proposal.id} className="border border-slate-300 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{labels[proposal.tool_name] ?? "Operação não disponível"}</h2>
                  <p className="text-xs text-slate-600 dark:text-slate-300">Criada em {new Date(proposal.created_at).toLocaleString("pt-BR")} · válida até {new Date(proposal.expires_at).toLocaleString("pt-BR")}</p>
                </div>
                <span className="text-sm font-medium">{proposal.status === "pending" && !canDecide ? "Expirada ou inválida" : proposal.status}</span>
              </div>
              <dl className="mt-3 grid gap-x-5 gap-y-2 text-sm sm:grid-cols-2">
                {Object.entries(args).filter(([key]) => key !== "_version").map(([key, value]) => (
                  <div key={key} className="min-w-0">
                    <dt className="text-slate-600 dark:text-slate-300">{labels[key] ?? key}</dt>
                    <dd className="break-words font-medium">{String(value ?? "Não informado")}</dd>
                  </div>
                ))}
              </dl>
              {canDecide && <div className="mt-4 flex gap-2">
                <form action={decideMcpProposal}>
                  <input type="hidden" name="id" value={proposal.id} />
                  <input type="hidden" name="decision" value="approve" />
                  <button type="submit" className="border border-teal-700 bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700">Aprovar e aplicar</button>
                </form>
                <form action={decideMcpProposal}>
                  <input type="hidden" name="id" value={proposal.id} />
                  <input type="hidden" name="decision" value="reject" />
                  <button type="submit" className="border border-slate-400 px-3 py-2 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800">Rejeitar</button>
                </form>
              </div>}
            </section>
          );
        })}
      </div>
    </main>
  );
}
