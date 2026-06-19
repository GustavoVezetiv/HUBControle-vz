import type { Category } from "@/lib/supabase/types";

export type CategoryFormValues = {
  name: string;
  type: string;
  color: string;
  icon: string;
  scopes: string[];
  is_default: boolean;
  is_active: boolean;
};

export type CategoryRow = Category;

export const emptyCategoryForm: CategoryFormValues = {
  name: "",
  type: "expense",
  color: "#18b98f",
  icon: "",
  scopes: ["expense"],
  is_default: false,
  is_active: true,
};

export function categoryToFormValues(category: CategoryRow): CategoryFormValues {
  return {
    name: category.name,
    type: category.type,
    color: category.color ?? "#18b98f",
    icon: category.icon ?? "",
    scopes: category.scopes ?? [],
    is_default: category.is_default,
    is_active: category.is_active,
  };
}
