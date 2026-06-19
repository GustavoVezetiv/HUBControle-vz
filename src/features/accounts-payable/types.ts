import type { AccountPayable, Category, CreditCard, CreditCardInvoice, Installment, Person, RiskLevel } from "@/lib/supabase/types";

export type AccountRecurrenceFrequency = "monthly" | "weekly" | "yearly";

export type AccountPayableFormValues = {
  title: string;
  description: string;
  amount: string;
  due_date: string;
  category_id: string;
  person_id: string;
  priority: string;
  status: string;
  payment_method_planned: string;
  can_delay: boolean;
  delay_risk: RiskLevel;
  notes: string;
  is_recurring: boolean;
  recurrence_frequency: AccountRecurrenceFrequency;
  recurrence_start_date: string;
  recurrence_end_date: string;
  recurrence_occurrences: string;
};

export type AccountPayableRow = AccountPayable;
export type AccountCategory = Pick<Category, "id" | "name" | "type" | "color" | "icon" | "scopes">;
export type AccountPerson = Pick<Person, "id" | "name">;
export type AccountInstallment = Pick<Installment, "id" | "description" | "installment_total" | "installment_count">;
export type AccountCreditCard = Pick<CreditCard, "id" | "name" | "issuer">;
export type AccountInvoice = Pick<CreditCardInvoice, "id" | "credit_card_id" | "reference_month" | "due_date">;

export type AccountCardPaymentFormValues = {
  credit_card_id: string;
  invoice_id: string;
  transaction_date: string;
  description: string;
  amount: string;
};

export const emptyAccountForm: AccountPayableFormValues = {
  title: "",
  description: "",
  amount: "0",
  due_date: "",
  category_id: "",
  person_id: "",
  priority: "medium",
  status: "pending",
  payment_method_planned: "unknown",
  can_delay: false,
  delay_risk: "medium",
  notes: "",
  is_recurring: false,
  recurrence_frequency: "monthly",
  recurrence_start_date: "",
  recurrence_end_date: "",
  recurrence_occurrences: "0",
};

export function accountToFormValues(account: AccountPayableRow): AccountPayableFormValues {
  return {
    title: account.title,
    description: account.description ?? "",
    amount: String(account.amount),
    due_date: account.due_date,
    category_id: account.category_id ?? "",
    person_id: account.person_id ?? "",
    priority: account.priority,
    status: account.status,
    payment_method_planned: account.payment_method_planned,
    can_delay: account.can_delay,
    delay_risk: account.delay_risk,
    notes: account.notes ?? "",
    is_recurring: account.is_recurring,
    recurrence_frequency: (account.recurrence_frequency as AccountRecurrenceFrequency | null) ?? "monthly",
    recurrence_start_date: account.recurrence_start_date ?? account.due_date,
    recurrence_end_date: account.recurrence_end_date ?? "",
    recurrence_occurrences: "0",
  };
}
