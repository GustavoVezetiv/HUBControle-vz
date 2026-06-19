import type { AccountPayable, Category, CreditCard, CreditCardInvoice, CreditCardTransaction, IncomeSource, Person, Reimbursement } from "@/lib/supabase/types";

export type ReimbursementRow = Reimbursement;
export type ReimbursementPerson = Pick<Person, "id" | "name">;
export type ReimbursementTransaction = Pick<
  CreditCardTransaction,
  | "id"
  | "credit_card_id"
  | "invoice_id"
  | "category_id"
  | "description"
  | "amount"
  | "transaction_date"
  | "reimbursement_id"
  | "is_reimbursable"
>;
export type ReimbursementAccount = Pick<AccountPayable, "id" | "title" | "amount">;
export type ReimbursementIncome = Pick<IncomeSource, "id" | "name" | "amount">;
export type ReimbursementCategory = Pick<Category, "id" | "name" | "type" | "color" | "icon" | "scopes">;
export type ReimbursementCard = Pick<CreditCard, "id" | "name" | "issuer">;
export type ReimbursementInvoice = Pick<CreditCardInvoice, "id" | "credit_card_id" | "reference_month" | "due_date" | "status" | "total_amount">;

export type ReimbursementFinancialLinkMode =
  | "none"
  | "keep_current"
  | "link_existing"
  | "create_invoice_transaction"
  | "remove_current";

export type ReimbursementFinancialRemoveMode = "keep_transaction" | "archive_transaction";

export type ReimbursementGeneratedLinkValues =
  | {
      target: "account";
      title: string;
      description: string;
      amount: string;
      due_date: string;
    }
  | {
      target: "invoice";
      credit_card_id: string;
      invoice_id: string;
      description: string;
      amount: string;
      transaction_date: string;
    };

export type ReimbursementRenegotiationValues = {
  expected_date: string;
  description: string;
  notes: string;
};

export type ReimbursementFormValues = {
  person_id: string;
  category_id: string;
  credit_card_transaction_id: string;
  credit_card_invoice_id: string;
  account_payable_id: string;
  income_source_id: string;
  description: string;
  expected_amount: string;
  received_amount: string;
  expected_date: string;
  received_date: string;
  status: string;
  notes: string;
  is_recurring: boolean;
  recurrence_frequency: "monthly";
  recurrence_start_date: string;
  recurrence_end_date: string;
  recurrence_occurrences: string;
  financial_link_mode: ReimbursementFinancialLinkMode;
  financial_link_card_id: string;
  financial_link_invoice_id: string;
  financial_link_transaction_id: string;
  financial_link_allow_reuse: boolean;
  financial_link_new_description: string;
  financial_link_new_amount: string;
  financial_link_new_date: string;
  financial_link_new_category_id: string;
  financial_link_remove_mode: ReimbursementFinancialRemoveMode;
};

export const emptyReimbursementForm: ReimbursementFormValues = {
  person_id: "",
  category_id: "",
  credit_card_transaction_id: "",
  credit_card_invoice_id: "",
  account_payable_id: "",
  income_source_id: "",
  description: "",
  expected_amount: "0",
  received_amount: "0",
  expected_date: "",
  received_date: "",
  status: "expected",
  notes: "",
  is_recurring: false,
  recurrence_frequency: "monthly",
  recurrence_start_date: "",
  recurrence_end_date: "",
  recurrence_occurrences: "0",
  financial_link_mode: "none",
  financial_link_card_id: "",
  financial_link_invoice_id: "",
  financial_link_transaction_id: "",
  financial_link_allow_reuse: false,
  financial_link_new_description: "",
  financial_link_new_amount: "0",
  financial_link_new_date: "",
  financial_link_new_category_id: "",
  financial_link_remove_mode: "keep_transaction",
};

export function reimbursementToFormValues(reimbursement: ReimbursementRow): ReimbursementFormValues {
  return {
    person_id: reimbursement.person_id,
    category_id: reimbursement.category_id ?? "",
    credit_card_transaction_id: reimbursement.credit_card_transaction_id ?? "",
    credit_card_invoice_id: reimbursement.credit_card_invoice_id ?? "",
    account_payable_id: reimbursement.account_payable_id ?? "",
    income_source_id: reimbursement.income_source_id ?? "",
    description: reimbursement.description ?? "",
    expected_amount: String(reimbursement.expected_amount),
    received_amount: String(reimbursement.received_amount),
    expected_date: reimbursement.expected_date ?? "",
    received_date: reimbursement.received_date ?? "",
    status: reimbursement.status,
    notes: reimbursement.notes ?? "",
    is_recurring: reimbursement.is_recurring,
    recurrence_frequency: "monthly",
    recurrence_start_date: reimbursement.recurrence_start_date ?? reimbursement.expected_date ?? "",
    recurrence_end_date: reimbursement.recurrence_end_date ?? "",
    recurrence_occurrences: "0",
    financial_link_mode: reimbursement.credit_card_transaction_id ? "keep_current" : "none",
    financial_link_card_id: "",
    financial_link_invoice_id: reimbursement.credit_card_invoice_id ?? "",
    financial_link_transaction_id: reimbursement.credit_card_transaction_id ?? "",
    financial_link_allow_reuse: false,
    financial_link_new_description: reimbursement.description ?? "",
    financial_link_new_amount: String(reimbursement.expected_amount),
    financial_link_new_date: reimbursement.expected_date ?? "",
    financial_link_new_category_id: reimbursement.category_id ?? "",
    financial_link_remove_mode: "keep_transaction",
  };
}
