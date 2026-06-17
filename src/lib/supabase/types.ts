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
  visual_style: string;
  interface_density: string;
  category_badge_style: string;
  content_width: string;
  animation_level: string;
  card_effect: string;
  border_style: string;
  animations_enabled: boolean;
  interactive_cards_enabled: boolean;
  card_glow_enabled: boolean;
  surface_radius: string;
  created_at: string;
  updated_at: string;
};

export type UserOwnedRow = {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
};

export type ArchiveFields = {
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;
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

export type AccountPayable = UserOwnedRow & ArchiveFields & {
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
  reimbursement_id: string | null;
  notes: string | null;
};

export type IncomeSource = UserOwnedRow & ArchiveFields & {
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
  recurrence_frequency: string | null;
  recurrence_start_date: string | null;
  recurrence_end_date: string | null;
  recurrence_parent_id: string | null;
  recurrence_generated_until: string | null;
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

export type CreditCardInvoice = UserOwnedRow & ArchiveFields & {
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

export type CreditCardTransaction = UserOwnedRow & ArchiveFields & {
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
  reimbursement_id: string | null;
  notes: string | null;
};

export type Reimbursement = UserOwnedRow & ArchiveFields & {
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
  renegotiated_into_id: string | null;
  renegotiated_at: string | null;
  renegotiation_source_ids: string[];
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

export type PlannedPurchase = UserOwnedRow & ArchiveFields & {
  category_id: string | null;
  title: string;
  description: string | null;
  estimated_amount: number;
  paid_amount: number;
  target_date: string | null;
  purchase_date: string | null;
  payment_method: string;
  credit_card_id: string | null;
  installment_count: number | null;
  decision_status: string;
  risk_level: RiskLevel;
  quantity: number | null;
  priority_rank: number | null;
  project: string | null;
  external_url: string | null;
  decision_label: string | null;
  import_source: string | null;
  import_batch_id: string | null;
  created_by: string | null;
  notes: string | null;
};

export type Goal = UserOwnedRow & ArchiveFields & {
  category_id: string | null;
  name: string;
  goal_type: string;
  goal_category: string;
  goal_kind: string;
  target_amount: number | null;
  current_amount: number | null;
  manual_progress_percent: number | null;
  target_date: string | null;
  start_date: string | null;
  category_label: string | null;
  source_label: string | null;
  import_source: string | null;
  import_batch_id: string | null;
  created_by: string | null;
  urgency_level: string;
  monthly_contribution: number | null;
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

export type DiagnosticAlertIgnore = {
  id: string;
  user_id: string;
  alert_key: string;
  alert_type: string;
  subject_type: string | null;
  subject_id: string | null;
  reason: string | null;
  created_at: string;
};

export type RoutineGoogleConnection = UserOwnedRow & {
  provider: string;
  status: string;
  scope: string;
  encrypted_access_token: string | null;
  encrypted_refresh_token: string | null;
  token_expires_at: string | null;
  connected_at: string | null;
  last_sync_at: string | null;
  last_sync_attempt_at: string | null;
  last_successful_sync_at: string | null;
  last_sync_error: string | null;
  auto_sync_enabled: boolean;
  raw_json: Json;
};

export type RoutineCategory = UserOwnedRow & {
  name: string;
  color: string | null;
  is_default: boolean;
};

export type RoutineTaskList = UserOwnedRow & {
  google_task_list_id: string;
  title: string;
  is_priority_queue: boolean;
  updated_at_google: string | null;
  last_seen_at: string;
  raw_json: Json;
};

export type RoutineTask = UserOwnedRow & {
  google_task_id: string;
  google_task_list_id: string;
  routine_task_list_id: string | null;
  title: string;
  notes: string | null;
  status: string;
  due_date: string | null;
  completed_at: string | null;
  updated_at_google: string | null;
  last_seen_at: string;
  detected_category_id: string | null;
  confirmed_category_id: string | null;
  parent_google_task_id: string | null;
  position: string | null;
  is_hidden: boolean;
  raw_json: Json;
};

export type RoutineTaskSnapshot = {
  id: string;
  user_id: string;
  routine_task_id: string;
  google_task_id: string;
  google_task_list_id: string;
  title: string;
  notes: string | null;
  status: string;
  due_date: string | null;
  completed_at: string | null;
  detected_category_id: string | null;
  confirmed_category_id: string | null;
  raw_json: Json;
  snapshot_at: string;
};

export type RoutineTaskEvent = {
  id: string;
  user_id: string;
  routine_task_id: string | null;
  google_task_id: string;
  event_type: string;
  previous_value: Json | null;
  new_value: Json | null;
  event_at: string;
  metadata: Json;
  sync_run_id: string | null;
  event_signature: string | null;
  created_at: string;
};

export type RoutineWeeklyReport = {
  id: string;
  user_id: string;
  week_start_date: string;
  week_end_date: string;
  completed_count: number;
  prioritized_count: number;
  open_count: number;
  stale_count: number;
  events_count: number;
  summary_json: Json;
  future_ai_summary: string | null;
  generated_at: string;
  created_at: string;
  updated_at: string;
};

export type RoutineAiSummary = {
  id: string;
  user_id: string;
  week_start: string;
  week_end: string;
  provider: string;
  model: string;
  input_summary_json: Json;
  summary_text: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type RoutineSyncRun = {
  id: string;
  user_id: string;
  provider: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  tasks_seen: number;
  tasks_created: number;
  tasks_updated: number;
  events_created: number;
  error_message: string | null;
  created_at: string;
};

export type AuditLog = {
  id: string;
  user_id: string;
  module: string;
  record_id: string | null;
  action: string;
  field_name: string | null;
  old_value: Json | null;
  new_value: Json | null;
  metadata: Json;
  created_at: string;
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
      diagnostic_alert_ignores: SupabaseTable<DiagnosticAlertIgnore>;
      routine_google_connections: SupabaseTable<RoutineGoogleConnection>;
      routine_categories: SupabaseTable<RoutineCategory>;
      routine_task_lists: SupabaseTable<RoutineTaskList>;
      routine_tasks: SupabaseTable<RoutineTask>;
      routine_task_snapshots: SupabaseTable<RoutineTaskSnapshot>;
      routine_task_events: SupabaseTable<RoutineTaskEvent>;
      routine_weekly_reports: SupabaseTable<RoutineWeeklyReport>;
      routine_ai_summaries: SupabaseTable<RoutineAiSummary>;
      routine_sync_runs: SupabaseTable<RoutineSyncRun>;
      audit_logs: SupabaseTable<AuditLog>;
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
