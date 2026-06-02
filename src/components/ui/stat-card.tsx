import Link from "next/link";

import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";

export type StatCardProps = {
  label: string;
  value: string;
  helper: string;
  tone?: StatusTone;
  href?: string;
};

export function StatCard({ label, value, helper, tone = "neutral", href }: StatCardProps) {
  const content = (
    <article
      className={[
        "h-full rounded-lg border border-ink-950/10 bg-white p-5 shadow-sm",
        href ? "transition hover:border-mint-500 hover:shadow-md" : "",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-ink-600">{label}</p>
        <StatusBadge tone={tone}>{toneLabel[tone]}</StatusBadge>
      </div>
      <p className="mt-4 text-2xl font-semibold tracking-tight text-ink-950">{value}</p>
      <p className="mt-2 text-sm leading-6 text-ink-600">{helper}</p>
    </article>
  );

  if (!href) {
    return content;
  }

  return (
    <Link href={href} className="block h-full focus:outline-none focus:ring-4 focus:ring-mint-100">
      {content}
    </Link>
  );
}

const toneLabel: Record<StatusTone, string> = {
  neutral: "Base",
  success: "Ok",
  warning: "Atenção",
  danger: "Crítico",
  info: "Info",
};
