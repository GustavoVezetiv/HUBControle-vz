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
  CreditCard,
  FileText,
  HandCoins,
  History,
  Landmark,
  ListTodo,
  Map,
  LayoutDashboard,
  Layers3,
  MapPin,
  Mic,
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
  Wrench,
  type LucideIcon,
} from "lucide-react";

import type { NavigationGroup, NavigationGroupId, NavigationIcon, NavigationItem } from "@/lib/navigation";

type SidebarProps = {
  groups: NavigationGroup[];
  collapsed: boolean;
  mobileOpen: boolean;
  openGroups: NavigationGroupId[];
  onToggleGroup: (groupId: NavigationGroupId) => void;
  onOpenGroup: (groupId: NavigationGroupId) => void;
  onToggleCollapsed: () => void;
  onCloseMobile: () => void;
};

type SidebarContentProps = {
  groups: NavigationGroup[];
  pathname: string;
  collapsed: boolean;
  openGroups: NavigationGroupId[];
  onToggleGroup: (groupId: NavigationGroupId) => void;
  onOpenGroup: (groupId: NavigationGroupId) => void;
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
  "voice-captures": Mic,
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

const groupIcons: Record<NavigationGroupId, LucideIcon> = {
  financial: Landmark,
  planning: ListTodo,
  routine: Users,
  leisure: Map,
  system: Wrench,
};

export function Sidebar({
  groups,
  collapsed,
  mobileOpen,
  openGroups,
  onToggleGroup,
  onOpenGroup,
  onToggleCollapsed,
  onCloseMobile,
}: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      <aside
        className={[
          "hub-sidebar hub-sidebar-motion hidden min-h-screen shrink-0 overflow-hidden border-r px-3 py-5 backdrop-blur transition-[width,padding] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] lg:block",
          collapsed ? "w-20" : "w-80",
        ].join(" ")}
      >
        <SidebarContent
          groups={groups}
          pathname={pathname}
          collapsed={collapsed}
          openGroups={openGroups}
          onToggleGroup={onToggleGroup}
          onOpenGroup={onOpenGroup}
          onToggleCollapsed={onToggleCollapsed}
          onNavigate={() => undefined}
        />
      </aside>

        <div
          className={[
            "fixed inset-0 z-40 bg-ink-950/45 transition-opacity duration-300 lg:hidden",
            mobileOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
          ].join(" ")}
          onClick={onCloseMobile}
          aria-hidden={!mobileOpen}
        >
          <aside
            className={[
              "hub-sidebar hub-sidebar-motion absolute left-0 top-0 h-full w-[88vw] max-w-sm border-r px-3 py-5 shadow-2xl transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
              mobileOpen ? "translate-x-0" : "-translate-x-full",
            ].join(" ")}
            onClick={(event) => event.stopPropagation()}
          >
            <SidebarContent
              groups={groups}
              pathname={pathname}
              collapsed={false}
              openGroups={openGroups}
              onToggleGroup={onToggleGroup}
              onOpenGroup={onOpenGroup}
              onToggleCollapsed={onCloseMobile}
              onNavigate={onCloseMobile}
              mobile
            />
          </aside>
        </div>
    </>
  );
}

function SidebarContent({
  groups,
  pathname,
  collapsed,
  openGroups,
  onToggleGroup,
  onOpenGroup,
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
              <div
                className={`hub-sidebar-label grid transition-[grid-template-rows,opacity,transform] duration-400 ease-out ${collapsed ? "grid-rows-[0fr] -translate-x-2 opacity-0" : "grid-rows-[1fr] translate-x-0 opacity-100"}`}
              >
                <div className="min-h-0 overflow-hidden">
                  <h2 className="mt-2 text-lg font-semibold text-ink-950 dark:text-slate-100">Central</h2>
                  <p className="mt-1 text-sm text-ink-600 dark:text-slate-300">Módulos agrupados por área, com foco no que você usa todo dia.</p>
                </div>
              </div>
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
          const GroupIcon = groupIcons[group.id];

          return (
            <section
              key={group.id}
              className={[
                "space-y-1",
                collapsed ? "border-t border-ink-950/8 pt-3 first:border-t-0 first:pt-0 dark:border-white/10" : "",
              ].join(" ")}
              aria-label={group.label}
            >
              <button
                type="button"
                onClick={() => (collapsed ? onOpenGroup(group.id) : onToggleGroup(group.id))}
                className={[
                  "hub-nav-group flex w-full items-center rounded-md text-left text-sm font-semibold transition-all duration-400 ease-out",
                  collapsed ? "justify-center px-2 py-3 hover:scale-[1.04]" : "gap-3 px-3 py-2 hover:translate-x-0.5",
                  hasActiveItem ? "hub-nav-group-active shadow-soft" : "",
                ].join(" ")}
                title={collapsed ? group.label : undefined}
                aria-label={collapsed ? `Abrir ${group.label}` : group.label}
                aria-expanded={!collapsed && isOpen}
              >
                <GroupIcon className={`hub-sidebar-group-icon h-5 w-5 shrink-0 transition-transform duration-400 ${collapsed ? "scale-100" : "scale-90"}`} strokeWidth={2} />
                <span
                  aria-hidden={collapsed}
                  className={`hub-sidebar-label grid min-w-0 transition-[grid-template-columns,opacity,transform] duration-400 ease-out ${
                    collapsed ? "grid-cols-[0fr] -translate-x-2 opacity-0" : "grid-cols-[1fr] translate-x-0 opacity-100"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-3 overflow-hidden">
                    <span className={`hub-nav-group-icon shrink-0 transition-transform duration-400 ${isOpen ? "rotate-0" : "-rotate-90"}`}>
                      <ChevronDown className="h-4 w-4" />
                    </span>
                    <span className="truncate">{group.label}</span>
                  </span>
                </span>
              </button>

              <div
                aria-hidden={!isOpen}
                className={[
                  "hub-sidebar-panel grid transition-[grid-template-rows,opacity,transform] duration-400 ease-[cubic-bezier(0.22,1,0.36,1)]",
                  isOpen ? "grid-rows-[1fr] translate-y-0 opacity-100" : "grid-rows-[0fr] -translate-y-1 opacity-0",
                ].join(" ")}
              >
                <div className="min-h-0 overflow-hidden">
                  <div className="space-y-1">
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
                </div>
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
