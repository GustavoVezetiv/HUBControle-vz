import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import {
  normalizeCategoryBadgeStyle,
  normalizeAnimationLevel,
  normalizeBorderStyle,
  normalizeCardEffect,
  normalizeContentWidth,
  normalizeInterfaceDensity,
  normalizeVisualStyle,
} from "@/features/settings/types";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <ProtectedDashboardLayout>{children}</ProtectedDashboardLayout>;
}

async function ProtectedDashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  if (!supabase) {
    redirect("/login");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("visual_style,interface_density,category_badge_style,content_width,animation_level,card_effect,border_style,animations_enabled,interactive_cards_enabled,card_glow_enabled,surface_radius")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <AppShell
      userEmail={user.email ?? null}
      visualStyle={normalizeVisualStyle(profile?.visual_style)}
      density={normalizeInterfaceDensity(profile?.interface_density)}
      categoryBadgeStyle={normalizeCategoryBadgeStyle(profile?.category_badge_style)}
      contentWidth={normalizeContentWidth(profile?.content_width)}
      animationLevel={normalizeAnimationLevel(profile?.animation_level, profile?.animations_enabled)}
      cardEffect={normalizeCardEffect(profile?.card_effect, profile?.interactive_cards_enabled, profile?.card_glow_enabled)}
      borderStyle={normalizeBorderStyle(profile?.border_style ?? profile?.surface_radius)}
    >
      {children}
    </AppShell>
  );
}
