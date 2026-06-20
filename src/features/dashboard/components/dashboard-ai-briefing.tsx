"use client";

import { AiResponsePanel } from "@/features/ai/components/ai-response-panel";

type DashboardAiBriefingProps = {
  periodLabel: string;
  compactMode: boolean;
  overviewCards: Array<{ label: string; value: string; helper: string }>;
  attentionBlocks: Array<{ title: string; value: string; helper: string; items: Array<{ label: string; meta?: string }> }>;
  monthSummaryRows: Array<{ label: string; value: string; helper: string }>;
};

export function DashboardAiBriefing({
  periodLabel,
  compactMode,
  overviewCards,
  attentionBlocks,
  monthSummaryRows,
}: DashboardAiBriefingProps) {
  return (
    <AiResponsePanel
      title="Briefing com IA"
      description="Leitura opcional do momento atual. A IA usa o contexto salvo do usuário e não executa ações automaticamente."
      buttonLabel="Gerar briefing"
      loadingLabel="Gerando briefing..."
      target="dashboard_briefing"
      payload={{
        periodo: periodLabel,
        modo_dashboard: compactMode ? "simples" : "completo",
        resumo_curto: overviewCards,
        precisa_de_atencao: attentionBlocks.map((block) => ({
          titulo: block.title,
          valor: block.value,
          helper: block.helper,
          itens: block.items.slice(0, 4),
        })),
        resumo_mes: monthSummaryRows,
      }}
      emptyState="Gere um briefing para receber um resumo objetivo do que olhar agora."
    />
  );
}
