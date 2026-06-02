import type { Category, CreditCard, CreditCardInvoice, CreditCardTransaction, Installment, Person } from "@/lib/supabase/types";

export type InstallmentRow = Installment;
export type InstallmentCard = Pick<CreditCard, "id" | "name">;
export type InstallmentInvoice = Pick<CreditCardInvoice, "id" | "credit_card_id" | "reference_month" | "due_date" | "status">;
export type InstallmentTransaction = Pick<CreditCardTransaction, "id" | "credit_card_id" | "invoice_id" | "description" | "amount" | "transaction_date">;
export type InstallmentCategory = Pick<Category, "id" | "name" | "type" | "color" | "icon">;
export type InstallmentPerson = Pick<Person, "id" | "name">;

export const installmentOriginOptions = [
  { value: "card", label: "Cartão" },
  { value: "invoice", label: "Fatura" },
  { value: "bank_slip", label: "Boleto" },
  { value: "financing", label: "Financiamento" },
  { value: "informal_debt", label: "Dívida informal" },
  { value: "other", label: "Outro" },
] as const;

export type InstallmentOrigin = (typeof installmentOriginOptions)[number]["value"];

export type InstallmentFormValues = {
  description: string;
  total_amount: string;
  installment_amount: string;
  installment_total: string;
  current_installment: string;
  start_date: string;
  end_date: string;
  credit_card_id: string;
  invoice_id: string;
  credit_card_transaction_id: string;
  category_id: string;
  person_id: string;
  installment_origin: InstallmentOrigin;
  status: string;
  generate_accounts: boolean;
  notes: string;
};

export const emptyInstallmentForm: InstallmentFormValues = {
  description: "",
  total_amount: "0",
  installment_amount: "0",
  installment_total: "1",
  current_installment: "1",
  start_date: "",
  end_date: "",
  credit_card_id: "",
  invoice_id: "",
  credit_card_transaction_id: "",
  category_id: "",
  person_id: "",
  installment_origin: "other",
  status: "active",
  generate_accounts: false,
  notes: "",
};

export function installmentToFormValues(item: InstallmentRow): InstallmentFormValues {
  return {
    description: item.description,
    total_amount: String(item.total_amount),
    installment_amount: String(item.installment_amount),
    installment_total: String(item.installment_total ?? item.installment_count),
    current_installment: String(item.current_installment ?? item.installment_number),
    start_date: item.start_date ?? item.due_month,
    end_date: item.end_date ?? item.due_month,
    credit_card_id: item.credit_card_id ?? "",
    invoice_id: item.invoice_id ?? "",
    credit_card_transaction_id: item.credit_card_transaction_id ?? "",
    category_id: item.category_id ?? "",
    person_id: item.person_id ?? "",
    installment_origin: (item.installment_origin as InstallmentOrigin | null) ?? inferInstallmentOrigin(item),
    status: item.status,
    generate_accounts: false,
    notes: item.notes ?? "",
  };
}

function inferInstallmentOrigin(item: InstallmentRow): InstallmentOrigin {
  if (item.invoice_id) return "invoice";
  if (item.credit_card_id) return "card";
  return "other";
}
