export type NavigationItem = {
  label: string;
  href: string;
  badge?: string;
};

export const navigationItems: NavigationItem[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Contas", href: "/dashboard/accounts" },
  { label: "Receitas", href: "/dashboard/income" },
  { label: "Pessoas", href: "/dashboard/people" },
  { label: "Categorias", href: "/dashboard/categories" },
  { label: "Cartões", href: "/dashboard/cards" },
  { label: "Faturas", href: "/dashboard/invoices" },
  { label: "Reembolsos", href: "/dashboard/reimbursements", badge: "chave" },
  { label: "Parcelamentos", href: "/dashboard/installments" },
  { label: "Fluxo de caixa", href: "/dashboard/cash-flow" },
  { label: "Plano de pagamento", href: "/dashboard/payment-plans" },
  { label: "Revisão semanal", href: "/dashboard/weekly-review" },
  { label: "Compras e desejos", href: "/dashboard/purchases" },
  { label: "Roles e lugares", href: "/dashboard/places" },
  { label: "Metas", href: "/dashboard/goals" },
  { label: "Diagnóstico financeiro", href: "/dashboard/diagnostics" },
  { label: "Histórico", href: "/dashboard/history" },
  { label: "Arquivados", href: "/dashboard/archived" },
  { label: "Importações", href: "/dashboard/imports" },
  { label: "Anotações", href: "/dashboard/notes" },
  { label: "Configurações", href: "/dashboard/settings" },
];
