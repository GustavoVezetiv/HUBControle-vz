import type { AppSupabaseClient } from "@/features/shared/types";

export async function getQuickTableEditPreference(client: AppSupabaseClient, userId: string) {
  const { data, error } = await client
    .from("profiles")
    .select("allow_quick_table_edit")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("Erro técnico ao carregar preferência de edição rápida:", error);
    return false;
  }

  return Boolean(data?.allow_quick_table_edit);
}
