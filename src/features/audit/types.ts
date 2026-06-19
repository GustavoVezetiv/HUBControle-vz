import type { AuditLog } from "@/lib/supabase/types";

export const auditActionLabels: Record<string, string> = {
  create: "Criação",
  update: "Edição",
  archive: "Arquivamento",
  restore: "Restauração",
  move_invoice: "Mudança de fatura",
  status_change: "Mudança de status",
  invoice_paid: "Pagamento de fatura",
  reimbursement_received: "Reembolso recebido",
  renegotiation: "Renegociação",
  import_confirmed: "Importação confirmada",
  financial_recalculation: "Recálculo financeiro",
  backup_exported: "Backup exportado",
};

export const auditModuleLabels: Record<string, string> = {
  accounts_payable: "Contas",
  income_sources: "Receitas",
  credit_card_invoices: "Faturas",
  credit_card_transactions: "Lançamentos",
  reimbursements: "Reembolsos",
  planned_purchases: "Compras e desejos",
  goals: "Metas",
  places: "Roles e lugares",
  import_batches: "Importações",
  financial_recalculation: "Diagnóstico financeiro",
  settings: "Configurações",
};

export const auditModules = Object.keys(auditModuleLabels);
export const auditActions = Object.keys(auditActionLabels);

export function getAuditActionLabel(action: string) {
  return auditActionLabels[action] ?? action;
}

export function getAuditModuleLabel(module: string) {
  return auditModuleLabels[module] ?? module;
}

export function formatAuditValue(value: AuditLog["old_value"] | AuditLog["new_value"]) {
  if (value === null || typeof value === "undefined") return "vazio";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value || "vazio";
  try {
    return JSON.stringify(value);
  } catch {
    return "valor não serializável";
  }
}
