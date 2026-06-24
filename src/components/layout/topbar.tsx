"use client";

import Link from "next/link";
import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ThemeToggle } from "@/components/layout/theme-toggle";
import type { NavigationGroup, NavigationGroupId } from "@/lib/navigation";
import { createClient } from "@/lib/supabase/client";

type TopbarProps = {
  groups: NavigationGroup[];
  userEmail?: string | null;
  collapsed: boolean;
  openGroups: NavigationGroupId[];
  onToggleCollapsed: () => void;
  onToggleGroup: (groupId: NavigationGroupId) => void;
  onOpenMobileSidebar: () => void;
};

export function Topbar({
  groups,
  userEmail,
  collapsed,
  openGroups,
  onToggleCollapsed,
  onToggleGroup,
  onOpenMobileSidebar,
}: TopbarProps) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);

    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/login");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <header className="hub-topbar sticky top-0 z-20 border-b backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpenMobileSidebar}
            className="hub-action hub-action-secondary inline-flex rounded-md border px-2 py-2 text-ink-700 lg:hidden dark:text-slate-200"
            aria-label="Abrir menu"
          >
            <Menu className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="hub-action hub-action-secondary hidden rounded-md border px-2 py-2 text-ink-700 lg:inline-flex dark:text-slate-200"
            aria-label={collapsed ? "Expandir barra lateral" : "Recolher barra lateral"}
            title={collapsed ? "Expandir barra lateral" : "Recolher barra lateral"}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-mint-600 lg:hidden">Hub VZ</p>
            <p className="truncate text-sm font-medium text-ink-600 dark:text-slate-300">
              {userEmail ? `Conectado como ${userEmail}` : "Sessão protegida"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          {userEmail ? (
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="hub-action hub-action-secondary rounded-md border px-3 py-2 text-sm font-semibold transition hover:border-danger-600 hover:text-danger-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loggingOut ? "Saindo..." : "Sair"}
            </button>
          ) : (
            <Link
              href="/login"
              className="hub-action hub-action-secondary rounded-md border px-3 py-2 text-sm font-semibold transition hover:border-mint-500 hover:text-mint-600"
            >
              Login
            </Link>
          )}
        </div>
      </div>

      <div className="overflow-x-auto px-4 pb-3 sm:px-6 lg:hidden">
        <div className="flex gap-2">
          {groups.map((group) => {
            const isOpen = openGroups.includes(group.id);
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => onToggleGroup(group.id)}
                className={`hub-filter-chip whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${isOpen ? "hub-filter-chip-active" : ""}`}
              >
                {group.label}
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
}
