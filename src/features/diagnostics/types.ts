import type {
  Category,
  CreditCard,
  CreditCardInvoice,
  CreditCardTransaction,
  DiagnosticAlertIgnore,
  Installment,
  Reimbursement,
} from "@/lib/supabase/types";

export type FinancialDiagnosticAlertType =
  | "transactions_without_invoice"
  | "invoice_total_mismatch"
  | "broken_reimbursement_link"
  | "invalid_renegotiation"
  | "empty_open_invoice"
  | "incomplete_installment"
  | "out_of_scope_category";

export type FinancialDiagnosticSectionKey =
  | "transactions_without_invoice"
  | "invoice_total_mismatch"
  | "broken_reimbursement_link"
  | "invalid_renegotiation"
  | "empty_open_invoice"
  | "incomplete_installment"
  | "out_of_scope_category";

export type FinancialDiagnosticAction =
  | "open_item"
  | "open_invoice"
  | "open_transaction"
  | "manual_link"
  | "recalculate_invoice"
  | "create_correct_invoice"
  | "ignore_alert";

export type DiagnosticReference = {
  label: string;
  href: string;
};

export type FinancialDiagnosticItem = {
  alertKey: string;
  alertType: FinancialDiagnosticAlertType;
  subjectType: string;
  subjectId: string;
  title: string;
  description: string;
  details: string[];
  amount?: number | null;
  references: DiagnosticReference[];
  actions: FinancialDiagnosticAction[];
  invoiceId?: string | null;
  transactionId?: string | null;
  reimbursementId?: string | null;
  installmentId?: string | null;
  creditCardId?: string | null;
  transactionDate?: string | null;
  suggestedInvoicePreview?: {
    referenceMonth: string;
    closingDate: string;
    dueDate: string;
    existingInvoiceId: string | null;
  } | null;
};

export type FinancialDiagnosticSection = {
  key: FinancialDiagnosticSectionKey;
  title: string;
  description: string;
  count: number;
  ignoredCount: number;
  items: FinancialDiagnosticItem[];
};

export type FinancialDiagnosticsData = {
  generatedAt: string;
  totalAlerts: number;
  totalIgnored: number;
  sections: FinancialDiagnosticSection[];
};

export type FinancialDiagnosticsSourceData = {
  categories: Category[];
  cards: CreditCard[];
  invoices: CreditCardInvoice[];
  transactions: CreditCardTransaction[];
  reimbursements: Reimbursement[];
  installments: Installment[];
  purchases: Array<{ id: string; title: string; category_id: string | null }>;
  goals: Array<{ id: string; name: string; category_id: string | null }>;
  ignoredAlerts: DiagnosticAlertIgnore[];
};
