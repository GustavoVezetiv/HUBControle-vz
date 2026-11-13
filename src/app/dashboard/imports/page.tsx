import { PluggyDashboard } from "@/features/pluggy/components/pluggy-dashboard";
import { inboxPeriodFromParams } from "@/features/pluggy/inbox";
export const metadata = { title: "Importações · Caixa de Entrada Financeira" };
export default async function ImportsPage({ searchParams }: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const period = inboxPeriodFromParams((await searchParams) ?? {});
  return <PluggyDashboard key={period ? `${period.start}:${period.end}` : "default"} initialPeriod={period} />;
}
