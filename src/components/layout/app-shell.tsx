import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { navigationItems } from "@/lib/navigation";

type AppShellProps = {
  children: React.ReactNode;
  userEmail?: string | null;
  visualStyle?: string;
  density?: string;
  categoryBadgeStyle?: string;
};

export function AppShell({
  children,
  userEmail,
  visualStyle = "classic",
  density = "comfortable",
  categoryBadgeStyle = "solid",
}: AppShellProps) {
  return (
    <div
      className="hub-shell min-h-screen lg:flex"
      data-visual-style={visualStyle}
      data-density={density}
      data-category-badge-style={categoryBadgeStyle}
    >
      <Sidebar items={navigationItems} />
      <div className="min-w-0 flex-1">
        <Topbar items={navigationItems} userEmail={userEmail} />
        <main className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
