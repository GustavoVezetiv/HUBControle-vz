import type { AppSupabaseClient } from "@/features/shared/types";
import type { Goal } from "@/lib/supabase/types";

export type GoalFormValues = {
  name: string;
  goal_type: string;
  goal_category: string;
  goal_kind: string;
  target_amount: string;
  current_amount: string;
  manual_progress_percent: string;
  start_date: string;
  target_date: string;
  monthly_contribution: string;
  status: string;
  notes: string;
};

export const emptyGoalForm: GoalFormValues = {
  name: "",
  goal_type: "personal",
  goal_category: "personal",
  goal_kind: "qualitative",
  target_amount: "",
  current_amount: "",
  manual_progress_percent: "",
  start_date: "",
  target_date: "",
  monthly_contribution: "",
  status: "active",
  notes: "",
};

export function goalToFormValues(goal: Goal): GoalFormValues {
  return {
    name: goal.name,
    goal_type: goal.goal_type,
    goal_category: goal.goal_category ?? goal.goal_type ?? "personal",
    goal_kind: goal.goal_kind ?? "qualitative",
    target_amount: goal.target_amount === null ? "" : String(goal.target_amount),
    current_amount: goal.current_amount === null ? "" : String(goal.current_amount),
    manual_progress_percent: goal.manual_progress_percent === null ? "" : String(goal.manual_progress_percent),
    start_date: goal.start_date ?? "",
    target_date: goal.target_date ?? "",
    monthly_contribution: goal.monthly_contribution === null ? "" : String(goal.monthly_contribution),
    status: goal.status,
    notes: goal.notes ?? "",
  };
}

export async function listGoals(client: AppSupabaseClient) {
  return client.from("goals").select("*").order("target_date", { ascending: true });
}

export async function listGoalCategories(client: AppSupabaseClient) {
  return client.from("categories").select("id,name,type,color,icon").eq("is_active", true).order("name");
}

export async function createGoal(client: AppSupabaseClient, userId: string, values: GoalFormValues) {
  return client.from("goals").insert(toPayload(userId, values)).select("*").single();
}

export async function updateGoal(client: AppSupabaseClient, id: string, values: GoalFormValues) {
  return client.from("goals").update(toPayload(undefined, values)).eq("id", id).select("*").single();
}

export async function deleteGoal(client: AppSupabaseClient, id: string) {
  return client.from("goals").delete().eq("id", id);
}

function toPayload(userId: string | undefined, values: GoalFormValues): Partial<Goal> {
  const isFinancial = values.goal_kind === "financial";
  return {
    ...(userId ? { user_id: userId } : {}),
    name: values.name.trim(),
    goal_type: values.goal_category,
    goal_category: values.goal_category,
    goal_kind: values.goal_kind,
    target_amount: isFinancial ? optionalNumber(values.target_amount) : null,
    current_amount: isFinancial ? optionalNumber(values.current_amount) : null,
    manual_progress_percent: null,
    start_date: values.start_date || null,
    target_date: values.target_date || null,
    monthly_contribution: isFinancial ? optionalNumber(values.monthly_contribution) : null,
    urgency_level: calculateUrgency(values.target_date),
    status: values.status,
    notes: values.notes.trim() || null,
  };
}

function optionalNumber(value: string) {
  const trimmed = value.trim();
  return trimmed ? Number(trimmed) : null;
}

function calculateUrgency(targetDate: string) {
  if (!targetDate) return "no_target";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${targetDate}T00:00:00`);
  const days = Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
  if (days < 0 || days <= 7) return "urgent";
  if (days <= 30) return "attention";
  return "comfortable";
}
