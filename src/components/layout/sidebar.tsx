"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  Archive,
  CalendarCheck2,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  CreditCard,
  FileText,
  HandCoins,
  History,
  LayoutDashboard,
  Layers3,
  MapPin,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Settings,
  ShoppingBag,
  Tags,
  Target,
  TrendingUp,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { NavigationGroup, NavigationGroupId, NavigationIcon, NavigationItem } from "@/lib/navigation";

type SidebarProps = {
  groups: NavigationGroup[];
  collapsed: boolean;
  mobileOpen: boolean;
  openGroups: NavigationGroupId[];
  onToggleGroup: (groupId: NavigationGroupId) => void;
  onToggleCollapsed: () => void;
  onCloseMobile: () => void;
};

type SidebarContentProps = {
  groups: NavigationGroup[];
  pathname: string;
  collapsed: boolean;
  openGroups: NavigationGroupId[];
  onToggleGroup: (groupId: NavigationGroupId) => void;
  onToggleCollapsed: () => void;
  onNavigate: () => void;
  mobile?: boolean;
};

const navigationIcons: Record<NavigationIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  accounts: Receipt,
  income: TrendingUp,
  cards: CreditCard,
  invoices: FileText,
  reimbursements: HandCoins,
  installments: Layers3,
  "cash-flow": Activity,
  "payment-plans": CalendarRange,
  purchases: ShoppingBag,
  goals: Target,
  "weekly-review": CalendarCheck2,
  notes: NotebookPen,
  places: MapPin,
  categories: Tags,
  people: Users,
  diagnostics: AlertTriangle,
  history: History,
  archived: Archive,
  imports: Upload,
  settings: Settings,
};

export function Sidebar({
  groups,
  collapsed,
  mobileOpen,
  openGroups,
  onToggleGroup,
  onToggleCollapsed,
  onCloseMobile,
}: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      <aside
        className={[
          "hub-sidebar hidden min-h-screen shrink-0 border-r px-3 py-5 backdrop-blur transition-[width] duration-200 lg:block",
          collapsed ? "w-20" : "w-80",
        ].join(" ")}
      >
        <SidebarContent
          groups={groups}
          pathname={pathname}
          collapsed={collapsed}
          openGroups={openGroups}
          onToggleGroup={onToggleGroup}
          onToggleCollapsed={onToggleCollapsed}
          onNavigate={() => undefined}
        />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 bg-ink-950/45 lg:hidden" onClick={onCloseMobile}>
          <aside
            className="hub-sidebar absolute left-0 top-0 h-full w-[88vw] max-w-sm border-r px-3 py-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <SidebarContent
              groups={groups}
              pathname={pathname}
              collapsed={false}
              openGroups={openGroups}
              onToggleGroup={onToggleGroup}
              onToggleCollapsed={onCloseMobile}
              onNavigate={onCloseMobile}
              mobile
            />
          </aside>
        </div>
      ) : null}
    </>
  );
}

function SidebarContent({
  groups,
  pathname,
  collapsed,
  openGroups,
  onToggleGroup,
  onToggleCollapsed,
  onNavigate,
  mobile = false,
}: SidebarContentProps) {
  return (
    <>
      <div className={collapsed ? "px-1" : "px-3"}>
        <div className="flex items-start justify-between gap-3">
          <div className={collapsed ? "flex w-full justify-center" : ""}>
            <div className={collapsed ? "text-center" : ""}>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-mint-600">Hub VZ</p>
              {!collapsed ? (
                <>
                  <h2 className="mt-2 text-lg font-semibold text-ink-950 dark:text-slate-100">Central</h2>
                  <p className="mt-1 text-sm text-ink-600 dark:text-slate-300">Módulos agrupados por área, com foco no que você usa todo dia.</p>
                </>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="hub-action hub-action-secondary hidden rounded-md border px-2 py-2 text-ink-700 lg:inline-flex dark:text-slate-200"
            title={collapsed ? "Expandir barra lateral" : "Recolher barra lateral"}
            aria-label={collapsed ? "Expandir barra lateral" : "Recolher barra lateral"}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
          {mobile ? (
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="hub-action hub-action-secondary inline-flex rounded-md border px-2 py-2 text-ink-700 lg:hidden dark:text-slate-200"
              aria-label="Fechar menu"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      <nav className="mt-7 space-y-3" aria-label="Navegação principal">
        {groups.map((group) => {
          const isOpen = collapsed ? false : openGroups.includes(group.id);
          const hasActiveItem = group.items.some((item) => isItemActive(item, pathname));

          return (
            <section
              key={group.id}
              className={[
                "space-y-1",
                collapsed ? "border-t border-ink-950/8 pt-3 first:border-t-0 first:pt-0 dark:border-white/10" : "",
              ].join(" ")}
              aria-label={group.label}
            >
              {!collapsed ? (
                <button
                  type="button"
                  onClick={() => onToggleGroup(group.id)}
                  className={[
                    "hub-nav-group flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-semibold transition",
                    hasActiveItem ? "hub-nav-group-active" : "",
                  ].join(" ")}
                  aria-expanded={isOpen}
                >
                  <span className="hub-nav-group-icon">
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </span>
                  <span className="truncate">{group.label}</span>
                </button>
              ) : null}

              <div className={collapsed || isOpen ? "space-y-1" : "hidden"}>
                {group.items.map((item) => (
                  <NavigationLink
                    key={item.href}
                    item={item}
                    pathname={pathname}
                    collapsed={collapsed}
                    groupLabel={group.label}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </nav>
    </>
  );
}

function NavigationLink({
  item,
  pathname,
  collapsed,
  groupLabel,
  onNavigate,
}: {
  item: NavigationItem;
  pathname: string;
  collapsed: boolean;
  groupLabel: string;
  onNavigate: () => void;
}) {
  const active = isItemActive(item, pathname);
  const Icon = navigationIcons[item.icon];
  const tooltip = `${groupLabel} • ${item.label}`;

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={[
        "hub-nav-item flex items-center rounded-md text-sm font-medium transition",
        collapsed ? "justify-center px-2 py-3.5" : "justify-between gap-3 px-3 py-2.5",
        active ? "hub-nav-item-active shadow-soft" : "",
      ].join(" ")}
      title={tooltip}
      aria-label={tooltip}
    >
      <span className={["flex items-center gap-3", collapsed ? "justify-center" : "min-w-0"].join(" ")}>
        <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
        {!collapsed ? <span className="truncate">{item.label}</span> : null}
      </span>
      {!collapsed && item.badge ? (
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

function isItemActive(item: NavigationItem, pathname: string) {
  return item.href === "/dashboard"
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
