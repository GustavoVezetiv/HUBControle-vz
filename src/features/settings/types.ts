import type { Profile } from "@/lib/supabase/types";

export type ProfileRow = Profile;

export type VisualStyle = "classic" | "modern" | "glass" | "colorful" | "compact" | "creative";
export type InterfaceDensity = "compact" | "standard" | "comfortable";
export type CategoryBadgeStyle = "solid" | "soft" | "outline";
export type ContentWidth = "compact" | "standard" | "wide" | "full";
export type AnimationLevel = "off" | "soft" | "modern" | "flashy";
export type CardEffect = "normal" | "lifted_hover" | "soft_glow" | "strong_glow";
export type BorderStyle = "subtle" | "medium" | "rounded";
export type SurfaceRadius = BorderStyle;

export type SettingsFormValues = {
  display_name: string;
  currency: string;
  timezone: string;
  month_start_day: string;
  allow_quick_table_edit: boolean;
  visual_style: VisualStyle;
  interface_density: InterfaceDensity;
  category_badge_style: CategoryBadgeStyle;
  content_width: ContentWidth;
  animation_level: AnimationLevel;
  card_effect: CardEffect;
  border_style: BorderStyle;
  animations_enabled: boolean;
  interactive_cards_enabled: boolean;
  card_glow_enabled: boolean;
  surface_radius: SurfaceRadius;
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
  { value: "modern", label: "Moderno", description: "Mais contraste, sombras limpas e interação visível." },
  { value: "glass", label: "Glass", description: "Superfícies translúcidas e leves." },
  { value: "colorful", label: "Colorido", description: "Mais destaque em cards e bordas." },
  { value: "compact", label: "Compacto", description: "Visual mais denso para uso diário." },
  { value: "creative", label: "Criativo", description: "Destaques visuais mais expressivos." },
];

export const interfaceDensityOptions: Array<{ value: InterfaceDensity; label: string }> = [
  { value: "compact", label: "Compacta" },
  { value: "standard", label: "Padrão" },
  { value: "comfortable", label: "Confortável" },
];

export const categoryBadgeStyleOptions: Array<{ value: CategoryBadgeStyle; label: string }> = [
  { value: "solid", label: "Sólido" },
  { value: "soft", label: "Suave" },
  { value: "outline", label: "Contorno" },
];

export const contentWidthOptions: Array<{ value: ContentWidth; label: string; description: string }> = [
  { value: "compact", label: "Compacta", description: "Conteúdo mais estreito para leitura focada." },
  { value: "standard", label: "Padrão", description: "Largura equilibrada para uso geral." },
  { value: "wide", label: "Ampla", description: "Mais espaço para tabelas e cards." },
  { value: "full", label: "Tela cheia", description: "Usa quase toda a largura disponível." },
];

export const animationLevelOptions: Array<{ value: AnimationLevel; label: string; description: string }> = [
  { value: "off", label: "Desligadas", description: "Remove transições e animações." },
  { value: "soft", label: "Suaves", description: "Transições discretas e rápidas." },
  { value: "modern", label: "Modernas", description: "Movimento mais perceptível em cards, filtros e modais." },
  { value: "flashy", label: "Chamativas", description: "Destaques mais fortes, ainda sem efeitos pesados." },
];

export const cardEffectOptions: Array<{ value: CardEffect; label: string }> = [
  { value: "normal", label: "Normal" },
  { value: "lifted_hover", label: "Hover elevado" },
  { value: "soft_glow", label: "Brilho sutil" },
  { value: "strong_glow", label: "Brilho forte" },
];

export const borderStyleOptions: Array<{ value: BorderStyle; label: string }> = [
  { value: "subtle", label: "Discretas" },
  { value: "medium", label: "Médias" },
  { value: "rounded", label: "Arredondadas" },
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
    content_width: normalizeContentWidth(profile?.content_width),
    animation_level: normalizeAnimationLevel(profile?.animation_level, profile?.animations_enabled),
    card_effect: normalizeCardEffect(profile?.card_effect, profile?.interactive_cards_enabled, profile?.card_glow_enabled),
    border_style: normalizeBorderStyle(profile?.border_style ?? profile?.surface_radius),
    animations_enabled: profile?.animations_enabled ?? true,
    interactive_cards_enabled: profile?.interactive_cards_enabled ?? true,
    card_glow_enabled: profile?.card_glow_enabled ?? false,
    surface_radius: normalizeSurfaceRadius(profile?.surface_radius),
  };
}

export function normalizeVisualStyle(value: string | null | undefined): VisualStyle {
  if (value === "minimal") return "modern";
  return visualStyleOptions.some((option) => option.value === value) ? (value as VisualStyle) : "classic";
}

export function normalizeInterfaceDensity(value: string | null | undefined): InterfaceDensity {
  if (value === "compact" || value === "comfortable") return value;
  return "standard";
}

export function normalizeCategoryBadgeStyle(value: string | null | undefined): CategoryBadgeStyle {
  return categoryBadgeStyleOptions.some((option) => option.value === value) ? (value as CategoryBadgeStyle) : "solid";
}

export function normalizeContentWidth(value: string | null | undefined): ContentWidth {
  return contentWidthOptions.some((option) => option.value === value) ? (value as ContentWidth) : "standard";
}

export function normalizeAnimationLevel(value: string | null | undefined, legacyEnabled?: boolean | null): AnimationLevel {
  if (animationLevelOptions.some((option) => option.value === value)) return value as AnimationLevel;
  return legacyEnabled === false ? "off" : "soft";
}

export function normalizeCardEffect(
  value: string | null | undefined,
  legacyInteractive?: boolean | null,
  legacyGlow?: boolean | null,
): CardEffect {
  if (cardEffectOptions.some((option) => option.value === value)) return value as CardEffect;
  if (legacyGlow) return "soft_glow";
  if (legacyInteractive === false) return "normal";
  return "normal";
}

export function normalizeBorderStyle(value: string | null | undefined): BorderStyle {
  if (value === "soft") return "subtle";
  return borderStyleOptions.some((option) => option.value === value) ? (value as BorderStyle) : "medium";
}

export function normalizeSurfaceRadius(value: string | null | undefined): SurfaceRadius {
  return normalizeBorderStyle(value);
}
