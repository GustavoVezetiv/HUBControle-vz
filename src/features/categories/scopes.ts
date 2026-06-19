import type { SelectOption } from "@/features/shared/types";
export type CategoryScope =
  | "expense"
  | "income"
  | "reimbursement"
  | "purchase"
  | "goal"
  | "invoice"
  | "place"
  | "leisure"
  | "routine"
  | "professional"
  | "general";

export type CategoryScopeModule =
  | "accounts"
  | "income"
  | "reimbursements"
  | "purchases"
  | "goals"
  | "invoices"
  | "places";

type CategoryLike = {
  type?: string | null;
  scopes?: string[] | null;
};

export const categoryScopeOptions: SelectOption[] = [
  { value: "expense", label: "Contas e despesas" },
  { value: "income", label: "Receitas" },
  { value: "reimbursement", label: "Reembolsos" },
  { value: "purchase", label: "Compras e desejos" },
  { value: "goal", label: "Metas" },
  { value: "invoice", label: "Faturas e lançamentos" },
  { value: "place", label: "Roles e lugares" },
  { value: "leisure", label: "Lazer e experiências" },
  { value: "routine", label: "Revisão semanal" },
  { value: "professional", label: "Profissional" },
  { value: "general", label: "Geral" },
];

export const categoryScopeLabelByValue = new Map(categoryScopeOptions.map((option) => [option.value, option.label]));

export const categoryModuleDefinitions: Record<
  CategoryScopeModule,
  { label: string; scopes: CategoryScope[] }
> = {
  accounts: { label: "Contas", scopes: ["expense", "general"] },
  income: { label: "Receitas", scopes: ["income", "general"] },
  reimbursements: { label: "Reembolsos", scopes: ["reimbursement", "expense", "general"] },
  purchases: { label: "Compras e desejos", scopes: ["purchase", "general"] },
  goals: { label: "Metas", scopes: ["goal", "general"] },
  invoices: { label: "Faturas e lançamentos", scopes: ["expense", "invoice", "general"] },
  places: { label: "Roles e lugares", scopes: ["place", "leisure", "general"] },
};

const knownCategoryScopes = new Set<CategoryScope>([
  "expense",
  "income",
  "reimbursement",
  "purchase",
  "goal",
  "invoice",
  "place",
  "leisure",
  "routine",
  "professional",
  "general",
]);

const legacyTypeScopeMap: Record<string, CategoryScope[]> = {
  expense: ["expense"],
  debt: ["expense"],
  income: ["income"],
  reimbursement: ["reimbursement"],
  purchase: ["purchase"],
  planned_purchase: ["purchase"],
  goal: ["goal"],
  places: ["place"],
  leisure: ["leisure"],
  other: ["general"],
  transfer: ["general"],
  general: ["general"],
};

export function normalizeCategoryScope(value: string | null | undefined): CategoryScope | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "places") return "place";
  if (normalized === "planned_purchase" || normalized === "wishlist" || normalized === "shopping") {
    return "purchase";
  }
  return knownCategoryScopes.has(normalized as CategoryScope) ? (normalized as CategoryScope) : null;
}

export function defaultScopesForCategoryType(type: string | null | undefined): CategoryScope[] {
  const normalized = type?.trim().toLowerCase() ?? "";
  return legacyTypeScopeMap[normalized] ?? ["general"];
}

export function getCategoryScopes(category: CategoryLike | null | undefined): CategoryScope[] {
  const normalizedScopes = (category?.scopes ?? [])
    .map((scope) => normalizeCategoryScope(scope))
    .filter((scope): scope is CategoryScope => Boolean(scope));

  if (normalizedScopes.length > 0) {
    return Array.from(new Set(normalizedScopes));
  }

  return defaultScopesForCategoryType(category?.type);
}

export function categorySupportsScope(category: CategoryLike | null | undefined, scope: CategoryScope) {
  return getCategoryScopes(category).includes(scope);
}

export function categorySupportsAnyScope(
  category: CategoryLike | null | undefined,
  scopes: readonly CategoryScope[],
) {
  const currentScopes = getCategoryScopes(category);
  return scopes.some((scope) => currentScopes.includes(scope));
}

export function filterCategoriesByScopes<T extends CategoryLike>(
  categories: readonly T[],
  scopes: readonly CategoryScope[],
) {
  return categories.filter((category) => categorySupportsAnyScope(category, scopes));
}

export function isCategoryOutOfScope(
  category: CategoryLike | null | undefined,
  scopes: readonly CategoryScope[],
) {
  return category ? !categorySupportsAnyScope(category, scopes) : false;
}

export function getCategoryScopeLabels(scopes: readonly string[] | null | undefined) {
  const normalized = (scopes ?? [])
    .map((scope) => normalizeCategoryScope(scope))
    .filter((scope): scope is CategoryScope => Boolean(scope));

  if (normalized.length === 0) {
    return [categoryScopeLabelByValue.get("general") ?? "Geral"];
  }

  return Array.from(new Set(normalized)).map((scope) => categoryScopeLabelByValue.get(scope) ?? scope);
}

export function getCategoryModuleLabels(category: CategoryLike | null | undefined) {
  return Object.values(categoryModuleDefinitions)
    .filter((module) => categorySupportsAnyScope(category, module.scopes))
    .map((module) => module.label);
}
