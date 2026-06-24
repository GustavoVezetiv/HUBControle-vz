"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { getActiveNavigationGroup, navigationGroups, type NavigationGroupId } from "@/lib/navigation";

type AppShellProps = {
  children: React.ReactNode;
  userEmail?: string | null;
  visualStyle?: string;
  density?: string;
  categoryBadgeStyle?: string;
  contentWidth?: string;
  animationLevel?: string;
  cardEffect?: string;
  borderStyle?: string;
};

type NavigationPreferences = {
  collapsed: boolean;
  openGroups: NavigationGroupId[];
};

export function AppShell({
  children,
  userEmail,
  visualStyle = "classic",
  density = "comfortable",
  categoryBadgeStyle = "solid",
  contentWidth = "standard",
  animationLevel = "soft",
  cardEffect = "normal",
  borderStyle = "medium",
}: AppShellProps) {
  const pathname = usePathname();
  const activeGroupId = getActiveNavigationGroup(pathname)?.id ?? "financial";
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<NavigationGroupId[]>([activeGroupId]);

  const contentWidthClass =
    contentWidth === "compact"
      ? "max-w-6xl"
      : contentWidth === "wide"
        ? "max-w-[96rem]"
        : contentWidth === "full"
          ? "max-w-none"
          : "max-w-7xl";

  const storageKey = useMemo(
    () => (userEmail ? `hubvz:sidebar-preferences:${userEmail}` : "hubvz:sidebar-preferences"),
    [userEmail],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        setOpenGroups([activeGroupId]);
        return;
      }

      const parsed = JSON.parse(raw) as Partial<NavigationPreferences>;
      const nextOpenGroups = Array.isArray(parsed.openGroups)
        ? parsed.openGroups.filter((value): value is NavigationGroupId => navigationGroups.some((group) => group.id === value))
        : [];

      setSidebarCollapsed(Boolean(parsed.collapsed));
      setOpenGroups(nextOpenGroups.length > 0 ? Array.from(new Set([...nextOpenGroups, activeGroupId])) : [activeGroupId]);
    } catch (error) {
      console.error("Erro técnico ao carregar preferências da sidebar:", error);
      setOpenGroups([activeGroupId]);
    }
  }, [activeGroupId, storageKey]);

  useEffect(() => {
    setOpenGroups((current) => (current.includes(activeGroupId) ? current : [...current, activeGroupId]));
  }, [activeGroupId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const payload: NavigationPreferences = {
        collapsed: sidebarCollapsed,
        openGroups,
      };
      window.localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch (error) {
      console.error("Erro técnico ao salvar preferências da sidebar:", error);
    }
  }, [openGroups, sidebarCollapsed, storageKey]);

  function toggleGroup(groupId: NavigationGroupId) {
    setOpenGroups((current) =>
      current.includes(groupId) ? current.filter((value) => value !== groupId) : [...current, groupId],
    );
  }

  return (
    <div
      className="hub-shell min-h-screen lg:flex"
      data-visual-style={visualStyle}
      data-density={density}
      data-category-badge-style={categoryBadgeStyle}
      data-content-width={contentWidth}
      data-animation-level={animationLevel}
      data-animations={animationLevel === "off" ? "off" : "on"}
      data-card-effect={cardEffect}
      data-interactive-cards={cardEffect === "normal" ? "off" : "on"}
      data-card-glow={cardEffect === "soft_glow" || cardEffect === "strong_glow" ? "on" : "off"}
      data-border-style={borderStyle}
      data-surface-radius={borderStyle}
      data-sidebar-collapsed={sidebarCollapsed ? "true" : "false"}
    >
      <Sidebar
        groups={navigationGroups}
        collapsed={sidebarCollapsed}
        mobileOpen={mobileSidebarOpen}
        openGroups={openGroups}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
        onToggleGroup={toggleGroup}
      />
      <div className="min-w-0 flex-1">
        <Topbar
          groups={navigationGroups}
          userEmail={userEmail}
          collapsed={sidebarCollapsed}
          openGroups={openGroups}
          onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
          onToggleGroup={toggleGroup}
          onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
        />
        <main className={`mx-auto w-full ${contentWidthClass} px-4 py-5 sm:px-6 lg:px-8 lg:py-8`}>
          {children}
        </main>
      </div>
    </div>
  );
}
