import type { AppSupabaseClient } from "@/features/shared/types";
import type { Goal } from "@/lib/supabase/types";

export type GoalFormValues = {
  name: string;
  goal_type: string;
  target_amount: string;
  current_amount: string;
  target_date: string;
  monthly_contribution: string;
  status: string;
  notes: string;
};

export const emptyGoalForm: GoalFormValues = {
  name: "",
  goal_type: "other",
  target_amount: "0",
  current_amount: "0",
  target_date: "",
  monthly_contribution: "0",
  status: "active",
  notes: "",
};

export function goalToFormValues(goal: Goal): GoalFormValues {
  return {
    name: goal.name,
    goal_type: goal.goal_type,
    target_amount: String(goal.target_amount),
    current_amount: String(goal.current_amount),
    target_date: goal.target_date ?? "",
    monthly_contribution: String(goal.monthly_contribution),
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
  return {
    ...(userId ? { user_id: userId } : {}),
    name: values.name.trim(),
    goal_type: values.goal_type,
    target_amount: Number(values.target_amount || 0),
    current_amount: Number(values.current_amount || 0),
    target_date: values.target_date || null,
    monthly_contribution: Number(values.monthly_contribution || 0),
    status: values.status,
    notes: values.notes.trim() || null,
  };
}
