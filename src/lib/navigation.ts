export type NavigationIcon =
  | "dashboard"
  | "accounts"
  | "income"
  | "cards"
  | "invoices"
  | "reimbursements"
  | "installments"
  | "cash-flow"
  | "payment-plans"
  | "purchases"
  | "goals"
  | "weekly-review"
  | "notes"
  | "places"
  | "categories"
  | "people"
  | "diagnostics"
  | "history"
  | "archived"
  | "imports"
  | "settings";

export type NavigationItem = {
  label: string;
  href: string;
  icon: NavigationIcon;
  badge?: string;
};

export type NavigationGroupId =
  | "financial"
  | "planning"
  | "routine"
  | "leisure"
  | "system";

export type NavigationGroup = {
  id: NavigationGroupId;
  label: string;
  items: NavigationItem[];
};

export const navigationGroups: NavigationGroup[] = [
  {
    id: "financial",
    label: "Financeiro",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
      { label: "Contas", href: "/dashboard/accounts", icon: "accounts" },
      { label: "Receitas", href: "/dashboard/income", icon: "income" },
      { label: "Cartões", href: "/dashboard/cards", icon: "cards" },
      { label: "Faturas", href: "/dashboard/invoices", icon: "invoices" },
      { label: "Reembolsos", href: "/dashboard/reimbursements", icon: "reimbursements", badge: "chave" },
      { label: "Parcelamentos", href: "/dashboard/installments", icon: "installments" },
      { label: "Fluxo de caixa", href: "/dashboard/cash-flow", icon: "cash-flow" },
      { label: "Plano de pagamento", href: "/dashboard/payment-plans", icon: "payment-plans" },
    ],
  },
  {
    id: "planning",
    label: "Planejamento",
    items: [
      { label: "Compras e desejos", href: "/dashboard/purchases", icon: "purchases" },
      { label: "Metas", href: "/dashboard/goals", icon: "goals" },
    ],
  },
  {
    id: "routine",
    label: "Rotina e pessoal",
    items: [
      { label: "Revisão semanal", href: "/dashboard/weekly-review", icon: "weekly-review" },
      { label: "Anotações", href: "/dashboard/notes", icon: "notes" },
    ],
  },
  {
    id: "leisure",
    label: "Lazer e lugares",
    items: [{ label: "Roles e lugares", href: "/dashboard/places", icon: "places" }],
  },
  {
    id: "system",
    label: "Sistema",
    items: [
      { label: "Categorias", href: "/dashboard/categories", icon: "categories" },
      { label: "Pessoas", href: "/dashboard/people", icon: "people" },
      { label: "Diagnóstico financeiro", href: "/dashboard/diagnostics", icon: "diagnostics" },
      { label: "Histórico", href: "/dashboard/history", icon: "history" },
      { label: "Arquivados", href: "/dashboard/archived", icon: "archived" },
      { label: "Importações", href: "/dashboard/imports", icon: "imports" },
      { label: "Configurações", href: "/dashboard/settings", icon: "settings" },
    ],
  },
];

export const navigationItems: NavigationItem[] = navigationGroups.flatMap((group) => group.items);

export function getActiveNavigationGroup(pathname: string) {
  return navigationGroups.find((group) =>
    group.items.some((item) =>
      item.href === "/dashboard"
        ? pathname === item.href
        : pathname === item.href || pathname.startsWith(`${item.href}/`),
    ),
  );
}
