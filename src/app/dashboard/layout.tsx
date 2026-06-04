import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import {
  normalizeCategoryBadgeStyle,
  normalizeContentWidth,
  normalizeInterfaceDensity,
  normalizeSurfaceRadius,
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
    .select("visual_style,interface_density,category_badge_style,content_width,animations_enabled,interactive_cards_enabled,card_glow_enabled,surface_radius")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <AppShell
      userEmail={user.email ?? null}
      visualStyle={normalizeVisualStyle(profile?.visual_style)}
      density={normalizeInterfaceDensity(profile?.interface_density)}
      categoryBadgeStyle={normalizeCategoryBadgeStyle(profile?.category_badge_style)}
      contentWidth={normalizeContentWidth(profile?.content_width)}
      animationsEnabled={profile?.animations_enabled ?? true}
      interactiveCardsEnabled={profile?.interactive_cards_enabled ?? true}
      cardGlowEnabled={profile?.card_glow_enabled ?? false}
      surfaceRadius={normalizeSurfaceRadius(profile?.surface_radius)}
    >
      {children}
    </AppShell>
  );
}
