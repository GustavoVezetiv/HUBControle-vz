import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { DashboardFavoriteShortcuts } from "@/features/dashboard/components/dashboard-favorite-shortcuts";
import { DashboardViewPreferences } from "@/features/dashboard/components/dashboard-view-preferences";
import type { DashboardLayoutMode } from "@/features/dashboard/components/dashboard-view-preferences";
import { buildFinancialDiagnosticsFromSource, loadFinancialDiagnosticsSourceData } from "@/features/diagnostics/queries";
import type { FinancialDiagnosticsData } from "@/features/diagnostics/types";
import { buildFinancialSummary } from "@/features/decision/financial-summary";
import { calculatePaymentPlanScenario } from "@/features/payment-plans/simulator";
import { formatCurrency, formatDate, todayISO } from "@/features/shared/format";
import {
  isAnyDateInPeriod,
  isDateInPeriod,
  isDateRangeInPeriod,
  parsePeriodSearchParams,
  type PeriodValue,
} from "@/features/shared/period";
import { createClient } from "@/lib/supabase/server";
import type {
  AccountPayable,
  CreditCardInvoice,
  CreditCardTransaction,
  Goal,
  IncomeSource,
  Installment,
  PaymentPlan,
  PaymentPlanItem,
  PlannedPurchase,
  Reimbursement,
} from "@/lib/supabase/types";

export const metadata = {
  title: "Dashboard",
};

type DashboardPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type DashboardSummary = {
  pendingAccounts: number;
  expectedRealIncome: number;
  expectedReimbursements: number;
  expectedThirdPartyMoney: number;
  projectedBalance: number;
  criticalInvoiceAmount: number;
  openReimbursements: number;
  thirdPartyOpenAmount: number;
  estimatedNetPersonalCost: number;
  activePlanPayNow: number;
  activePlanNextInvoicePressure: number;
  activePlanCriticalRisk: number;
  activePlanReimbursementDependency: number;
  activeInstallmentMonthlyAmount: number;
  plannedPurchasePressure: number;
  activePlannedPurchaseCount: number;
  openInvoiceCount: number;
  openInvoiceTotal: number;
  openReimbursementCount: number;
  pendingCount: number;
  overdueCount: number;
  nearDueInvoiceCount: number;
  nearDueInvoiceAmount: number;
  totalAccountAmount: number;
  flowRows: FlowRow[];
};

type OverviewCardConfig = {
  label: string;
  value: string;
  helper: string;
  tone: "info" | "warning" | "danger" | "success" | "neutral";
  href?: string;
};

type AttentionPreview = {
  label: string;
  meta?: string;
  href: string;
};

type AttentionBlock = {
  title: string;
  value: string;
  helper: string;
  tone: "info" | "warning" | "danger" | "success" | "neutral";
  href: string;
  items: AttentionPreview[];
  empty: string;
};

type MonthSummaryRow = {
  label: string;
  value: string;
  helper: string;
  tone: "info" | "warning" | "danger" | "success" | "neutral";
};

type FlowRow = {
  date: string;
  type: string;
  description: string;
  amount: number;
  status: string;
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams;
  const period = parsePeriodSearchParams(params ?? {});
  const dashboardMode = parseDashboardMode(params ?? {});
  const compactDashboard = dashboardMode === "simple";
  const periodQuery = buildPeriodQuery(period);
  const supabase = await createClient();

  if (!supabase) {
    return <DashboardError message="Supabase não está configurado." />;
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return <DashboardError message="Sessão não encontrada. Entre novamente." />;
  }

  const [
    accountsResult,
    incomeResult,
    invoicesResult,
    transactionsResult,
    reimbursementsResult,
    installmentsResult,
    purchasesResult,
    goalsResult,
    activePlanResult,
    diagnosticsSourceResult,
  ] = await Promise.all([
    supabase.from("accounts_payable").select("*").is("archived_at", null),
    supabase.from("income_sources").select("*").is("archived_at", null),
    supabase.from("credit_card_invoices").select("*").is("archived_at", null),
    supabase.from("credit_card_transactions").select("*").is("archived_at", null),
    supabase.from("reimbursements").select("*").is("archived_at", null),
    supabase.from("installments").select("*"),
    supabase.from("planned_purchases").select("*").is("archived_at", null),
    supabase.from("goals").select("*").is("archived_at", null),
    supabase.from("payment_plans").select("*").eq("status", "active").order("reference_month", { ascending: false }).limit(1),
    loadFinancialDiagnosticsSourceData(supabase, user.id),
  ]);

  const activePlan = activePlanResult.data?.[0] ?? null;
  const activePlanItemsResult = activePlan
    ? await supabase.from("payment_plan_items").select("*").eq("payment_plan_id", activePlan.id)
    : { data: [], error: null };

  if (
    accountsResult.error ||
    incomeResult.error ||
    invoicesResult.error ||
    transactionsResult.error ||
    reimbursementsResult.error ||
    installmentsResult.error ||
    purchasesResult.error ||
    goalsResult.error ||
    activePlanResult.error ||
    activePlanItemsResult.error
  ) {
    return (
      <DashboardError
        message={
          accountsResult.error?.message ??
          incomeResult.error?.message ??
          invoicesResult.error?.message ??
          transactionsResult.error?.message ??
          reimbursementsResult.error?.message ??
          installmentsResult.error?.message ??
          purchasesResult.error?.message ??
          goalsResult.error?.message ??
          activePlanResult.error?.message ??
          activePlanItemsResult.error?.message ??
          "Erro ao carregar dados."
        }
      />
    );
  }

  const accounts = accountsResult.data ?? [];
  const incomeSources = incomeResult.data ?? [];
  const invoices = invoicesResult.data ?? [];
  const transactions = transactionsResult.data ?? [];
  const reimbursements = reimbursementsResult.data ?? [];
  const installments = installmentsResult.data ?? [];
  const plannedPurchases = purchasesResult.data ?? [];
  const goals = goalsResult.data ?? [];
  const activePlanItems = activePlanItemsResult.data ?? [];
  const diagnosticsData =
    diagnosticsSourceResult.data ? buildFinancialDiagnosticsFromSource(diagnosticsSourceResult.data) : null;

  if (diagnosticsSourceResult.error) {
    console.error("Erro técnico ao carregar diagnóstico financeiro para o dashboard:", diagnosticsSourceResult.error);
  }

  const periodAccounts = accounts.filter((account) => isDateInPeriod(account.due_date, period));
  const periodIncomeSources = incomeSources.filter((income) =>
    isAnyDateInPeriod([income.expected_date, income.received_date], period),
  );
  const periodInvoices = invoices.filter((invoice) =>
    isAnyDateInPeriod([invoice.due_date, invoice.reference_month], period),
  );
  const periodTransactions = transactions.filter((transaction) => isDateInPeriod(transaction.transaction_date, period));
  const periodReimbursements = reimbursements.filter((reimbursement) =>
    isAnyDateInPeriod([reimbursement.expected_date, reimbursement.received_date], period),
  );
  const periodInstallments = installments.filter((installment) =>
    isDateRangeInPeriod(installment.start_date, installment.end_date, period),
  );
  const periodPlannedPurchases = plannedPurchases.filter((purchase) =>
    isDateInPeriod(purchase.target_date, period),
  );
  const periodGoals = goals.filter((goal) => isDateInPeriod(goal.target_date, period));

  const summary = buildDashboardSummary(
    periodAccounts,
    periodIncomeSources,
    periodInvoices,
    periodTransactions,
    periodReimbursements,
    periodInstallments,
    periodPlannedPurchases,
    activePlan,
    activePlanItems,
  );

  const decisionSummary = buildFinancialSummary({
    accounts: periodAccounts,
    incomeSources: periodIncomeSources,
    invoices: periodInvoices,
    transactions: periodTransactions,
    reimbursements: periodReimbursements,
    installments: periodInstallments,
    activePlan,
    activePlanItems,
  });

  const overviewCards = getOverviewCards(summary, decisionSummary, diagnosticsData, periodQuery);
  const attentionBlocks = buildAttentionBlocks({
    accounts: periodAccounts,
    invoices: periodInvoices,
    reimbursements: periodReimbursements,
    purchases: periodPlannedPurchases,
    goals: periodGoals,
    diagnostics: diagnosticsData,
    periodQuery,
  });
  const monthSummaryRows = buildMonthSummaryRows(summary, decisionSummary);
  const visibleFlowRows = compactDashboard ? summary.flowRows.slice(0, 5) : summary.flowRows.slice(0, 10);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Visão inicial"
        title="Dashboard"
        description="Use esta tela para ver o que exige atenção agora e decidir o próximo passo."
      />

      <DashboardViewPreferences initialPeriod={period} />

      <SectionCard
        title="Resumo curto"
        description={compactDashboard ? "Poucos números para decidir rápido." : "Visão principal do período selecionado."}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {overviewCards.map((card) => (
            <StatCard
              key={card.label}
              label={card.label}
              value={card.value}
              helper={card.helper}
              tone={card.tone}
              href={card.href}
            />
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Precisa de atenção" description="Somente itens que pedem ação ou revisão agora.">
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-5">
          {attentionBlocks.map((block) => (
            <AttentionCard key={block.title} block={block} compact={compactDashboard} />
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Atalhos rápidos" description="Acesso direto ao que você mais faz no dia a dia.">
        <DashboardFavoriteShortcuts userId={user.id} />
      </SectionCard>

      <section className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
        <SectionCard title="Resumo do mês" description="Leitura compacta de entradas, saídas e pendências do período.">
          <div className="space-y-3">
            {monthSummaryRows.map((row) => (
              <MonthSummaryLine key={row.label} row={row} />
            ))}
          </div>
          <div className="hub-card mt-4 rounded-lg border border-ink-950/10 bg-slate-50 p-4 text-sm leading-6 text-ink-600 dark:border-white/10 dark:text-slate-300">
            Reembolsos e dinheiro de terceiros ajudam no caixa projetado, mas continuam separados de renda livre.
          </div>
        </SectionCard>

        <SectionCard
          title={compactDashboard ? "Próximos movimentos" : "Fluxo dos próximos dias"}
          description="Contas e entradas mais próximas, para não perder vencimentos e recebimentos."
        >
          {visibleFlowRows.length === 0 ? (
            <EmptyState
              title="Nada próximo no período"
              description="Quando houver contas ou entradas nos próximos dias, elas aparecerão aqui."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-ink-950/10 text-left text-sm dark:divide-white/10">
                <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-ink-600 dark:bg-slate-900/70 dark:text-slate-300">
                  <tr>
                    <th className="px-4 py-3">Data</th>
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3">Descrição</th>
                    <th className="px-4 py-3">Valor</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-950/10 dark:divide-white/10">
                  {visibleFlowRows.map((row) => (
                    <tr key={`${row.type}-${row.description}-${row.date}`}>
                      <td className="px-4 py-3 text-ink-600 dark:text-slate-300">{formatDate(row.date)}</td>
                      <td className="px-4 py-3 text-ink-600 dark:text-slate-300">{row.type}</td>
                      <td className="px-4 py-3 font-medium text-ink-950 dark:text-slate-100">{row.description}</td>
                      <td className="px-4 py-3 font-semibold text-ink-950 dark:text-slate-100">{formatCurrency(row.amount)}</td>
                      <td className="px-4 py-3 text-ink-600 dark:text-slate-300">{row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </section>

      {!compactDashboard ? (
        <section className="grid gap-4 xl:grid-cols-2">
          <SectionCard title="Visão completa do período" description="Complementos para decisões mais detalhadas.">
            <div className="grid gap-3 sm:grid-cols-2">
              <StatCard
                label="Dependência de terceiros"
                value={formatCurrency(decisionSummary.linkedMoneyExpected)}
                helper="Reembolsos e dinheiro de terceiros esperados."
                tone={decisionSummary.linkedMoneyExpected > 0 ? "warning" : "neutral"}
              />
              <StatCard
                label="Próxima pressão"
                value={formatCurrency(decisionSummary.nextMonthPressure)}
                helper="Contas, faturas e parcelas futuras."
                tone={decisionSummary.nextMonthPressure > 0 ? "warning" : "neutral"}
              />
              <StatCard
                label="Custo pessoal líquido"
                value={formatCurrency(summary.estimatedNetPersonalCost)}
                helper="Faturas abertas menos reembolsos esperados."
                tone="info"
              />
              <StatCard
                label="Compras em observação"
                value={formatCurrency(summary.plannedPurchasePressure)}
                helper={`${summary.activePlannedPurchaseCount} compra(s) planejada(s) ativa(s).`}
                tone={summary.plannedPurchasePressure > 0 ? "warning" : "neutral"}
                href={`/dashboard/purchases?${periodQuery}`}
              />
            </div>
          </SectionCard>

          <SectionCard title="Plano ativo do mês" description="Resumo do cenário escolhido para este período.">
            {activePlan ? (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-semibold text-ink-950 dark:text-slate-100">{activePlan.name}</p>
                  <p className="mt-1 text-sm leading-6 text-ink-600 dark:text-slate-300">
                    {activePlan.description ?? "Plano ativo para decisões do mês."}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <StatCard
                    label="Pagar agora"
                    value={formatCurrency(summary.activePlanPayNow)}
                    helper="Saída imediata prevista."
                    tone="danger"
                  />
                  <StatCard
                    label="Próxima fatura"
                    value={formatCurrency(summary.activePlanNextInvoicePressure)}
                    helper="Pressão futura via cartão e parcelas."
                    tone="warning"
                    href={`/dashboard/installments?status=active&${periodQuery}`}
                  />
                  <StatCard
                    label="Risco crítico"
                    value={formatCurrency(summary.activePlanCriticalRisk)}
                    helper="Itens críticos dentro do plano."
                    tone={summary.activePlanCriticalRisk > 0 ? "danger" : "neutral"}
                  />
                  <StatCard
                    label="Dependência de reembolso"
                    value={formatCurrency(summary.activePlanReimbursementDependency)}
                    helper="Entradas vinculadas esperadas no plano."
                    tone={summary.activePlanReimbursementDependency > 0 ? "warning" : "neutral"}
                  />
                </div>
                <Link
                  className="text-sm font-semibold text-mint-600 transition hover:text-mint-700"
                  href={`/dashboard/payment-plans/${activePlan.id}`}
                >
                  Abrir plano ativo
                </Link>
              </div>
            ) : (
              <EmptyState
                title="Nenhum plano ativo"
                description="Crie ou ative um plano de pagamento para acompanhar esse cenário aqui."
              />
            )}
          </SectionCard>
        </section>
      ) : null}
    </div>
  );
}

function AttentionCard({ block, compact }: { block: AttentionBlock; compact: boolean }) {
  return (
    <div className="hub-card rounded-lg border border-ink-950/10 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink-950 dark:text-slate-100">{block.title}</p>
          <p className="mt-1 text-2xl font-semibold text-ink-950 dark:text-slate-100">{block.value}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${attentionToneClass(block.tone)}`}>
          {attentionToneLabel(block.tone)}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-ink-600 dark:text-slate-300">{block.helper}</p>
      {block.items.length > 0 ? (
        <div className="mt-4 space-y-2">
          {block.items.slice(0, compact ? 2 : 3).map((item) => (
            <Link
              key={`${block.title}-${item.href}-${item.label}`}
              href={item.href}
              className="block rounded-md border border-ink-950/10 px-3 py-2 text-sm transition hover:border-mint-500 dark:border-white/10"
            >
              <span className="font-medium text-ink-950 dark:text-slate-100">{item.label}</span>
              {item.meta ? <span className="mt-1 block text-xs text-ink-600 dark:text-slate-300">{item.meta}</span> : null}
            </Link>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink-500 dark:text-slate-400">{block.empty}</p>
      )}
      <Link
        href={block.href}
        className="mt-4 inline-flex text-sm font-semibold text-mint-600 transition hover:text-mint-700"
      >
        Abrir detalhes
      </Link>
    </div>
  );
}

function MonthSummaryLine({ row }: { row: MonthSummaryRow }) {
  return (
    <div className="hub-card flex items-start justify-between gap-4 rounded-lg border border-ink-950/10 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink-950 dark:text-slate-100">{row.label}</p>
        <p className="mt-1 text-xs leading-5 text-ink-600 dark:text-slate-300">{row.helper}</p>
      </div>
      <span className={`shrink-0 text-sm font-semibold ${monthRowValueClass(row.tone)}`}>{row.value}</span>
    </div>
  );
}

function attentionToneClass(tone: AttentionBlock["tone"]) {
  if (tone === "danger") return "bg-danger-100 text-danger-700 dark:bg-danger-500/15 dark:text-danger-200";
  if (tone === "warning") return "bg-amberRisk-100 text-amberRisk-700 dark:bg-amberRisk-500/15 dark:text-amberRisk-200";
  if (tone === "success") return "bg-mint-100 text-mint-700 dark:bg-mint-500/15 dark:text-mint-200";
  if (tone === "info") return "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200";
  return "bg-slate-100 text-ink-700 dark:bg-slate-800 dark:text-slate-200";
}

function attentionToneLabel(tone: AttentionBlock["tone"]) {
  if (tone === "danger") return "Crítico";
  if (tone === "warning") return "Atenção";
  if (tone === "success") return "Ok";
  if (tone === "info") return "Info";
  return "Neutro";
}

function monthRowValueClass(tone: MonthSummaryRow["tone"]) {
  if (tone === "danger") return "text-danger-700 dark:text-danger-200";
  if (tone === "warning") return "text-amberRisk-700 dark:text-amberRisk-200";
  if (tone === "success") return "text-mint-700 dark:text-mint-200";
  if (tone === "info") return "text-sky-700 dark:text-sky-200";
  return "text-ink-950 dark:text-slate-100";
}

function buildPeriodQuery(period: PeriodValue) {
  const params = new URLSearchParams();
  params.set("period", period.preset);

  if (period.startDate) params.set("start", period.startDate);
  if (period.endDate) params.set("end", period.endDate);

  return params.toString();
}

function parseDashboardMode(searchParams: Record<string, string | string[] | undefined>): DashboardLayoutMode {
  const value = typeof searchParams.mode === "string" ? searchParams.mode : null;
  return value === "full" ? "full" : "simple";
}

function getOverviewCards(
  summary: DashboardSummary,
  decisionSummary: ReturnType<typeof buildFinancialSummary>,
  diagnostics: FinancialDiagnosticsData | null,
  periodQuery: string,
): OverviewCardConfig[] {
  const diagnosticAlertCount = getVisibleDiagnosticAlertCount(diagnostics);
  const criticalAlertCount =
    summary.overdueCount +
    summary.nearDueInvoiceCount +
    summary.openReimbursementCount +
    diagnosticAlertCount;

  return [
    {
      label: "Saldo do mês",
      value: formatCurrency(decisionSummary.freeCashAfterRealObligations),
      helper: "Renda real menos obrigações do período.",
      tone: decisionSummary.freeCashAfterRealObligations < 0 ? "danger" : "success",
    },
    {
      label: "Contas pendentes",
      value: formatCurrency(summary.pendingAccounts),
      helper: `${summary.pendingCount} conta(s) ainda abertas.`,
      tone: summary.pendingAccounts > 0 ? "warning" : "neutral",
      href: `/dashboard/accounts?status=pending&${periodQuery}`,
    },
    {
      label: "Faturas próximas",
      value: formatCurrency(summary.nearDueInvoiceAmount),
      helper:
        summary.nearDueInvoiceCount > 0
          ? `${summary.nearDueInvoiceCount} fatura(s) vencem em até 7 dias.`
          : "Nenhuma fatura próxima do vencimento.",
      tone: summary.nearDueInvoiceCount > 0 ? "warning" : "neutral",
      href: `/dashboard/invoices?status=open&${periodQuery}`,
    },
    {
      label: "Reembolsos a receber",
      value: formatCurrency(summary.openReimbursements),
      helper: `${summary.openReimbursementCount} reembolso(s) ainda em aberto.`,
      tone: summary.openReimbursements > 0 ? "warning" : "neutral",
      href: `/dashboard/reimbursements?status=expected&${periodQuery}`,
    },
    {
      label: "Alertas críticos",
      value: String(criticalAlertCount),
      helper: diagnosticAlertCount > 0 ? "Inclui contas, faturas, reembolsos e diagnóstico." : "Contas, faturas e reembolsos do período.",
      tone: criticalAlertCount > 0 ? "danger" : "neutral",
      href: "/dashboard/diagnostics",
    },
  ];
}

function buildAttentionBlocks({
  accounts,
  invoices,
  reimbursements,
  purchases,
  goals,
  diagnostics,
  periodQuery,
}: {
  accounts: AccountPayable[];
  invoices: CreditCardInvoice[];
  reimbursements: Reimbursement[];
  purchases: PlannedPurchase[];
  goals: Goal[];
  diagnostics: FinancialDiagnosticsData | null;
  periodQuery: string;
}): AttentionBlock[] {
  const today = todayISO();
  const next7Days = addDaysISO(today, 7);
  const next14Days = addDaysISO(today, 14);

  const overdueAccounts = accounts.filter(
    (account) => account.status === "overdue" || (account.status === "pending" && account.due_date < today),
  );
  const nearDueInvoices = invoices.filter(
    (invoice) =>
      ["open", "closed", "partial", "overdue"].includes(invoice.status) &&
      invoice.due_date >= today &&
      invoice.due_date <= next7Days,
  );
  const lateReimbursements = reimbursements.filter(
    (item) =>
      ["expected", "partial", "late"].includes(item.status) &&
      item.expected_date &&
      item.expected_date < today,
  );
  const purchaseAlerts = purchases.filter(
    (purchase) =>
      ["high", "critical"].includes(purchase.risk_level) &&
      !["purchased", "canceled", "cancelled"].includes(purchase.decision_status),
  );
  const goalAlerts = goals.filter(
    (goal) =>
      goal.target_date &&
      goal.target_date >= today &&
      goal.target_date <= next14Days &&
      !["completed", "cancelled", "canceled"].includes(goal.status),
  );
  const visibleDiagnosticSections = (diagnostics?.sections ?? [])
    .map((section) => ({
      title: section.title,
      count: Math.max(section.count - section.ignoredCount, 0),
      href: section.items.find((item) => item.references[0]?.href)?.references[0]?.href ?? "/dashboard/diagnostics",
    }))
    .filter((section) => section.count > 0);

  return [
    {
      title: "Contas vencidas",
      value: String(overdueAccounts.length),
      helper:
        overdueAccounts.length > 0
          ? `${formatCurrency(overdueAccounts.reduce((sum, item) => sum + Number(item.amount), 0))} exigem ação imediata.`
          : "Nenhuma conta atrasada no período.",
      tone: overdueAccounts.length > 0 ? "danger" : "neutral",
      href: `/dashboard/accounts?status=overdue&${periodQuery}`,
      empty: "Sem contas vencidas agora.",
      items: overdueAccounts.slice(0, 3).map((account) => ({
        label: account.title,
        meta: `${formatDate(account.due_date)} · ${formatCurrency(Number(account.amount))}`,
        href: `/dashboard/accounts?status=overdue&${periodQuery}`,
      })),
    },
    {
      title: "Faturas próximas",
      value: String(nearDueInvoices.length),
      helper:
        nearDueInvoices.length > 0
          ? `${formatCurrency(nearDueInvoices.reduce((sum, invoice) => sum + Math.max(Number(invoice.total_amount) - Number(invoice.paid_amount), 0), 0))} vencem em até 7 dias.`
          : "Nenhuma fatura próxima do vencimento.",
      tone: nearDueInvoices.length > 0 ? "warning" : "neutral",
      href: `/dashboard/invoices?status=open&${periodQuery}`,
      empty: "Sem faturas próximas agora.",
      items: nearDueInvoices.slice(0, 3).map((invoice) => ({
        label: `Fatura ${invoice.reference_month}`,
        meta: `${formatDate(invoice.due_date)} · ${formatCurrency(Math.max(Number(invoice.total_amount) - Number(invoice.paid_amount), 0))}`,
        href: `/dashboard/invoices?status=open&${periodQuery}`,
      })),
    },
    {
      title: "Reembolsos atrasados",
      value: String(lateReimbursements.length),
      helper:
        lateReimbursements.length > 0
          ? `${formatCurrency(lateReimbursements.reduce((sum, item) => sum + Math.max(Number(item.expected_amount) - Number(item.received_amount), 0), 0))} seguem vinculados e atrasados.`
          : "Nenhum reembolso atrasado no período.",
      tone: lateReimbursements.length > 0 ? "danger" : "neutral",
      href: `/dashboard/reimbursements?status=late&${periodQuery}`,
      empty: "Sem reembolsos atrasados agora.",
      items: lateReimbursements.slice(0, 3).map((item) => ({
        label: item.description || "Reembolso sem descrição",
        meta: `${item.expected_date ? formatDate(item.expected_date) : "Sem data"} · ${formatCurrency(Math.max(Number(item.expected_amount) - Number(item.received_amount), 0))}`,
        href: `/dashboard/reimbursements?status=late&${periodQuery}`,
      })),
    },
    {
      title: "Compras e metas com alerta",
      value: String(purchaseAlerts.length + goalAlerts.length),
      helper:
        purchaseAlerts.length + goalAlerts.length > 0
          ? `${purchaseAlerts.length} compra(s) e ${goalAlerts.length} meta(s) pedem revisão.`
          : "Sem alertas de compras ou metas agora.",
      tone: purchaseAlerts.length > 0 || goalAlerts.length > 0 ? "warning" : "neutral",
      href: purchaseAlerts.length > 0 ? "/dashboard/purchases" : "/dashboard/goals",
      empty: "Sem compras ou metas em alerta.",
      items: [
        ...purchaseAlerts.slice(0, 2).map((purchase) => ({
          label: purchase.title,
          meta: `${formatCurrency(Number(purchase.estimated_amount))} · prioridade ${purchase.risk_level}`,
          href: "/dashboard/purchases",
        })),
        ...goalAlerts.slice(0, 2).map((goal) => ({
          label: goal.name,
          meta: goal.target_date ? `Prazo em ${formatDate(goal.target_date)}` : "Sem prazo definido",
          href: "/dashboard/goals",
        })),
      ],
    },
    {
      title: "Diagnóstico financeiro",
      value: String(getVisibleDiagnosticAlertCount(diagnostics)),
      helper:
        visibleDiagnosticSections.length > 0
          ? "Inconsistências detectadas no diagnóstico financeiro."
          : "Nenhuma inconsistência relevante no diagnóstico.",
      tone: visibleDiagnosticSections.length > 0 ? "danger" : "neutral",
      href: "/dashboard/diagnostics",
      empty: "Sem inconsistências abertas no diagnóstico.",
      items: visibleDiagnosticSections.slice(0, 3).map((section) => ({
        label: section.title,
        meta: `${section.count} alerta(s) visível(is)`,
        href: section.href,
      })),
    },
  ];
}

function buildMonthSummaryRows(
  summary: DashboardSummary,
  decisionSummary: ReturnType<typeof buildFinancialSummary>,
): MonthSummaryRow[] {
  return [
    {
      label: "Receitas reais",
      value: formatCurrency(summary.expectedRealIncome),
      helper: "Somente renda real prevista no período.",
      tone: "success",
    },
    {
      label: "Despesas do período",
      value: formatCurrency(summary.totalAccountAmount),
      helper: `${summary.pendingCount} pendente(s) e ${summary.overdueCount} atrasada(s).`,
      tone: summary.totalAccountAmount > 0 ? "warning" : "neutral",
    },
    {
      label: "Faturas em aberto",
      value: formatCurrency(summary.openInvoiceTotal),
      helper: `${summary.openInvoiceCount} fatura(s) aberta(s), parcial(is) ou atrasada(s).`,
      tone: summary.openInvoiceCount > 0 ? "warning" : "neutral",
    },
    {
      label: "Reembolsos a receber",
      value: formatCurrency(summary.openReimbursements),
      helper: `${summary.openReimbursementCount} valor(es) ainda vinculados.`,
      tone: summary.openReimbursements > 0 ? "info" : "neutral",
    },
    {
      label: "Saldo livre estimado",
      value: formatCurrency(decisionSummary.freeCashAfterRealObligations),
      helper: "Renda real menos obrigações. Não trata reembolso como renda livre.",
      tone: decisionSummary.freeCashAfterRealObligations < 0 ? "danger" : "success",
    },
  ];
}

function addDaysISO(date: string, days: number) {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function getVisibleDiagnosticAlertCount(diagnostics: FinancialDiagnosticsData | null) {
  if (!diagnostics) return 0;
  return diagnostics.sections.reduce((sum, section) => sum + Math.max(section.count - section.ignoredCount, 0), 0);
}

function DashboardError({ message }: { message: string }) {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Visão inicial"
        title="Dashboard"
        description="Não foi possível carregar os dados do dashboard."
      />
      <SectionCard title="Erro de banco de dados">
        <p className="text-sm text-danger-600">{message}</p>
      </SectionCard>
    </div>
  );
}

function buildDashboardSummary(
  accounts: AccountPayable[],
  incomeSources: IncomeSource[],
  invoices: CreditCardInvoice[],
  transactions: CreditCardTransaction[],
  reimbursements: Reimbursement[],
  installments: Installment[],
  plannedPurchases: PlannedPurchase[],
  activePlan: PaymentPlan | null,
  activePlanItems: PaymentPlanItem[],
): DashboardSummary {
  const today = todayISO();
  const nextWeekISO = addDaysISO(today, 7);

  const pendingAccounts = accounts
    .filter((account) => account.status === "pending" || account.status === "overdue")
    .reduce((total, account) => total + Number(account.amount), 0);

  const expectedRealIncome = incomeSources
    .filter((income) => income.status === "expected" && income.inflow_kind === "real_income")
    .reduce((total, income) => total + Number(income.amount), 0);

  const expectedReimbursements = incomeSources
    .filter((income) => income.status === "expected" && income.inflow_kind === "reimbursement")
    .reduce((total, income) => total + Number(income.amount), 0);

  const expectedThirdPartyMoney = incomeSources
    .filter((income) => income.status === "expected" && income.inflow_kind === "third_party_money")
    .reduce((total, income) => total + Number(income.amount), 0);

  const projectedBalance = expectedRealIncome + expectedReimbursements + expectedThirdPartyMoney - pendingAccounts;

  const openInvoices = invoices.filter((invoice) => ["open", "closed", "partial", "overdue"].includes(invoice.status));
  const nearDueInvoices = openInvoices.filter((invoice) => invoice.due_date >= today && invoice.due_date <= nextWeekISO);
  const openInvoiceTotal = openInvoices.reduce(
    (total, invoice) => total + Math.max(Number(invoice.total_amount) - Number(invoice.paid_amount), 0),
    0,
  );
  const criticalInvoiceAmount = openInvoices.reduce(
    (max, invoice) => Math.max(max, Math.max(Number(invoice.total_amount) - Number(invoice.paid_amount), 0)),
    0,
  );

  const openReimbursements = reimbursements
    .filter((item) => ["expected", "partial", "late"].includes(item.status))
    .reduce((total, item) => total + Math.max(Number(item.expected_amount) - Number(item.received_amount), 0), 0);

  const thirdPartyOpenAmount = transactions
    .filter(
      (transaction) =>
        transaction.is_reimbursable ||
        ["third_party", "shared", "family"].includes(transaction.ownership_type),
    )
    .reduce((total, transaction) => total + Number(transaction.amount), 0);

  const estimatedNetPersonalCost = Math.max(openInvoiceTotal - openReimbursements, 0);
  const generatedInstallmentIds = new Set(
    accounts
      .filter((account) => account.installment_id && account.is_generated && account.source_type === "installment")
      .map((account) => account.installment_id as string),
  );
  const activeInstallmentMonthlyAmount = installments
    .filter((item) => item.status === "active" && !item.invoice_id && !generatedInstallmentIds.has(item.id))
    .reduce((total, item) => total + Number(item.installment_amount), 0);

  const activePlannedPurchases = plannedPurchases.filter(
    (item) => !["purchased", "canceled", "cancelled"].includes(item.decision_status),
  );
  const plannedPurchasePressure = activePlannedPurchases.reduce(
    (total, item) => total + Number(item.estimated_amount),
    0,
  );

  const activePlanSimulation = activePlan
    ? calculatePaymentPlanScenario({
        items: activePlanItems,
        incomeSources,
        reimbursements,
        installments,
        accounts,
      })
    : null;

  const accountRows = accounts
    .filter(
      (account) =>
        (account.status === "pending" || account.status === "overdue") &&
        account.due_date >= today &&
        account.due_date <= nextWeekISO,
    )
    .map((account) => ({
      date: account.due_date,
      type: "Conta",
      description: account.title,
      amount: Number(account.amount),
      status: account.status === "overdue" ? "Atrasado" : "Pendente",
    }));

  const incomeRows = incomeSources
    .filter(
      (income) =>
        income.status === "expected" &&
        income.expected_date &&
        income.expected_date >= today &&
        income.expected_date <= nextWeekISO,
    )
    .map((income) => ({
      date: income.expected_date ?? today,
      type: income.inflow_kind === "real_income" ? "Receita" : "Entrada vinculada",
      description: income.name,
      amount: Number(income.amount),
      status: income.inflow_kind === "real_income" ? "Prevista" : "Não é renda livre",
    }));

  return {
    pendingAccounts,
    expectedRealIncome,
    expectedReimbursements,
    expectedThirdPartyMoney,
    projectedBalance,
    criticalInvoiceAmount,
    openReimbursements,
    thirdPartyOpenAmount,
    estimatedNetPersonalCost,
    activePlanPayNow: activePlanSimulation?.totalPayNow ?? 0,
    activePlanNextInvoicePressure: activePlanSimulation?.nextInvoicePressure ?? activeInstallmentMonthlyAmount,
    activePlanCriticalRisk: activePlanSimulation?.criticalRiskAmount ?? 0,
    activePlanReimbursementDependency: activePlanSimulation?.reimbursementsExpected ?? openReimbursements,
    activeInstallmentMonthlyAmount,
    plannedPurchasePressure,
    activePlannedPurchaseCount: activePlannedPurchases.length,
    openInvoiceCount: openInvoices.length,
    openInvoiceTotal,
    openReimbursementCount: reimbursements.filter((item) =>
      ["expected", "partial", "late"].includes(item.status),
    ).length,
    pendingCount: accounts.filter((account) => account.status === "pending").length,
    overdueCount: accounts.filter((account) => account.status === "overdue").length,
    nearDueInvoiceCount: nearDueInvoices.length,
    nearDueInvoiceAmount: nearDueInvoices.reduce(
      (total, invoice) => total + Math.max(Number(invoice.total_amount) - Number(invoice.paid_amount), 0),
      0,
    ),
    totalAccountAmount: accounts.reduce((total, account) => total + Number(account.amount), 0),
    flowRows: [...accountRows, ...incomeRows].sort((left, right) => left.date.localeCompare(right.date)),
  };
}
