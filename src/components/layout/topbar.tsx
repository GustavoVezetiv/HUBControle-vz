"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { ThemeToggle } from "@/components/layout/theme-toggle";
import type { NavigationItem } from "@/lib/navigation";
import { createClient } from "@/lib/supabase/client";

type TopbarProps = {
  items: NavigationItem[];
  userEmail?: string | null;
};

export function Topbar({ items, userEmail }: TopbarProps) {
  const pathname = usePathname();
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
    <header className="sticky top-0 z-20 border-b border-ink-950/10 bg-white/86 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-mint-600 lg:hidden">
            Hub VZ
          </p>
          <p className="truncate text-sm font-medium text-ink-600">
            {userEmail ? `Conectado como ${userEmail}` : "Sessão protegida"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          {userEmail ? (
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="hub-action hub-action-secondary rounded-md border border-ink-950/10 bg-white px-3 py-2 text-sm font-semibold text-ink-950 transition hover:border-danger-600 hover:text-danger-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loggingOut ? "Saindo..." : "Sair"}
            </button>
          ) : (
            <Link
              href="/login"
              className="hub-action hub-action-secondary rounded-md border border-ink-950/10 bg-white px-3 py-2 text-sm font-semibold text-ink-950 transition hover:border-mint-500 hover:text-mint-600"
            >
              Login
            </Link>
          )}
        </div>
      </div>

      <nav
        className="flex gap-2 overflow-x-auto px-4 pb-3 sm:px-6 lg:hidden"
        aria-label="Navegação mobile"
      >
        {items.map((item) => {
          const active = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium",
                active ? "bg-ink-950 text-white" : "bg-ink-950/5 text-ink-600",
              ].join(" ")}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
