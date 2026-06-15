import type { Category, PlannedPurchase, RiskLevel } from "@/lib/supabase/types";

export type PlannedPurchaseRow = PlannedPurchase;

export type PlannedPurchaseFormValues = {
  title: string;
  description: string;
  estimated_amount: string;
  paid_amount: string;
  target_date: string;
  purchase_date: string;
  category_id: string;
  project: string;
  payment_method: string;
  installment_count: string;
  decision_status: string;
  risk_level: RiskLevel;
  notes: string;
};

export type PlannedPurchaseSupportData = {
  categories: Pick<Category, "id" | "name" | "type" | "color" | "icon">[];
};

export const decisionStatusOptions = [
  { value: "considering", label: "Em análise" },
  { value: "approved", label: "Aprovada" },
  { value: "delayed", label: "Adiada" },
  { value: "purchased", label: "Comprada" },
  { value: "canceled", label: "Cancelada" },
];

export const emptyPlannedPurchaseForm: PlannedPurchaseFormValues = {
  title: "",
  description: "",
  estimated_amount: "0",
  paid_amount: "0",
  target_date: "",
  purchase_date: "",
  category_id: "",
  project: "",
  payment_method: "unknown",
  installment_count: "",
  decision_status: "considering",
  risk_level: "medium",
  notes: "",
};

export function plannedPurchaseToFormValues(item: PlannedPurchaseRow): PlannedPurchaseFormValues {
  return {
    title: item.title,
    description: item.description ?? "",
    estimated_amount: String(item.estimated_amount),
    paid_amount: String(item.paid_amount ?? 0),
    target_date: item.target_date ?? "",
    purchase_date: item.purchase_date ?? "",
    category_id: item.category_id ?? "",
    project: item.project ?? "",
    payment_method: item.payment_method,
    installment_count: item.installment_count ? String(item.installment_count) : "",
    decision_status: item.decision_status,
    risk_level: item.risk_level,
    notes: item.notes ?? "",
  };
}
