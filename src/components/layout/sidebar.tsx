"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { NavigationGroup, NavigationItem } from "@/lib/navigation";

type SidebarProps = {
  groups: NavigationGroup[];
};

export function Sidebar({ groups }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="hub-sidebar hidden min-h-screen w-80 shrink-0 border-r px-4 py-5 backdrop-blur lg:block">
      <div className="px-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-mint-600">Hub VZ</p>
        <h2 className="mt-2 text-lg font-semibold text-ink-950 dark:text-slate-100">Central</h2>
        <p className="mt-1 text-sm text-ink-600 dark:text-slate-300">
          Navegação organizada por áreas do Hub.
        </p>
      </div>

      <nav className="mt-7 space-y-5" aria-label="Navegação principal">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="hub-nav-group-title px-3">{group.label}</p>
            <div className="mt-2 space-y-1">
              {group.items.map((item) => (
                <NavigationLink key={item.href} item={item} pathname={pathname} />
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}

function NavigationLink({ item, pathname }: { item: NavigationItem; pathname: string }) {
  const active =
    item.href === "/dashboard"
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`);

  return (
    <Link
      href={item.href}
      className={[
        "hub-nav-item flex items-center justify-between rounded-md px-3 py-2.5 text-sm font-medium transition",
        active ? "hub-nav-item-active shadow-soft" : "",
      ].join(" ")}
    >
      <span>{item.label}</span>
      {item.badge ? (
        <span
          className={[
            "hub-nav-badge rounded-full px-2 py-0.5 text-[11px] font-semibold",
            active ? "hub-nav-badge-active" : "",
          ].join(" ")}
        >
          {item.badge}
        </span>
      ) : null}
    </Link>
  );
}
