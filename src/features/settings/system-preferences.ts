"use client";

import { clearViewPreference, loadViewPreference, saveViewPreference, type ViewPreferenceRecord } from "@/features/shared/view-preferences";

export type InitialScreenRoute =
  | "/dashboard"
  | "/dashboard/weekly-review"
  | "/dashboard/invoices"
  | "/dashboard/reimbursements"
  | "/dashboard/purchases"
  | "/dashboard/goals"
  | "/dashboard/diagnostics";

export type WeeklyReviewDefaultTab = "summary" | "completed" | "priorities" | "pending" | "kanban" | "month";
export type ShortcutId =
  | "new-account"
  | "new-income"
  | "new-reimbursement"
  | "new-purchase"
  | "new-goal"
  | "new-place"
  | "sync-google-tasks"
  | "generate-weekly-analysis"
  | "financial-diagnostics"
  | "export-backup";

export type ModuleViewMode = "list" | "kanban";
export type DashboardMode = "simple" | "full";

export type SystemPreferences = {
  initialScreen: InitialScreenRoute;
  weeklyReviewDefaultTab: WeeklyReviewDefaultTab;
  favoriteShortcuts: ShortcutId[];
  goalViewMode: ModuleViewMode;
  purchaseViewMode: ModuleViewMode;
  placeViewMode: ModuleViewMode;
  dashboardMode: DashboardMode;
};

export const initialScreenOptions: Array<{ value: InitialScreenRoute; label: string }> = [
  { value: "/dashboard", label: "Dashboard" },
  { value: "/dashboard/weekly-review", label: "Revisão semanal" },
  { value: "/dashboard/invoices", label: "Faturas" },
  { value: "/dashboard/reimbursements", label: "Reembolsos" },
  { value: "/dashboard/purchases", label: "Compras e desejos" },
  { value: "/dashboard/goals", label: "Metas" },
  { value: "/dashboard/diagnostics", label: "Diagnóstico financeiro" },
];

export const weeklyReviewTabOptions: Array<{ value: WeeklyReviewDefaultTab; label: string }> = [
  { value: "summary", label: "Resumo" },
  { value: "completed", label: "Concluídas" },
  { value: "priorities", label: "Prioridades" },
  { value: "pending", label: "Pendências" },
  { value: "kanban", label: "Kanban" },
  { value: "month", label: "Mês" },
];

export const shortcutOptions: Array<{ id: ShortcutId; label: string; description: string; href: string }> = [
  { id: "new-account", label: "Nova conta", description: "Abrir Contas", href: "/dashboard/accounts" },
  { id: "new-income", label: "Nova receita", description: "Abrir Receitas", href: "/dashboard/income" },
  { id: "new-reimbursement", label: "Novo reembolso", description: "Abrir Reembolsos", href: "/dashboard/reimbursements" },
  { id: "new-purchase", label: "Nova compra", description: "Abrir Compras e desejos", href: "/dashboard/purchases" },
  { id: "new-goal", label: "Nova meta", description: "Abrir Metas", href: "/dashboard/goals" },
  { id: "new-place", label: "Novo rolê/lugar", description: "Abrir Roles e lugares", href: "/dashboard/places" },
  { id: "sync-google-tasks", label: "Sincronizar Google Tasks", description: "Abrir Revisão semanal e sincronizar", href: "/dashboard/weekly-review?action=sync" },
  { id: "generate-weekly-analysis", label: "Gerar análise semanal", description: "Abrir Revisão semanal e analisar", href: "/dashboard/weekly-review?action=analyze" },
  { id: "financial-diagnostics", label: "Diagnóstico financeiro", description: "Abrir Diagnóstico", href: "/dashboard/diagnostics" },
  { id: "export-backup", label: "Exportar backup", description: "Abrir Configurações", href: "/dashboard/settings#backup-exportacao" },
];

export const defaultSystemPreferences: SystemPreferences = {
  initialScreen: "/dashboard",
  weeklyReviewDefaultTab: "summary",
  favoriteShortcuts: [
    "new-account",
    "new-income",
    "new-reimbursement",
    "new-purchase",
    "new-goal",
    "financial-diagnostics",
  ],
  goalViewMode: "list",
  purchaseViewMode: "list",
  placeViewMode: "list",
  dashboardMode: "simple",
};

function systemPreferencesKey(userId?: string | null) {
  return userId ? `hubvz:system-preferences:${userId}` : "hubvz:system-preferences";
}

export function loadSystemPreferences(userId?: string | null): SystemPreferences {
  if (typeof window === "undefined") return defaultSystemPreferences;

  try {
    const raw = window.localStorage.getItem(systemPreferencesKey(userId));
    if (!raw) return defaultSystemPreferences;
    const parsed = JSON.parse(raw);
    return normalizeSystemPreferences(parsed);
  } catch (error) {
    console.error("Erro técnico ao carregar preferências do sistema:", error);
    return defaultSystemPreferences;
  }
}

export function saveSystemPreferences(userId: string | null | undefined, value: SystemPreferences) {
  if (typeof window === "undefined") return false;

  try {
    window.localStorage.setItem(systemPreferencesKey(userId), JSON.stringify(normalizeSystemPreferences(value)));
    return true;
  } catch (error) {
    console.error("Erro técnico ao salvar preferências do sistema:", error);
    return false;
  }
}

export function clearSystemPreferences(userId?: string | null) {
  if (typeof window === "undefined") return false;

  try {
    window.localStorage.removeItem(systemPreferencesKey(userId));
    return true;
  } catch (error) {
    console.error("Erro técnico ao restaurar preferências do sistema:", error);
    return false;
  }
}

export function applySystemViewPreferences(userId: string | null | undefined, preferences: SystemPreferences) {
  const dashboardPreference = loadViewPreference<ViewPreferenceRecord>("dashboard", userId) ?? {};
  saveViewPreference("dashboard", userId, { ...dashboardPreference, mode: preferences.dashboardMode });

  const goalsPreference = loadViewPreference<ViewPreferenceRecord>("goals", userId) ?? {};
  saveViewPreference("goals", userId, { ...goalsPreference, viewMode: preferences.goalViewMode });

  const purchasesPreference = loadViewPreference<ViewPreferenceRecord>("purchases", userId) ?? {};
  saveViewPreference("purchases", userId, { ...purchasesPreference, viewMode: preferences.purchaseViewMode });

  const placesPreference = loadViewPreference<ViewPreferenceRecord>("places", userId) ?? {};
  saveViewPreference("places", userId, { ...placesPreference, viewMode: preferences.placeViewMode });
}

export function clearSystemViewPreferences(userId: string | null | undefined) {
  clearViewPreference("dashboard", userId);
  clearViewPreference("goals", userId);
  clearViewPreference("purchases", userId);
  clearViewPreference("places", userId);
}

function normalizeSystemPreferences(value: unknown): SystemPreferences {
  const record = isRecord(value) ? value : {};
  const favoriteShortcuts = Array.isArray(record.favoriteShortcuts)
    ? record.favoriteShortcuts.filter((item): item is ShortcutId => typeof item === "string" && shortcutOptions.some((option) => option.id === item)).slice(0, 6)
    : defaultSystemPreferences.favoriteShortcuts;

  return {
    initialScreen: isInitialScreenRoute(record.initialScreen) ? record.initialScreen : defaultSystemPreferences.initialScreen,
    weeklyReviewDefaultTab: isWeeklyReviewTab(record.weeklyReviewDefaultTab)
      ? record.weeklyReviewDefaultTab
      : defaultSystemPreferences.weeklyReviewDefaultTab,
    favoriteShortcuts: favoriteShortcuts.length > 0 ? favoriteShortcuts : defaultSystemPreferences.favoriteShortcuts,
    goalViewMode: record.goalViewMode === "kanban" ? "kanban" : defaultSystemPreferences.goalViewMode,
    purchaseViewMode: record.purchaseViewMode === "kanban" ? "kanban" : defaultSystemPreferences.purchaseViewMode,
    placeViewMode: record.placeViewMode === "kanban" ? "kanban" : defaultSystemPreferences.placeViewMode,
    dashboardMode: record.dashboardMode === "full" ? "full" : defaultSystemPreferences.dashboardMode,
  };
}

function isInitialScreenRoute(value: unknown): value is InitialScreenRoute {
  return typeof value === "string" && initialScreenOptions.some((option) => option.value === value);
}

function isWeeklyReviewTab(value: unknown): value is WeeklyReviewDefaultTab {
  return typeof value === "string" && weeklyReviewTabOptions.some((option) => option.value === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
