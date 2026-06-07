import type { ImportTarget, ImportTargetConfig } from "@/features/imports/types";

export const activeImportTargets: ImportTargetConfig[] = [
  {
    target: "people",
    label: "Pessoas",
    description: "Amigos, família, clientes e pagadores.",
    headers: ["nome", "tipo", "email", "telefone", "observacoes", "ativo"],
  },
  {
    target: "categories",
    label: "Categorias",
    description: "Categorias de despesas, receitas, reembolsos e metas.",
    headers: ["nome", "tipo", "cor", "icone", "ativa"],
  },
  {
    target: "accounts_payable",
    label: "Contas a pagar",
    description: "Boletos, dívidas e obrigações.",
    headers: [
      "titulo",
      "descricao",
      "valor",
      "vencimento",
      "categoria",
      "pessoa",
      "prioridade",
      "status",
      "forma_pagamento_planejada",
      "pode_atrasar",
      "risco_atraso",
      "observacoes",
    ],
  },
  {
    target: "income_sources",
    label: "Receitas",
    description: "Renda real, reembolsos e dinheiro de terceiros esperado.",
    headers: [
      "origem",
      "descricao",
      "valor",
      "data_prevista",
      "data_recebida",
      "categoria",
      "pessoa",
      "tipo",
      "confianca",
      "status",
      "observacoes",
    ],
  },
  {
    target: "system_goals_purchases",
    label: "Metas e compras",
    description: "XLSX com as abas Metas_Sistema e Compras_Sistema.",
    headers: [
      "Use XLSX com duas abas:",
      "Metas_Sistema: Nome,Tipo,Data alvo,Status,Observações",
      "Compras_Sistema: Nome,Descrição,Valor estimado,Data alvo,Categoria,Forma planejada,Parcelas,Status,Risco,Notas",
    ],
  },
];

export const futureImportTargets: ImportTargetConfig[] = [
  {
    target: "credit_cards",
    label: "Cartões",
    description: "Cartões usados para cashback e pagamentos.",
    headers: ["nome", "emissor", "bandeira", "dia_fechamento", "dia_vencimento", "limite", "ativo", "observacoes"],
  },
  {
    target: "credit_card_invoices",
    label: "Faturas",
    description: "Faturas mensais dos cartões.",
    headers: ["cartao", "mes_referencia", "data_fechamento", "data_vencimento", "valor_total", "valor_pago", "status", "observacoes"],
  },
  {
    target: "credit_card_transactions",
    label: "Lançamentos de fatura",
    description: "Compras pessoais, de terceiros e reembolsáveis.",
    headers: [
      "cartao",
      "fatura",
      "data",
      "descricao",
      "valor",
      "categoria",
      "pessoa",
      "tipo_responsabilidade",
      "numero_parcela",
      "total_parcelas",
      "reembolsavel",
      "observacoes",
    ],
  },
  {
    target: "reimbursements",
    label: "Reembolsos",
    description: "Pix esperado ou recebido de outras pessoas.",
    headers: ["pessoa", "descricao", "valor_esperado", "valor_recebido", "data_prevista", "data_recebida", "status", "observacoes"],
  },
  {
    target: "installments",
    label: "Parcelamentos",
    description: "Compras parceladas e compromissos futuros.",
    headers: ["descricao", "valor_total", "valor_parcela", "total_parcelas", "parcela_atual", "data_inicio", "data_fim", "cartao", "status", "observacoes"],
  },
  {
    target: "planned_purchases",
    label: "Compras e desejos",
    description: "Compras planejadas antes da decisão.",
    headers: ["item", "descricao", "valor_estimado", "data_alvo", "categoria", "metodo_pagamento", "status", "risco", "observacoes"],
  },
  {
    target: "goals",
    label: "Metas",
    description: "Metas qualitativas, financeiras e numéricas.",
    headers: ["nome", "tipo", "valor_alvo", "valor_atual", "data_alvo", "contribuicao_mensal", "status"],
  },
];

export const importTargets: ImportTargetConfig[] = [...activeImportTargets, ...futureImportTargets];

export function isActiveImportTarget(target: ImportTarget) {
  return activeImportTargets.some((item) => item.target === target);
}

export function getImportTargetConfig(target: ImportTarget) {
  return importTargets.find((item) => item.target === target) ?? importTargets[0];
}

export function buildTemplateCsv(target: ImportTarget) {
  if (target === "system_goals_purchases") {
    return [
      "Este alvo usa XLSX com duas abas.",
      "Aba Metas_Sistema: Nome,Tipo,Data alvo,Status,Observações",
      "Aba Compras_Sistema: Nome,Descrição,Valor estimado,Data alvo,Categoria,Forma planejada,Parcelas,Status,Risco,Notas",
      "",
    ].join("\n");
  }
  const headers = getImportTargetConfig(target).headers;
  return `${headers.join(",")}\n`;
}

export function downloadTemplate(target: ImportTarget) {
  const config = getImportTargetConfig(target);
  const blob = new Blob([buildTemplateCsv(target)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `modelo_${config.target}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
