import type { FinancialInflowKind, IncomeSource } from "@/lib/supabase/types";

export type LinkedEntryType =
  | "real_income"
  | "reimbursement_received"
  | "personal_contribution"
  | "account_transfer"
  | "available_cash"
  | "loan_received"
  | "other";

export type LinkedPaymentType =
  | "invoice_payment"
  | "installment_payment"
  | "reimbursement_receipt"
  | "account_payment";

export type FinancialLinkModule =
  | "accounts_payable"
  | "credit_card_invoices"
  | "credit_card_transactions"
  | "installments"
  | "reimbursements"
  | "income_sources";

export type FinancialLinkFields = {
  linked_module: FinancialLinkModule;
  linked_record_id: string;
};

export type LinkedEntryFormValues = {
  title: string;
  amount: string;
  date: string;
  type: LinkedEntryType;
  person_id: string;
  notes: string;
};

export type LinkedEntryContext = {
  paymentType: LinkedPaymentType;
  paymentId: string;
  title: string;
  amount: number;
  date: string;
  defaultType: LinkedEntryType;
  personId?: string | null;
  notes?: string;
  creditCardInvoiceId?: string | null;
  accountPayableId?: string | null;
  installmentId?: string | null;
  reimbursementId?: string | null;
};

export type CashAvailability = {
  periodStart: string;
  periodEnd: string;
  inflows: number;
  outflows: number;
  available: number;
  requiredAmount: number;
  hasEnough: boolean;
};

export type LinkedIncomeSourceRow = IncomeSource;

export function inflowKindForLinkedEntry(type: LinkedEntryType): FinancialInflowKind {
  if (type === "real_income") return "real_income";
  if (type === "reimbursement_received") return "reimbursement";
  return "third_party_money";
}

export function financialLinkModuleForPaymentType(paymentType: LinkedPaymentType): FinancialLinkModule {
  if (paymentType === "invoice_payment") return "credit_card_invoices";
  if (paymentType === "installment_payment") return "installments";
  if (paymentType === "reimbursement_receipt") return "reimbursements";
  return "accounts_payable";
}

export function buildFinancialLinkFields(context: LinkedEntryContext): FinancialLinkFields {
  return {
    linked_module: financialLinkModuleForPaymentType(context.paymentType),
    linked_record_id: context.paymentId,
  };
}

export const linkedEntryTypeOptions: { value: LinkedEntryType; label: string }[] = [
  { value: "real_income", label: "Receita" },
  { value: "reimbursement_received", label: "Reembolso recebido" },
  { value: "personal_contribution", label: "Aporte pessoal" },
  { value: "account_transfer", label: "Transferência entre contas" },
  { value: "available_cash", label: "Dinheiro já disponível" },
  { value: "loan_received", label: "Empréstimo recebido" },
  { value: "other", label: "Outro" },
];
