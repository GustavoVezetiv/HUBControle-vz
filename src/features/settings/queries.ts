import type { SettingsFormValues } from "@/features/settings/types";
import type { AiUserPreferences } from "@/features/ai/preferences";
import type { AppSupabaseClient } from "@/features/shared/types";
import type { Profile } from "@/lib/supabase/types";
import { aiPreferencesToJson } from "@/features/ai/preferences";

export async function getProfile(client: AppSupabaseClient, userId: string) {
  return client.from("profiles").select("*").eq("id", userId).maybeSingle();
}

export async function upsertProfile(
  client: AppSupabaseClient,
  userId: string,
  values: SettingsFormValues,
  aiPreferences: AiUserPreferences,
) {
  const payload: Partial<Profile> = {
    id: userId,
    user_id: userId,
    display_name: values.display_name.trim() || null,
    currency: values.currency,
    timezone: values.timezone,
    month_start_day: Number(values.month_start_day || 1),
    allow_quick_table_edit: values.allow_quick_table_edit,
    visual_style: values.visual_style,
    interface_density: values.interface_density,
    category_badge_style: values.category_badge_style,
    content_width: values.content_width,
    animation_level: values.animation_level,
    card_effect: values.card_effect,
    border_style: values.border_style,
    animations_enabled: values.animation_level !== "off",
    interactive_cards_enabled: values.card_effect !== "normal",
    card_glow_enabled: values.card_effect === "soft_glow" || values.card_effect === "strong_glow",
    surface_radius: values.border_style,
    ai_preferences: aiPreferencesToJson(aiPreferences),
  };

  return client.from("profiles").upsert(payload).select("*").single();
}
