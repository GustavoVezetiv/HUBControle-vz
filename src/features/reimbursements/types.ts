import type { AccountPayable, Category, CreditCardTransaction, IncomeSource, Person, Reimbursement } from "@/lib/supabase/types";

export type ReimbursementRow = Reimbursement;
export type ReimbursementPerson = Pick<Person, "id" | "name">;
export type ReimbursementTransaction = Pick<CreditCardTransaction, "id" | "description" | "amount" | "transaction_date">;
export type ReimbursementAccount = Pick<AccountPayable, "id" | "title" | "amount">;
export type ReimbursementIncome = Pick<IncomeSource, "id" | "name" | "amount">;
export type ReimbursementCategory = Pick<Category, "id" | "name" | "type" | "color" | "icon">;

export type ReimbursementFormValues = {
  person_id: string;
  category_id: string;
  credit_card_transaction_id: string;
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
};

export const emptyReimbursementForm: ReimbursementFormValues = {
  person_id: "",
  category_id: "",
  credit_card_transaction_id: "",
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
};

export function reimbursementToFormValues(reimbursement: ReimbursementRow): ReimbursementFormValues {
  return {
    person_id: reimbursement.person_id,
    category_id: reimbursement.category_id ?? "",
    credit_card_transaction_id: reimbursement.credit_card_transaction_id ?? "",
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
  };
}
