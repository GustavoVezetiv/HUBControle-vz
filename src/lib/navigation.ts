export type NavigationItem = {
  label: string;
  href: string;
  badge?: string;
};

export type NavigationGroup = {
  label: string;
  items: NavigationItem[];
};

export const navigationGroups: NavigationGroup[] = [
  {
    label: "Financeiro",
    items: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Contas", href: "/dashboard/accounts" },
      { label: "Receitas", href: "/dashboard/income" },
      { label: "Cartões", href: "/dashboard/cards" },
      { label: "Faturas", href: "/dashboard/invoices" },
      { label: "Reembolsos", href: "/dashboard/reimbursements", badge: "chave" },
      { label: "Parcelamentos", href: "/dashboard/installments" },
      { label: "Fluxo de caixa", href: "/dashboard/cash-flow" },
      { label: "Plano de pagamento", href: "/dashboard/payment-plans" },
    ],
  },
  {
    label: "Planejamento",
    items: [
      { label: "Compras e desejos", href: "/dashboard/purchases" },
      { label: "Metas", href: "/dashboard/goals" },
    ],
  },
  {
    label: "Rotina e pessoal",
    items: [
      { label: "Revisão semanal", href: "/dashboard/weekly-review" },
      { label: "Anotações", href: "/dashboard/notes" },
    ],
  },
  {
    label: "Lazer e lugares",
    items: [{ label: "Roles e lugares", href: "/dashboard/places" }],
  },
  {
    label: "Sistema",
    items: [
      { label: "Categorias", href: "/dashboard/categories" },
      { label: "Pessoas", href: "/dashboard/people" },
      { label: "Diagnóstico financeiro", href: "/dashboard/diagnostics" },
      { label: "Histórico", href: "/dashboard/history" },
      { label: "Arquivados", href: "/dashboard/archived" },
      { label: "Importações", href: "/dashboard/imports" },
      { label: "Configurações", href: "/dashboard/settings" },
    ],
  },
];

export const navigationItems: NavigationItem[] = navigationGroups.flatMap((group) => group.items);
