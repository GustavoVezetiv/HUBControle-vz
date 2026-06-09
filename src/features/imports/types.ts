import type { Json } from "@/lib/supabase/types";

export type ImportTarget =
  | "people"
  | "categories"
  | "accounts_payable"
  | "income_sources"
  | "credit_cards"
  | "credit_card_invoices"
  | "credit_card_transactions"
  | "reimbursements"
  | "installments"
  | "planned_purchases"
  | "goals"
  | "system_goals_purchases";

export type ImportDateFormat = "br" | "iso" | "auto";

export type RawImportRow = Record<string, string>;

export type PreviewStatus = "valid" | "invalid" | "skipped" | "imported" | "failed";

export type PreviewRow = {
  rowNumber: number;
  target?: ImportTarget;
  raw: RawImportRow;
  mapped: Record<string, Json>;
  status: PreviewStatus;
  errors: string[];
  warnings?: string[];
  duplicate?: boolean;
  missingCategoryName?: string | null;
};

export type ImportTargetConfig = {
  target: ImportTarget;
  label: string;
  description: string;
  headers: string[];
};

export type ReferenceData = {
  people: { id: string; name: string }[];
  categories: { id: string; name: string; type: string }[];
  cards: { id: string; name: string; issuer: string | null }[];
  invoices: { id: string; credit_card_id: string; reference_month: string; due_date: string }[];
  accounts: { id: string; title: string; amount: number; due_date: string }[];
  incomeSources: { id: string; name: string; amount: number; expected_date: string | null }[];
  existing: {
    people: { name: string }[];
    categories: { name: string; type: string }[];
    accounts_payable: { title: string; amount: number; due_date: string }[];
    income_sources: { name: string; amount: number; expected_date: string | null }[];
    credit_cards: { name: string; issuer: string | null }[];
    credit_card_invoices: { credit_card_id: string; reference_month: string }[];
    credit_card_transactions: {
      invoice_id: string | null;
      transaction_date: string;
      description: string;
      amount: number;
    }[];
    reimbursements: {
      person_id: string;
      description: string | null;
      expected_amount: number;
      expected_date: string | null;
    }[];
    planned_purchases: {
      title: string;
      external_url: string | null;
      category_id: string | null;
      category_name?: string | null;
    }[];
    goals: {
      name: string;
      target_date: string | null;
      goal_category?: string | null;
      category_id?: string | null;
      category_label?: string | null;
    }[];
  };
};

export type SystemImportRows = {
  goals: RawImportRow[];
  purchases: RawImportRow[];
};
