export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

type StatusBadgeProps = {
  children: React.ReactNode;
  tone?: StatusTone;
};

export function StatusBadge({ children, tone = "neutral" }: StatusBadgeProps) {
  return (
    <span
      className={[
        "hub-status-badge inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        toneClassName[tone],
      ].join(" ")}
    >
      {children}
    </span>
  );
}

const toneClassName: Record<StatusTone, string> = {
  neutral: "bg-slate-100 text-ink-700 dark:bg-slate-700/70 dark:text-slate-200",
  success: "bg-mint-100 text-mint-600 dark:bg-emerald-950/55 dark:text-emerald-200",
  warning: "bg-amberRisk-100 text-amberRisk-500 dark:bg-amber-950/55 dark:text-amber-200",
  danger: "bg-danger-100 text-danger-600 dark:bg-red-950/55 dark:text-red-200",
  info: "bg-sky-100 text-sky-700 dark:bg-sky-950/55 dark:text-sky-200",
};
