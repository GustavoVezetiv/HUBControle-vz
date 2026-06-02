"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { NavigationItem } from "@/lib/navigation";

type SidebarProps = {
  items: NavigationItem[];
};

export function Sidebar({ items }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="hidden min-h-screen w-72 shrink-0 border-r border-ink-950/10 bg-white/82 px-4 py-5 backdrop-blur lg:block">
      <div className="px-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-mint-600">
          Hub VZ
        </p>
        <h2 className="mt-2 text-lg font-semibold text-ink-950">Módulo financeiro</h2>
      </div>

      <nav className="mt-7 space-y-1" aria-label="Navegação principal">
        {items.map((item) => {
          const active =
            item.href === "/dashboard"
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "flex items-center justify-between rounded-md px-3 py-2.5 text-sm font-medium transition",
                active
                  ? "bg-slate-950 text-white shadow-soft"
                  : "text-ink-600 hover:bg-mint-100 hover:text-ink-950",
              ].join(" ")}
            >
              <span>{item.label}</span>
              {item.badge ? (
                <span
                  className={[
                    "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    active ? "bg-white/18 text-white" : "bg-ink-950/5 text-ink-600",
                  ].join(" ")}
                >
                  {item.badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
