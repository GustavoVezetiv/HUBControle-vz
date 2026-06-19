import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { DashboardViewPreferences } from "@/features/dashboard/components/dashboard-view-preferences";
import type { DashboardLayoutMode } from "@/features/dashboard/components/dashboard-view-preferences";
import { buildFinancialSummary, type DecisionItem } from "@/features/decision/financial-summary";
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
  IncomeSource,
  Installment,
  ImportBatch,
  Goal,
  Note,
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

type DashboardSuggestion = {
  title: string;
  description: string;
  href: string;
  tone: "info" | "warning" | "danger" | "success";
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

  const [
    accountsResult,
    incomeResult,
    invoicesResult,
    transactionsResult,
    reimbursementsResult,
    installmentsResult,
    purchasesResult,
    goalsResult,
    notesResult,
    activePlanResult,
    importsResult,
  ] =
    await Promise.all([
    supabase.from("accounts_payable").select("*").is("archived_at", null),
    supabase.from("income_sources").select("*").is("archived_at", null),
    supabase.from("credit_card_invoices").select("*").is("archived_at", null),
    supabase.from("credit_card_transactions").select("*").is("archived_at", null),
    supabase.from("reimbursements").select("*").is("archived_at", null),
    supabase.from("installments").select("*"),
    supabase.from("planned_purchases").select("*").is("archived_at", null),
    supabase.from("goals").select("*").is("archived_at", null),
    supabase.from("notes").select("*").order("updated_at", { ascending: false }).limit(5),
    supabase.from("payment_plans").select("*").eq("status", "active").order("reference_month", { ascending: false }).limit(1),
    supabase.from("import_batches").select("*").order("created_at", { ascending: false }).limit(1),
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
    notesResult.error ||
    activePlanResult.error ||
    importsResult.error ||
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
          notesResult.error?.message ??
          activePlanResult.error?.message ??
          importsResult.error?.message ??
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
  const notes = notesResult.data ?? [];
  const lastImport = importsResult.data?.[0] ?? null;
  const activePlanItems = activePlanItemsResult.data ?? [];

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
    notes,
    activePlan,
    activePlanItems,
    lastImport,
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
  const smartSuggestions = buildDashboardSuggestions({
    accounts: periodAccounts,
    reimbursements: periodReimbursements,
    goals: periodGoals,
    purchases: periodPlannedPurchases,
    incomeSources: periodIncomeSources,
  });
  const overviewCards = getOverviewCards(summary, decisionSummary, periodQuery, compactDashboard);
  const quickActions = getQuickActions();
  const importantLists = compactDashboard
    ? [
        {
          title: "Pagar agora",
          description: "Itens mais urgentes do período.",
          items: decisionSummary.payNowItems.slice(0, 4),
          empty: "Sem itens críticos agora.",
        },
        {
          title: "Atenção na próxima fatura",
          description: "Cartão e parcelas que pressionam o mês seguinte.",
          items: decisionSummary.nextInvoiceItems.slice(0, 4),
          empty: "Sem pressão relevante de fatura no momento.",
        },
      ]
    : [
        {
          title: "Pagar agora",
          description: "Itens vencidos, críticos ou que não foram marcados como seguros para atrasar.",
          items: decisionSummary.payNowItems,
          empty: "Nenhum item crítico para pagar agora.",
        },
        {
          title: "Pode esperar",
          description: "Itens com atraso permitido e risco controlado.",
          items: decisionSummary.canWaitItems,
          empty: "Nenhum item claramente seguro para esperar.",
        },
        {
          title: "Atenção na próxima fatura",
          description: "Faturas e parcelas que pressionam o cartão e o próximo mês.",
          items: decisionSummary.nextInvoiceItems,
          empty: "Sem pressão relevante de fatura no mês atual.",
        },
        {
          title: "Risco alto do mês",
          description: "Valores atrasados, críticos ou de alta prioridade.",
          items: decisionSummary.highRiskItems,
          empty: "Nenhum risco alto identificado.",
        },
      ];
  const visibleFlowRows = compactDashboard ? summary.flowRows.slice(0, 5) : summary.flowRows.slice(0, 10);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Visão mensal"
        title="Dashboard de decisão"
        description="Um ponto de partida visual para entender contas, entradas, reembolsos, faturas e riscos do mês."
      />

      <DashboardViewPreferences initialPeriod={period} />

      <SectionCard title="Resumo financeiro" description={compactDashboard ? "Visão simples com o que pede atenção agora." : "Visão completa com o resumo principal do período."}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {overviewCards.map((card) => (
            <StatCard key={card.label} label={card.label} value={card.value} helper={card.helper} tone={card.tone} href={card.href} />
          ))}
        </div>
      </SectionCard>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-ink-950 dark:text-slate-100">Pendências importantes</h2>
          <p className="mt-1 text-sm leading-6 text-ink-600 dark:text-slate-300">O que merece atenção primeiro.</p>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {importantLists.map((list) => (
            <DecisionList key={list.title} title={list.title} description={list.description} items={list.items} empty={list.empty} compact={compactDashboard} />
          ))}
        </div>
      </section>

      <SmartSuggestions suggestions={smartSuggestions} />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Saldo livre estimado"
          value={formatCurrency(decisionSummary.freeCashAfterRealObligations)}
          helper="Renda real menos obrigações. Não conta reembolsos como renda livre."
          tone={decisionSummary.freeCashAfterRealObligations < 0 ? "danger" : "success"}
        />
        <StatCard
          label="Dependência de terceiros"
          value={formatCurrency(decisionSummary.linkedMoneyExpected)}
          helper="Reembolsos e dinheiro de terceiros esperados."
          tone={decisionSummary.linkedMoneyExpected > 0 ? "warning" : "neutral"}
        />
        <StatCard
          label="Pressão do próximo mês"
          value={formatCurrency(decisionSummary.nextMonthPressure)}
          helper="Contas, faturas e parcelas futuras."
          tone="warning"
        />
        <StatCard
          label="Risco alto"
          value={formatCurrency(decisionSummary.highRiskAmount)}
          helper="Contas e faturas de maior risco."
          tone={decisionSummary.highRiskAmount > 0 ? "danger" : "neutral"}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Plano ativo do mês" description="Resumo do cenário escolhido.">
          {activePlan ? (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-semibold text-ink-950">{activePlan.name}</p>
                <p className="mt-1 text-sm leading-6 text-ink-600">
                  {activePlan.description ?? "Plano ativo para decisões do mês."}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <StatCard label="Pagar agora" value={formatCurrency(summary.activePlanPayNow)} helper="Saída imediata." tone="danger" />
                <StatCard label="Próxima fatura" value={formatCurrency(summary.activePlanNextInvoicePressure)} helper="Cartão + parcelas." tone="warning" href={`/dashboard/installments?status=active&${periodQuery}`} />
              </div>
              <Link className="text-sm font-semibold text-mint-600 hover:text-mint-700" href={`/dashboard/payment-plans/${activePlan.id}`}>
                Abrir plano ativo
              </Link>
            </div>
          ) : (
            <EmptyState title="Nenhum plano ativo" description="Crie ou ative um plano de pagamento para ver o cenário do mês aqui." />
          )}
        </SectionCard>
        <SectionCard title="Atenção agora" description="O que pede decisão primeiro.">
          <p className="text-sm leading-6 text-ink-600">
            Existem {summary.pendingCount} contas pendentes e {summary.overdueCount} atrasadas.
            Priorize contas críticas antes de assumir novas compras.
          </p>
        </SectionCard>
        <SectionCard
          title="Regra do saldo projetado"
          description="Projeção útil, mas com separação conceitual."
        >
          <p className="text-sm leading-6 text-ink-600">
            O saldo projetado soma renda real, reembolsos e dinheiro de terceiros menos contas
            pendentes. Reembolsos e valores de terceiros melhoram o caixa, mas não são dinheiro
            livre para gastar.
          </p>
        </SectionCard>
        <SectionCard title="Risco do mês" description="Faturas e dinheiro vinculado em aberto.">
          <p className="text-sm leading-6 text-ink-600">
            Há {summary.openInvoiceCount} faturas abertas ou atrasadas e {summary.openReimbursementCount} reembolsos pendentes.
            O custo pessoal líquido estimado ajuda a enxergar o impacto real depois dos valores vinculados.
          </p>
        </SectionCard>
        <SectionCard title="Resumo do plano ativo" description="Risco, reembolso e parcelamento.">
          <p className="text-sm leading-6 text-ink-600">
            Itens críticos no plano: {formatCurrency(summary.activePlanCriticalRisk)}. Dependência de reembolsos:
            {" "}{formatCurrency(summary.activePlanReimbursementDependency)}. Parcelamentos ativos somam
            {" "}{formatCurrency(summary.activeInstallmentMonthlyAmount)} por mês.
          </p>
        </SectionCard>
        <SectionCard title="Última importação" description="Histórico recente de planilhas.">
          {lastImport ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label="Módulo" value={lastImport.target_type ?? lastImport.module} helper={lastImport.file_name} tone="info" />
              <StatCard label="Linhas importadas" value={String(lastImport.valid_rows)} helper="Válidas ou confirmadas." tone="success" />
              <StatCard label="Linhas com erro" value={String(lastImport.invalid_rows)} helper="Inválidas ou com falha." tone="danger" />
            </div>
          ) : (
            <EmptyState title="Nenhuma importação" description="Importações salvas aparecerão aqui depois do primeiro CSV ou XLSX." />
          )}
        </SectionCard>
        <SectionCard title="Compras e notas" description="Sinais leves para decisões futuras.">
          <p className="text-sm leading-6 text-ink-600">
            Há {summary.activePlannedPurchaseCount} compras planejadas ativas, somando
            {" "}{formatCurrency(summary.plannedPurchasePressure)}. Anotações fixadas: {summary.pinnedNotesCount}.
          </p>
          {notes.length > 0 ? (
            <div className="mt-4 space-y-2">
              {notes.slice(0, 3).map((note) => (
                <Link
                  key={note.id}
                  href="/dashboard/notes"
                  className="block rounded-md border border-ink-950/10 p-3 text-sm transition hover:border-mint-500"
                >
                  <span className="font-semibold text-ink-950">{note.title || "Nota sem título"}</span>
                  <span className="ml-2 text-ink-600">{note.pinned ? "Fixada" : "Recente"}</span>
                </Link>
              ))}
            </div>
          ) : null}
        </SectionCard>
      </section>

      <SectionCard title="Atalhos rápidos" description="Acesso direto às telas mais usadas.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {quickActions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="rounded-lg border border-ink-950/10 bg-white p-4 text-sm font-semibold text-ink-950 transition hover:border-mint-500 hover:shadow-sm dark:border-white/10 dark:bg-slate-950/60 dark:text-slate-100"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p>{action.label}</p>
                  <p className="mt-1 text-xs font-normal text-ink-600 dark:text-slate-300">{action.description}</p>
                </div>
                <span className="text-lg text-mint-600">+</span>
              </div>
            </Link>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Fluxo dos próximos dias" description="Contas e entradas previstas mais próximas.">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-ink-950/10 text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-ink-600">
              <tr>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Descrição</th>
                <th className="px-4 py-3">Valor</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-950/10">
              {visibleFlowRows.map((row) => (
                <tr key={`${row.type}-${row.description}-${row.date}`}>
                  <td className="px-4 py-3 text-ink-600">{formatDate(row.date)}</td>
                  <td className="px-4 py-3 text-ink-600">{row.type}</td>
                  <td className="px-4 py-3 font-medium text-ink-950">{row.description}</td>
                  <td className="px-4 py-3 text-ink-950">{formatCurrency(row.amount)}</td>
                  <td className="px-4 py-3 text-ink-600">{row.status}</td>
                </tr>
              ))}
              {summary.flowRows.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-sm text-ink-600" colSpan={5}>
                    Sem contas ou entradas previstas para exibir.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {compactDashboard && summary.flowRows.length > visibleFlowRows.length ? (
          <p className="mt-3 text-sm text-ink-600">Mostrando as movimentações mais próximas. Abra a visão completa para ver a lista inteira.</p>
        ) : null}
      </SectionCard>
    </div>
  );
}

function DecisionList({
  title,
  description,
  items,
  empty,
  compact = false,
}: {
  title: string;
  description: string;
  items: DecisionItem[];
  empty: string;
  compact?: boolean;
}) {
  return (
    <SectionCard title={title} description={description}>
      {items.length === 0 ? (
        <EmptyState title={empty} description="Os itens aparecerão aqui conforme contas, faturas e parcelas forem cadastradas." />
      ) : (
        <div className={compact ? "space-y-2" : "space-y-3"}>
          {items.map((item) => (
            <Link
              key={`${item.href}-${item.id}`}
              href={item.href}
              className={`block rounded-md border border-ink-950/10 bg-white transition hover:border-mint-500 dark:border-white/10 dark:bg-slate-950/60 ${compact ? "p-3" : "p-4"}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-ink-950">{item.title}</p>
                  <p className="mt-1 text-sm leading-6 text-ink-600">{item.reason}</p>
                  <p className="mt-1 text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                    {formatDate(item.dueDate)}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-semibold text-ink-950">
                  {formatCurrency(item.amount)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function SmartSuggestions({ suggestions }: { suggestions: DashboardSuggestion[] }) {
  if (suggestions.length === 0) {
    return (
      <SectionCard title="Sugestões do sistema" description="Sinais calculados com os dados do período.">
        <EmptyState title="Nenhuma sugestão crítica" description="Quando houver risco, atraso ou oportunidade de decisão, o Hub mostra aqui." />
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Sugestões do sistema" description="Sinais calculados sem IA externa e sem alterar dados.">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {suggestions.map((suggestion) => (
          <Link
            key={`${suggestion.href}-${suggestion.title}`}
            href={suggestion.href}
            className="hub-card block rounded-lg border border-ink-950/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/60"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-ink-950">{suggestion.title}</p>
                <p className="mt-1 text-sm leading-6 text-ink-600">{suggestion.description}</p>
              </div>
              <span className={`hub-status-badge shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${getSuggestionToneClass(suggestion.tone)}`}>
                {getSuggestionToneLabel(suggestion.tone)}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </SectionCard>
  );
}

function getSuggestionToneClass(tone: DashboardSuggestion["tone"]) {
  if (tone === "danger") return "bg-danger-100 text-danger-600";
  if (tone === "warning") return "bg-amberRisk-100 text-amberRisk-500";
  if (tone === "success") return "bg-mint-100 text-mint-600";
  return "bg-slate-100 text-ink-600";
}

function getSuggestionToneLabel(tone: DashboardSuggestion["tone"]) {
  if (tone === "danger") return "Crítico";
  if (tone === "warning") return "Atenção";
  if (tone === "success") return "Ok";
  return "Info";
}

function buildPeriodQuery(period: PeriodValue) {
  const params = new URLSearchParams();
  params.set("period", period.preset);

  if (period.startDate) {
    params.set("start", period.startDate);
  }

  if (period.endDate) {
    params.set("end", period.endDate);
  }

  return params.toString();
}

function parseDashboardMode(searchParams: Record<string, string | string[] | undefined>): DashboardLayoutMode {
  const value = typeof searchParams.mode === "string" ? searchParams.mode : null;
  return value === "full" ? "full" : "simple";
}

function getOverviewCards(
  summary: ReturnType<typeof buildDashboardSummary>,
  decisionSummary: ReturnType<typeof buildFinancialSummary>,
  periodQuery: string,
  compactDashboard: boolean,
) {
  const baseCards = [
    {
      label: "Contas pendentes",
      value: formatCurrency(summary.pendingAccounts),
      helper: "Contas abertas que ainda pressionam o caixa.",
      tone: "warning" as const,
      href: `/dashboard/accounts?status=pending&${periodQuery}`,
    },
    {
      label: "Saldo projetado",
      value: formatCurrency(summary.projectedBalance),
      helper: "Inclui reembolsos e dinheiro de terceiros, que não são renda livre.",
      tone: "info" as const,
    },
    {
      label: "Fatura crítica",
      value: formatCurrency(summary.criticalInvoiceAmount),
      helper: "Fatura aberta, parcial ou atrasada mais pesada.",
      tone: summary.criticalInvoiceAmount > 0 ? ("danger" as const) : ("neutral" as const),
      href: `/dashboard/invoices?status=open&${periodQuery}`,
    },
    {
      label: "Reembolsos pendentes",
      value: formatCurrency(summary.openReimbursements),
      helper: "Pix esperado para cobrir despesas anteriores.",
      tone: "warning" as const,
      href: `/dashboard/reimbursements?status=expected&${periodQuery}`,
    },
    {
      label: "Próxima pressão",
      value: formatCurrency(decisionSummary.nextInvoiceItems.reduce((sum, item) => sum + item.amount, 0)),
      helper: "Itens que pressionam a próxima fatura.",
      tone: "warning" as const,
    },
  ];

  if (compactDashboard) {
    return baseCards;
  }

  return [
    ...baseCards,
    {
      label: "Entradas previstas",
      value: formatCurrency(summary.expectedRealIncome),
      helper: "Somente renda real prevista.",
      tone: "success" as const,
      href: `/dashboard/income?status=expected&${periodQuery}`,
    },
    {
      label: "Prioridade alta",
      value: formatCurrency(summary.highPriorityAccounts),
      helper: "Contas altas ou críticas.",
      tone: "danger" as const,
      href: `/dashboard/accounts?priority=high&${periodQuery}`,
    },
    {
      label: "Dinheiro de terceiros em aberto",
      value: formatCurrency(summary.thirdPartyOpenAmount),
      helper: "Lançamentos de terceiros ou família ainda vinculados.",
      tone: "warning" as const,
      href: `/dashboard/reimbursements?status=expected&${periodQuery}`,
    },
    {
      label: "Custo pessoal líquido estimado",
      value: formatCurrency(summary.estimatedNetPersonalCost),
      helper: "Faturas abertas menos reembolsos esperados.",
      tone: "info" as const,
    },
    {
      label: "Compras planejadas",
      value: formatCurrency(summary.plannedPurchasePressure),
      helper: "Desejos ativos que podem virar gasto.",
      tone: summary.plannedPurchasePressure > 0 ? ("warning" as const) : ("neutral" as const),
      href: `/dashboard/purchases?status=planned&${periodQuery}`,
    },
  ];
}

function getQuickActions() {
  return [
    { label: "Nova conta", description: "Abrir cadastro de conta a pagar.", href: "/dashboard/accounts" },
    { label: "Nova receita", description: "Registrar entrada prevista ou recebida.", href: "/dashboard/income" },
    { label: "Nova compra", description: "Adicionar compra ou desejo.", href: "/dashboard/purchases" },
    { label: "Novo reembolso", description: "Lançar valor a receber de alguém.", href: "/dashboard/reimbursements" },
    { label: "Nova meta", description: "Cadastrar meta pessoal ou profissional.", href: "/dashboard/goals" },
    { label: "Revisão semanal", description: "Abrir o fechamento guiado da semana.", href: "/dashboard/weekly-review" },
    { label: "Diagnóstico financeiro", description: "Ver alertas e saúde geral do sistema.", href: "/dashboard/diagnostics" },
  ];
}

function buildDashboardSuggestions({
  accounts,
  reimbursements,
  goals,
  purchases,
  incomeSources,
}: {
  accounts: AccountPayable[];
  reimbursements: Reimbursement[];
  goals: Goal[];
  purchases: PlannedPurchase[];
  incomeSources: IncomeSource[];
}): DashboardSuggestion[] {
  const today = todayISO();
  const next14Days = addDaysISO(today, 14);
  const suggestions: DashboardSuggestion[] = [];
  const overdueAccounts = accounts.filter((account) => account.status === "overdue" || (account.status === "pending" && account.due_date < today));
  const openReimbursements = reimbursements.filter((item) => ["expected", "partial", "late"].includes(item.status));
  const lateReimbursements = openReimbursements.filter((item) => item.expected_date && item.expected_date < today);
  const nearGoals = goals.filter((goal) => goal.target_date && goal.target_date >= today && goal.target_date <= next14Days && !["completed", "cancelled", "canceled"].includes(goal.status));
  const highRiskPurchases = purchases.filter((purchase) => ["high", "critical"].includes(purchase.risk_level) && !["purchased", "canceled", "cancelled"].includes(purchase.decision_status));
  const waitPurchases = purchases.filter((purchase) => ["wait", "waiting", "promotion", "review"].includes(purchase.decision_status));
  const expectedIncome = incomeSources.filter((income) => income.status === "expected");

  if (overdueAccounts.length > 0) {
    suggestions.push({
      title: `${overdueAccounts.length} conta(s) atrasada(s)`,
      description: `${formatCurrency(overdueAccounts.reduce((sum, item) => sum + Number(item.amount), 0))} exigem decisão antes de novas compras.`,
      href: "/dashboard/accounts?status=overdue",
      tone: "danger",
    });
  }

  if (openReimbursements.length > 0) {
    suggestions.push({
      title: "Reembolsos em aberto",
      description: `${formatCurrency(openReimbursements.reduce((sum, item) => sum + Math.max(Number(item.expected_amount) - Number(item.received_amount), 0), 0))} ainda são dinheiro vinculado.`,
      href: "/dashboard/reimbursements?status=expected",
      tone: lateReimbursements.length > 0 ? "danger" : "warning",
    });
  }

  if (nearGoals.length > 0) {
    suggestions.push({
      title: "Metas próximas do prazo",
      description: `${nearGoals.length} meta(s) vencem nos próximos 14 dias. Revise prioridade e progresso.`,
      href: "/dashboard/goals",
      tone: "warning",
    });
  }

  if (highRiskPurchases.length > 0) {
    suggestions.push({
      title: "Compras de alto risco",
      description: `${formatCurrency(highRiskPurchases.reduce((sum, item) => sum + Number(item.estimated_amount), 0))} em compras marcadas como alto risco.`,
      href: "/dashboard/purchases",
      tone: "danger",
    });
  }

  if (waitPurchases.length > 0) {
    suggestions.push({
      title: "Compras que podem aguardar",
      description: `${waitPurchases.length} item(ns) já sinalizam espera, revisão ou promoção.`,
      href: "/dashboard/purchases",
      tone: "info",
    });
  }

  if (expectedIncome.length > 0) {
    suggestions.push({
      title: "Receitas previstas",
      description: `${formatCurrency(expectedIncome.reduce((sum, item) => sum + Number(item.amount), 0))} previsto no período. Reembolsos continuam separados de renda livre.`,
      href: "/dashboard/income?status=expected",
      tone: "success",
    });
  }

  return suggestions.slice(0, 6);
}

function addDaysISO(date: string, days: number) {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function DashboardError({ message }: { message: string }) {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Visão mensal"
        title="Dashboard de decisão"
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
  notes: Note[],
  activePlan: PaymentPlan | null,
  activePlanItems: PaymentPlanItem[],
  lastImport: ImportBatch | null,
) {
  const today = todayISO();
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  const nextWeekISO = nextWeek.toISOString().slice(0, 10);

  const pendingAccounts = accounts
    .filter((account) => account.status === "pending" || account.status === "overdue")
    .reduce((total, account) => total + Number(account.amount), 0);

  const highPriorityAccounts = accounts
    .filter((account) => account.priority === "high" || account.priority === "critical")
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

  const projectedBalance =
    expectedRealIncome + expectedReimbursements + expectedThirdPartyMoney - pendingAccounts;

  const openInvoices = invoices.filter((invoice) =>
    ["open", "closed", "partial", "overdue"].includes(invoice.status),
  );

  const criticalInvoiceAmount = openInvoices.reduce(
    (max, invoice) => Math.max(max, Number(invoice.total_amount) - Number(invoice.paid_amount)),
    0,
  );

  const openReimbursements = reimbursements
    .filter((item) => ["expected", "partial", "late"].includes(item.status))
    .reduce((total, item) => total + Number(item.expected_amount) - Number(item.received_amount), 0);

  const thirdPartyOpenAmount = transactions
    .filter(
      (transaction) =>
        transaction.is_reimbursable ||
        ["third_party", "shared", "family"].includes(transaction.ownership_type),
    )
    .reduce((total, transaction) => total + Number(transaction.amount), 0);

  const openInvoiceTotal = openInvoices.reduce(
    (total, invoice) => total + Number(invoice.total_amount) - Number(invoice.paid_amount),
    0,
  );

  const estimatedNetPersonalCost = Math.max(openInvoiceTotal - openReimbursements, 0);
  const generatedInstallmentIds = new Set(
    accounts
      .filter((account) => account.installment_id && account.is_generated && account.source_type === "installment")
      .map((account) => account.installment_id as string),
  );
  const activeInstallmentMonthlyAmount = installments
    .filter((item) => item.status === "active" && !item.invoice_id && !generatedInstallmentIds.has(item.id))
    .reduce((total, item) => total + Number(item.installment_amount), 0);

  const activePlannedPurchases = plannedPurchases.filter((item) =>
    !["purchased", "canceled"].includes(item.decision_status),
  );
  const plannedPurchasePressure = activePlannedPurchases.reduce(
    (total, item) => total + Number(item.estimated_amount),
    0,
  );
  const pinnedNotesCount = notes.filter((note) => note.pinned).length;

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
    highPriorityAccounts,
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
    pinnedNotesCount,
    lastImport,
    openInvoiceCount: openInvoices.length,
    openReimbursementCount: reimbursements.filter((item) =>
      ["expected", "partial", "late"].includes(item.status),
    ).length,
    pendingCount: accounts.filter((account) => account.status === "pending").length,
    overdueCount: accounts.filter((account) => account.status === "overdue").length,
    flowRows: [...accountRows, ...incomeRows].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
