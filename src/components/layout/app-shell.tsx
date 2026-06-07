import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { navigationItems } from "@/lib/navigation";

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
  const contentWidthClass =
    contentWidth === "compact"
      ? "max-w-6xl"
      : contentWidth === "wide"
        ? "max-w-[96rem]"
        : contentWidth === "full"
          ? "max-w-none"
          : "max-w-7xl";

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
    >
      <Sidebar items={navigationItems} />
      <div className="min-w-0 flex-1">
        <Topbar items={navigationItems} userEmail={userEmail} />
        <main className={`mx-auto w-full ${contentWidthClass} px-4 py-5 sm:px-6 lg:px-8 lg:py-8`}>
          {children}
        </main>
      </div>
    </div>
  );
}
