export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type FinancialInflowKind = "real_income" | "reimbursement" | "third_party_money";
export type OwnershipType = "personal" | "reimbursable" | "third_party" | "shared" | "family";
export type InvoicePaymentStatus =
  | "open"
  | "closed"
  | "paid"
  | "partial"
  | "overdue"
  | "canceled"
  | "cancelled";
export type PaymentDecision =
  | "pay_now"
  | "pay_when_income_arrives"
  | "wait"
  | "parcel"
  | "negotiate"
  | "pay_by_card"
  | "ignore_for_now"
  | "monitor"
  | "skip";
export type RiskLevel = "low" | "medium" | "high" | "critical";

export type Profile = {
  id: string;
  user_id: string;
  display_name: string | null;
  currency: string;
  timezone: string;
  month_start_day: number;
  allow_quick_table_edit: boolean;
  created_at: string;
  updated_at: string;
};

export type UserOwnedRow = {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
};

export type Person = UserOwnedRow & {
  name: string;
  relationship_type: string;
  email: string | null;
  phone: string | null;
  pix_key: string | null;
  notes: string | null;
  is_active: boolean;
};

export type Category = UserOwnedRow & {
  name: string;
  type: string;
  parent_category_id: string | null;
  color: string | null;
  icon: string | null;
  is_default: boolean;
  is_active: boolean;
};

export type AccountPayable = UserOwnedRow & {
  category_id: string | null;
  person_id: string | null;
  title: string;
  description: string | null;
  amount: number;
  due_date: string;
  status: string;
  priority: string;
  risk_level: RiskLevel;
  is_recurring: boolean;
  recurrence_rule: Json | null;
  recurrence_frequency: string | null;
  recurrence_start_date: string | null;
  recurrence_end_date: string | null;
  recurrence_parent_id: string | null;
  recurrence_generated_until: string | null;
  paid_at: string | null;
  payment_method_planned: string;
  can_delay: boolean;
  delay_risk: RiskLevel;
  source_type: string;
  source_id: string | null;
  installment_id: string | null;
  installment_number: number | null;
  is_generated: boolean;
  paid_with_credit_card: boolean;
  credit_card_transaction_id: string | null;
  credit_card_invoice_id: string | null;
  notes: string | null;
};

export type IncomeSource = UserOwnedRow & {
  category_id: string | null;
  person_id: string | null;
  name: string;
  description: string | null;
  source_type: string;
  inflow_kind: FinancialInflowKind;
  amount: number;
  expected_date: string | null;
  is_recurring: boolean;
  recurrence_rule: Json | null;
  status: string;
  received_at: string | null;
  received_date: string | null;
  confidence: string;
  notes: string | null;
};

export type CreditCard = UserOwnedRow & {
  name: string;
  issuer: string | null;
  brand: string | null;
  last_four_digits: string | null;
  limit_amount: number | null;
  closing_day: number | null;
  due_day: number | null;
  cashback_rate: number;
  notes: string | null;
  is_active: boolean;
};

export type CreditCardInvoice = UserOwnedRow & {
  credit_card_id: string;
  reference_month: string;
  closing_date: string | null;
  due_date: string;
  status: InvoicePaymentStatus;
  total_amount: number;
  personal_amount: number;
  reimbursable_amount: number;
  third_party_amount: number;
  paid_amount: number;
  paid_at: string | null;
  notes: string | null;
};

export type CreditCardTransaction = UserOwnedRow & {
  credit_card_id: string;
  invoice_id: string | null;
  category_id: string | null;
  person_id: string | null;
  description: string;
  merchant: string | null;
  amount: number;
  transaction_date: string;
  posting_date: string | null;
  ownership_type: OwnershipType;
  is_reimbursable: boolean;
  reimbursement_status: string;
  installment_group_id: string | null;
  installment_number: number | null;
  installment_total: number | null;
  is_recurring: boolean;
  recurrence_frequency: string | null;
  recurrence_start_date: string | null;
  recurrence_end_date: string | null;
  recurrence_parent_id: string | null;
  recurrence_generated_until: string | null;
  notes: string | null;
};

export type Reimbursement = UserOwnedRow & {
  person_id: string;
  category_id: string | null;
  source_type: string;
  source_id: string | null;
  credit_card_transaction_id: string | null;
  account_payable_id: string | null;
  income_source_id: string | null;
  credit_card_invoice_id: string | null;
  description: string | null;
  expected_amount: number;
  received_amount: number;
  status: string;
  expected_date: string | null;
  received_at: string | null;
  received_date: string | null;
  is_recurring: boolean;
  recurrence_frequency: string | null;
  recurrence_start_date: string | null;
  recurrence_end_date: string | null;
  recurrence_parent_id: string | null;
  recurrence_generated_until: string | null;
  pix_reference: string | null;
  notes: string | null;
};

export type Installment = UserOwnedRow & {
  installment_group_id: string;
  credit_card_transaction_id: string | null;
  credit_card_id: string | null;
  invoice_id: string | null;
  category_id: string | null;
  person_id: string | null;
  description: string;
  total_amount: number;
  installment_amount: number;
  installment_number: number;
  installment_count: number;
  installment_total: number | null;
  current_installment: number | null;
  due_month: string;
  start_date: string | null;
  end_date: string | null;
  installment_origin: string;
  status: string;
  notes: string | null;
};

export type PaymentPlan = UserOwnedRow & {
  reference_month: string;
  name: string;
  description: string | null;
  starting_balance: number;
  projected_income: number;
  projected_reimbursements: number;
  projected_expenses: number;
  projected_ending_balance: number;
  status: string;
  notes: string | null;
};

export type PaymentPlanItem = UserOwnedRow & {
  payment_plan_id: string;
  item_type: string;
  source_id: string | null;
  account_payable_id: string | null;
  credit_card_invoice_id: string | null;
  installment_id: string | null;
  reimbursement_id: string | null;
  income_source_id: string | null;
  planned_purchase_id: string | null;
  goal_id: string | null;
  title: string;
  description: string | null;
  amount: number;
  due_date: string | null;
  decision: PaymentDecision;
  planned_payment_date: string | null;
  priority: string;
  risk_level: RiskLevel;
  status: string;
  notes: string | null;
};

export type PlannedPurchase = UserOwnedRow & {
  category_id: string | null;
  title: string;
  description: string | null;
  estimated_amount: number;
  target_date: string | null;
  payment_method: string;
  credit_card_id: string | null;
  installment_count: number | null;
  decision_status: string;
  risk_level: RiskLevel;
  notes: string | null;
};

export type Goal = UserOwnedRow & {
  name: string;
  goal_type: string;
  target_amount: number;
  current_amount: number;
  target_date: string | null;
  monthly_contribution: number;
  status: string;
  notes: string | null;
};

export type Note = UserOwnedRow & {
  entity_type: string;
  entity_id: string | null;
  title: string | null;
  body: string;
  pinned: boolean;
};

export type ImportBatch = UserOwnedRow & {
  module: string;
  target_type: string | null;
  file_name: string;
  file_type: "csv" | "xlsx";
  status: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  mapping_config: Json | null;
  imported_at: string | null;
  confirmed_at: string | null;
  notes: string | null;
};

export type ImportRow = UserOwnedRow & {
  import_batch_id: string;
  row_number: number;
  raw_data: Json;
  parsed_data: Json | null;
  mapped_data: Json | null;
  validation_errors: Json | null;
  errors: Json | null;
  status: string;
  target_entity_type: string | null;
  target_entity_id: string | null;
};

export type DashboardUser = {
  id: string;
  email: string | null;
};

type SupabaseTable<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: SupabaseTable<Profile>;
      people: SupabaseTable<Person>;
      categories: SupabaseTable<Category>;
      accounts_payable: SupabaseTable<AccountPayable>;
      income_sources: SupabaseTable<IncomeSource>;
      credit_cards: SupabaseTable<CreditCard>;
      credit_card_invoices: SupabaseTable<CreditCardInvoice>;
      credit_card_transactions: SupabaseTable<CreditCardTransaction>;
      reimbursements: SupabaseTable<Reimbursement>;
      installments: SupabaseTable<Installment>;
      payment_plans: SupabaseTable<PaymentPlan>;
      payment_plan_items: SupabaseTable<PaymentPlanItem>;
      planned_purchases: SupabaseTable<PlannedPurchase>;
      goals: SupabaseTable<Goal>;
      notes: SupabaseTable<Note>;
      import_batches: SupabaseTable<ImportBatch>;
      import_rows: SupabaseTable<ImportRow>;
    };
    Views: Record<string, never>;
    Functions: {
      create_default_categories_for_current_user: {
        Args: Record<string, never>;
        Returns: void;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
