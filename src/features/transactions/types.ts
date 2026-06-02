import type {
  Category,
  CreditCard,
  CreditCardInvoice,
  CreditCardTransaction,
  OwnershipType,
  Person,
} from "@/lib/supabase/types";

export type TransactionRow = CreditCardTransaction;
export type TransactionCard = Pick<CreditCard, "id" | "name">;
export type TransactionInvoice = Pick<CreditCardInvoice, "id" | "credit_card_id" | "reference_month" | "due_date" | "status">;
export type TransactionCategory = Pick<Category, "id" | "name" | "type" | "color" | "icon">;
export type TransactionPerson = Pick<Person, "id" | "name">;

export type TransactionFormValues = {
  credit_card_id: string;
  invoice_id: string;
  transaction_date: string;
  description: string;
  amount: string;
  category_id: string;
  person_id: string;
  ownership_type: OwnershipType;
  is_installment_purchase: boolean;
  installment_number: string;
  installment_total: string;
  is_reimbursable: boolean;
  notes: string;
  create_reimbursement: boolean;
  reimbursement_expected_date: string;
  is_recurring: boolean;
  recurrence_frequency: "monthly";
  recurrence_start_date: string;
  recurrence_end_date: string;
  recurrence_occurrences: string;
};

export const emptyTransactionForm: TransactionFormValues = {
  credit_card_id: "",
  invoice_id: "",
  transaction_date: "",
  description: "",
  amount: "0",
  category_id: "",
  person_id: "",
  ownership_type: "personal",
  is_installment_purchase: false,
  installment_number: "",
  installment_total: "",
  is_reimbursable: false,
  notes: "",
  create_reimbursement: false,
  reimbursement_expected_date: "",
  is_recurring: false,
  recurrence_frequency: "monthly",
  recurrence_start_date: "",
  recurrence_end_date: "",
  recurrence_occurrences: "0",
};

export function transactionToFormValues(transaction: TransactionRow): TransactionFormValues {
  return {
    credit_card_id: transaction.credit_card_id,
    invoice_id: transaction.invoice_id ?? "",
    transaction_date: transaction.transaction_date,
    description: transaction.description,
    amount: String(transaction.amount),
    category_id: transaction.category_id ?? "",
    person_id: transaction.person_id ?? "",
    ownership_type: transaction.ownership_type,
    is_installment_purchase: Boolean(transaction.installment_number && transaction.installment_total),
    installment_number: transaction.installment_number ? String(transaction.installment_number) : "",
    installment_total: transaction.installment_total ? String(transaction.installment_total) : "",
    is_reimbursable: transaction.is_reimbursable,
    notes: transaction.notes ?? "",
    create_reimbursement: false,
    reimbursement_expected_date: "",
    is_recurring: transaction.is_recurring,
    recurrence_frequency: "monthly",
    recurrence_start_date: transaction.recurrence_start_date ?? transaction.transaction_date,
    recurrence_end_date: transaction.recurrence_end_date ?? "",
    recurrence_occurrences: "0",
  };
}
