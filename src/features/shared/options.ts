import type { SelectOption } from "@/features/shared/types";

export const activeOptions: SelectOption[] = [
  { value: "true", label: "Ativo" },
  { value: "false", label: "Inativo" },
];

export const peopleTypeOptions: SelectOption[] = [
  { value: "family", label: "Família" },
  { value: "friend", label: "Amigo" },
  { value: "client", label: "Cliente" },
  { value: "payer", label: "Pagador" },
  { value: "other", label: "Outro" },
];

export const categoryTypeOptions: SelectOption[] = [
  { value: "expense", label: "Despesa" },
  { value: "income", label: "Receita" },
  { value: "reimbursement", label: "Reembolso" },
  { value: "purchase", label: "Compra" },
  { value: "goal", label: "Meta" },
  { value: "other", label: "Outro" },
];

export const priorityOptions: SelectOption[] = [
  { value: "low", label: "Baixa" },
  { value: "medium", label: "Média" },
  { value: "high", label: "Alta" },
  { value: "critical", label: "Crítica" },
];

export const accountStatusOptions: SelectOption[] = [
  { value: "pending", label: "Pendente" },
  { value: "paid", label: "Pago" },
  { value: "overdue", label: "Atrasado" },
  { value: "canceled", label: "Cancelado" },
];

export const paymentMethodOptions: SelectOption[] = [
  { value: "cash", label: "Dinheiro" },
  { value: "pix", label: "Pix" },
  { value: "credit_card", label: "Cartão de crédito" },
  { value: "bank_slip", label: "Boleto" },
  { value: "debit", label: "Débito" },
  { value: "transfer", label: "Transferência" },
  { value: "negotiation", label: "Negociação" },
  { value: "unknown", label: "Não definido" },
];

export const incomeTypeOptions: SelectOption[] = [
  { value: "real_income", label: "Renda real" },
  { value: "reimbursement", label: "Reembolso" },
  { value: "third_party_money", label: "Dinheiro de terceiros" },
  { value: "freelance", label: "Freelance" },
  { value: "salary", label: "Salário" },
  { value: "scholarship", label: "Bolsa" },
  { value: "other", label: "Outro" },
];

export const confidenceOptions: SelectOption[] = [
  { value: "low", label: "Baixa" },
  { value: "medium", label: "Média" },
  { value: "high", label: "Alta" },
  { value: "uncertain", label: "Incerta" },
];

export const incomeStatusOptions: SelectOption[] = [
  { value: "expected", label: "Prevista" },
  { value: "received", label: "Recebida" },
  { value: "partial", label: "Parcial" },
  { value: "overdue", label: "Atrasada" },
  { value: "canceled", label: "Cancelada" },
];

export const invoiceStatusOptions: SelectOption[] = [
  { value: "open", label: "Aberta" },
  { value: "closed", label: "Fechada" },
  { value: "paid", label: "Paga" },
  { value: "partial", label: "Parcial" },
  { value: "overdue", label: "Atrasada" },
  { value: "cancelled", label: "Cancelada" },
];

export const ownershipTypeOptions: SelectOption[] = [
  { value: "personal", label: "Despesa pessoal" },
  { value: "third_party", label: "Despesa de terceiro" },
  { value: "shared", label: "Compartilhada" },
  { value: "family", label: "Família" },
];

export const reimbursementStatusOptions: SelectOption[] = [
  { value: "expected", label: "A receber" },
  { value: "partial", label: "Parcial" },
  { value: "received", label: "Recebido" },
  { value: "late", label: "Atrasado" },
  { value: "renegotiated", label: "Renegociado" },
  { value: "cancelled", label: "Cancelado" },
  { value: "forgiven", label: "Perdoado" },
];

export const installmentStatusOptions: SelectOption[] = [
  { value: "active", label: "Ativo" },
  { value: "finished", label: "Finalizado" },
  { value: "cancelled", label: "Cancelado" },
  { value: "paused", label: "Pausado" },
];

export const paymentPlanStatusOptions: SelectOption[] = [
  { value: "draft", label: "Rascunho" },
  { value: "active", label: "Ativo" },
  { value: "completed", label: "Concluído" },
  { value: "cancelled", label: "Cancelado" },
];

export const paymentPlanItemTypeOptions: SelectOption[] = [
  { value: "account_payable", label: "Conta" },
  { value: "credit_card_invoice", label: "Fatura" },
  { value: "installment", label: "Parcelamento" },
  { value: "reimbursement", label: "Reembolso" },
  { value: "income_source", label: "Receita" },
  { value: "manual", label: "Manual" },
];

export const paymentDecisionOptions: SelectOption[] = [
  { value: "pay_now", label: "Pagar agora" },
  { value: "pay_when_income_arrives", label: "Pagar quando cair renda" },
  { value: "pay_by_card", label: "Pagar no cartão" },
  { value: "parcel", label: "Parcelar" },
  { value: "wait", label: "Aguardar" },
  { value: "negotiate", label: "Negociar" },
  { value: "ignore_for_now", label: "Ignorar por enquanto" },
];

export const planItemStatusOptions: SelectOption[] = [
  { value: "planned", label: "Planejado" },
  { value: "done", label: "Feito" },
  { value: "skipped", label: "Ignorado" },
  { value: "cancelled", label: "Cancelado" },
];

export function optionLabel(options: SelectOption[], value: string | null | undefined) {
  return options.find((option) => option.value === value)?.label ?? value ?? "-";
}
