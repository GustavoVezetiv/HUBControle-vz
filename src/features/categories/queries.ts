import type { CategoryFormValues, CategoryRow } from "@/features/categories/types";
import { defaultScopesForCategoryType, normalizeCategoryScope, type CategoryScope } from "@/features/categories/scopes";
import type { AppSupabaseClient } from "@/features/shared/types";

export async function listCategories(client: AppSupabaseClient) {
  return client.from("categories").select("*").order("name", { ascending: true });
}

export async function createCategory(
  client: AppSupabaseClient,
  userId: string,
  values: CategoryFormValues,
) {
  return client.from("categories").insert(toPayload(userId, values)).select("*").single();
}

export async function updateCategory(
  client: AppSupabaseClient,
  id: string,
  values: CategoryFormValues,
) {
  return client
    .from("categories")
    .update(toPayload(undefined, values))
    .eq("id", id)
    .select("*")
    .single();
}

export async function deleteCategory(client: AppSupabaseClient, id: string) {
  return client.from("categories").delete().eq("id", id);
}

export async function createDefaultCategories(client: AppSupabaseClient) {
  return client.rpc("create_default_categories_for_current_user");
}

function toPayload(userId: string | undefined, values: CategoryFormValues): Partial<CategoryRow> {
  const normalizedScopes = values.scopes
    .map((scope) => normalizeCategoryScope(scope))
    .filter((scope): scope is CategoryScope => Boolean(scope));

  return {
    ...(userId ? { user_id: userId } : {}),
    name: values.name.trim(),
    type: values.type,
    color: values.color.trim() || null,
    icon: values.icon.trim() || null,
    scopes: normalizedScopes.length > 0 ? normalizedScopes : defaultScopesForCategoryType(values.type),
    is_default: values.is_default,
    is_active: values.is_active,
  };
}
