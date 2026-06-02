import type { Profile } from "@/lib/supabase/types";

export type ProfileRow = Profile;

export type VisualStyle = "classic" | "minimal" | "colorful" | "glass" | "compact" | "creative";
export type InterfaceDensity = "comfortable" | "compact";
export type CategoryBadgeStyle = "solid" | "soft" | "outline" | "creative_pill";

export type SettingsFormValues = {
  display_name: string;
  currency: string;
  timezone: string;
  month_start_day: string;
  allow_quick_table_edit: boolean;
  visual_style: VisualStyle;
  interface_density: InterfaceDensity;
  category_badge_style: CategoryBadgeStyle;
};

export const currencyOptions = [
  { value: "BRL", label: "Real brasileiro (BRL)" },
  { value: "USD", label: "Dólar americano (USD)" },
  { value: "EUR", label: "Euro (EUR)" },
];

export const timezoneOptions = [
  { value: "America/Cuiaba", label: "America/Cuiaba" },
  { value: "America/Sao_Paulo", label: "America/Sao_Paulo" },
  { value: "America/Manaus", label: "America/Manaus" },
  { value: "America/Fortaleza", label: "America/Fortaleza" },
];

export const visualStyleOptions: Array<{ value: VisualStyle; label: string; description: string }> = [
  { value: "classic", label: "Clássico", description: "Visual atual, equilibrado e direto." },
  { value: "minimal", label: "Minimalista", description: "Menos sombra, menos ruído visual." },
  { value: "colorful", label: "Colorido", description: "Mais destaque em cards e bordas." },
  { value: "glass", label: "Glass", description: "Superfícies translúcidas e leves." },
  { value: "compact", label: "Compacto", description: "Visual mais denso para uso diário." },
  { value: "creative", label: "Criativo", description: "Destaques visuais mais expressivos." },
];

export const interfaceDensityOptions: Array<{ value: InterfaceDensity; label: string }> = [
  { value: "comfortable", label: "Confortável" },
  { value: "compact", label: "Compacta" },
];

export const categoryBadgeStyleOptions: Array<{ value: CategoryBadgeStyle; label: string }> = [
  { value: "solid", label: "Sólido" },
  { value: "soft", label: "Suave" },
  { value: "outline", label: "Contorno" },
  { value: "creative_pill", label: "Pill criativo" },
];

export function profileToFormValues(profile: ProfileRow | null): SettingsFormValues {
  return {
    display_name: profile?.display_name ?? "",
    currency: profile?.currency ?? "BRL",
    timezone: profile?.timezone ?? "America/Cuiaba",
    month_start_day: String(profile?.month_start_day ?? 1),
    allow_quick_table_edit: profile?.allow_quick_table_edit ?? false,
    visual_style: normalizeVisualStyle(profile?.visual_style),
    interface_density: normalizeInterfaceDensity(profile?.interface_density),
    category_badge_style: normalizeCategoryBadgeStyle(profile?.category_badge_style),
  };
}

export function normalizeVisualStyle(value: string | null | undefined): VisualStyle {
  return visualStyleOptions.some((option) => option.value === value) ? (value as VisualStyle) : "classic";
}

export function normalizeInterfaceDensity(value: string | null | undefined): InterfaceDensity {
  return value === "compact" ? "compact" : "comfortable";
}

export function normalizeCategoryBadgeStyle(value: string | null | undefined): CategoryBadgeStyle {
  return categoryBadgeStyleOptions.some((option) => option.value === value) ? (value as CategoryBadgeStyle) : "solid";
}
