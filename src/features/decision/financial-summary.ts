import type {
  AccountPayable,
  CreditCardInvoice,
  CreditCardTransaction,
  IncomeSource,
  Installment,
  PaymentPlan,
  PaymentPlanItem,
  Reimbursement,
} from "@/lib/supabase/types";
import type { PeriodValue } from "@/features/shared/period";
import { calculateAccountInterest } from "@/features/accounts-payable/interest";
import { calculateReimbursementInterest } from "@/features/reimbursements/interest";

export type FinancialDataset = {
  accounts: AccountPayable[];
  incomeSources: IncomeSource[];
  invoices: CreditCardInvoice[];
  transactions: CreditCardTransaction[];
  reimbursements: Reimbursement[];
  installments: Installment[];
  activePlan: PaymentPlan | null;
  activePlanItems: PaymentPlanItem[];
};

export type FlowRow = {
  date: string;
  type: string;
  description: string;
  amount: number;
  direction: "in" | "out";
  status: string;
  linkedMoney: boolean;
};

export type DecisionItem = {
  id: string;
  title: string;
  amount: number;
  dueDate: string | null;
  reason: string;
  href: string;
  tone: "danger" | "warning" | "info" | "success" | "neutral";
};

export type FinancialSummary = {
  monthStart: string;
  monthEnd: string;
  nextMonthStart: string;
  nextMonthEnd: string;
  realIncomeExpected: number;
  reimbursementsExpected: number;
  thirdPartyMoneyExpected: number;
  pendingAccounts: number;
  overdueAccounts: number;
  openInvoices: number;
  overdueInvoices: number;
  activeInstallmentsMonthly: number;
  projectedBalance: number;
  freeCashAfterRealObligations: number;
  linkedMoneyExpected: number;
  reimbursementDependencyRatio: number;
  nextMonthPressure: number;
  highRiskAmount: number;
  criticalRiskAmount: number;
  reimbursableTransactionAmount: number;
  openReimbursementAmount: number;
  estimatedNetInvoiceCost: number;
  payNowItems: DecisionItem[];
  canWaitItems: DecisionItem[];
  nextInvoiceItems: DecisionItem[];
  highRiskItems: DecisionItem[];
  flowRows: FlowRow[];
};

const openAccountStatuses = new Set(["pending", "overdue"]);
const openInvoiceStatuses = new Set(["open", "closed", "partial", "overdue"]);
const openReimbursementStatuses = new Set(["expected", "partial", "late"]);

export function buildFinancialSummary(data: FinancialDataset, period?: PeriodValue, now = new Date()): FinancialSummary {
  const boundaries = getMonthBoundaries(now, period);
  const activeAccounts = data.accounts.filter((account) => openAccountStatuses.has(account.status));
  const currentAccounts = activeAccounts.filter((account) =>
    isWithin(account.due_date, boundaries.monthStart, boundaries.monthEnd),
  );
  const nextMonthAccounts = activeAccounts.filter((account) =>
    isWithin(account.due_date, boundaries.nextMonthStart, boundaries.nextMonthEnd),
  );
  const currentIncome = data.incomeSources.filter(
    (income) =>
      income.status === "expected" &&
      income.expected_date &&
      isWithin(income.expected_date, boundaries.monthStart, boundaries.monthEnd),
  );
  const currentInvoices = data.invoices.filter(
    (invoice) =>
      openInvoiceStatuses.has(invoice.status) &&
      isWithin(invoice.due_date, boundaries.monthStart, boundaries.monthEnd),
  );
  const nextMonthInvoices = data.invoices.filter(
    (invoice) =>
      openInvoiceStatuses.has(invoice.status) &&
      isWithin(invoice.due_date, boundaries.nextMonthStart, boundaries.nextMonthEnd),
  );
  const generatedCurrentInstallmentIds = getGeneratedInstallmentIds(data.accounts, boundaries.monthStart, boundaries.monthEnd);
  const generatedNextMonthInstallmentIds = getGeneratedInstallmentIds(data.accounts, boundaries.nextMonthStart, boundaries.nextMonthEnd);
  const activeInstallments = data.installments.filter((installment) => installment.status === "active");
  const currentInstallments = activeInstallments.filter((installment) =>
    !installment.invoice_id &&
    !generatedCurrentInstallmentIds.has(installment.id) &&
    isWithin(installment.due_month, boundaries.monthStart, boundaries.monthEnd),
  );
  const nextMonthInstallments = activeInstallments.filter((installment) =>
    !installment.invoice_id &&
    !generatedNextMonthInstallmentIds.has(installment.id) &&
    isWithin(installment.due_month, boundaries.nextMonthStart, boundaries.nextMonthEnd),
  );
  const openReimbursements = data.reimbursements.filter((item) =>
    openReimbursementStatuses.has(item.status),
  );
  const currentReimbursements = openReimbursements.filter(
    (item) =>
      isWithin(item.expected_date, boundaries.monthStart, boundaries.monthEnd) ||
      isWithin(item.received_date, boundaries.monthStart, boundaries.monthEnd),
  );

  const realIncomeExpected = sum(
    currentIncome.filter((income) => income.inflow_kind === "real_income"),
    (income) => income.amount,
  );
  const reimbursementsExpected = sum(
    currentIncome.filter((income) => income.inflow_kind === "reimbursement"),
    (income) => income.amount,
  );
  const thirdPartyMoneyExpected = sum(
    currentIncome.filter((income) => income.inflow_kind === "third_party_money"),
    (income) => income.amount,
  );
  const pendingAccounts = sum(currentAccounts, (account) => calculateAccountInterest(account, now).total);
  const overdueAccounts = sum(
    currentAccounts.filter((account) => account.status === "overdue"),
    (account) => calculateAccountInterest(account, now).total,
  );
  const openInvoices = sum(currentInvoices, invoiceOpenAmount);
  const overdueInvoices = sum(
    currentInvoices.filter((invoice) => invoice.status === "overdue"),
    invoiceOpenAmount,
  );
  const activeInstallmentsMonthly = sum(currentInstallments, (installment) => installment.installment_amount);
  const openReimbursementAmount = sum(currentReimbursements, reimbursementOpenAmount);
  const reimbursableTransactionAmount = sum(
    data.transactions.filter(
      (transaction) =>
        transaction.is_reimbursable ||
        ["third_party", "shared", "family"].includes(transaction.ownership_type),
    ),
    (transaction) => transaction.amount,
  );
  const linkedMoneyExpected = reimbursementsExpected + thirdPartyMoneyExpected + openReimbursementAmount;
  const realObligations = pendingAccounts + openInvoices + activeInstallmentsMonthly;
  const projectedBalance = realIncomeExpected + linkedMoneyExpected - realObligations;
  const freeCashAfterRealObligations = realIncomeExpected - realObligations;
  const nextMonthPressure =
    sum(nextMonthAccounts, (account) => calculateAccountInterest(account, now).total) +
    sum(nextMonthInvoices, invoiceOpenAmount) +
    sum(nextMonthInstallments, (installment) => installment.installment_amount);
  const highRiskAccounts = currentAccounts.filter((account) =>
    ["high", "critical"].includes(account.priority) || ["high", "critical"].includes(account.risk_level),
  );
  const criticalRiskAmount =
    sum(currentAccounts.filter((account) => account.priority === "critical" || account.risk_level === "critical"), (account) => calculateAccountInterest(account, now).total) +
    overdueAccounts +
    overdueInvoices;
  const highRiskAmount = sum(highRiskAccounts, (account) => calculateAccountInterest(account, now).total) + overdueInvoices;
  const estimatedNetInvoiceCost = Math.max(openInvoices - openReimbursementAmount, 0);
  const reimbursementDependencyRatio =
    realIncomeExpected > 0 ? Math.min(linkedMoneyExpected / realIncomeExpected, 9.99) : linkedMoneyExpected > 0 ? 1 : 0;

  return {
    ...boundaries,
    realIncomeExpected,
    reimbursementsExpected,
    thirdPartyMoneyExpected,
    pendingAccounts,
    overdueAccounts,
    openInvoices,
    overdueInvoices,
    activeInstallmentsMonthly,
    projectedBalance,
    freeCashAfterRealObligations,
    linkedMoneyExpected,
    reimbursementDependencyRatio,
    nextMonthPressure,
    highRiskAmount,
    criticalRiskAmount,
    reimbursableTransactionAmount,
    openReimbursementAmount,
    estimatedNetInvoiceCost,
    payNowItems: buildPayNowItems(currentAccounts, currentInvoices, now),
    canWaitItems: buildCanWaitItems(currentAccounts, now),
    nextInvoiceItems: buildNextInvoiceItems(currentInvoices, currentInstallments),
    highRiskItems: buildHighRiskItems(currentAccounts, currentInvoices, now),
    flowRows: buildFlowRows(currentAccounts, currentIncome, currentInvoices, currentInstallments, currentReimbursements, now),
  };
}

function getGeneratedInstallmentIds(accounts: AccountPayable[], start: string, end: string) {
  return new Set(
    accounts
      .filter((account) =>
        account.installment_id &&
        account.is_generated &&
        account.source_type === "installment" &&
        isWithin(account.due_date, start, end),
      )
      .map((account) => account.installment_id as string),
  );
}

export function invoiceOpenAmount(invoice: CreditCardInvoice) {
  return Math.max(Number(invoice.total_amount) - Number(invoice.paid_amount), 0);
}

export function reimbursementOpenAmount(reimbursement: Reimbursement) {
  return calculateReimbursementInterest(reimbursement).totalOpen;
}

function buildPayNowItems(accounts: AccountPayable[], invoices: CreditCardInvoice[], now: Date) {
  const accountItems = accounts
    .filter(
      (account) =>
        account.status === "overdue" ||
        account.priority === "critical" ||
        account.risk_level === "critical" ||
        !account.can_delay,
    )
    .map((account) => ({
      id: account.id,
      title: account.title,
      amount: calculateAccountInterest(account, now).total,
      dueDate: account.due_date,
      reason: account.status === "overdue" ? "Atrasada" : "Evita risco ou multa",
      href: "/dashboard/accounts",
      tone: "danger" as const,
    }));
  const invoiceItems = invoices
    .filter((invoice) => invoice.status === "overdue")
    .map((invoice) => ({
      id: invoice.id,
      title: "Fatura atrasada",
      amount: invoiceOpenAmount(invoice),
      dueDate: invoice.due_date,
      reason: "Juros do cartão costumam ser o maior risco",
      href: `/dashboard/invoices/${invoice.id}`,
      tone: "danger" as const,
    }));

  return [...accountItems, ...invoiceItems].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 6);
}

function buildCanWaitItems(accounts: AccountPayable[], now: Date) {
  return accounts
    .filter(
      (account) =>
        account.status === "pending" &&
        account.can_delay &&
        !["high", "critical"].includes(account.priority) &&
        !["high", "critical"].includes(account.risk_level),
    )
    .map((account) => ({
      id: account.id,
      title: account.title,
      amount: calculateAccountInterest(account, now).total,
      dueDate: account.due_date,
      reason: "Marcada como pode atrasar e com risco controlado",
      href: "/dashboard/accounts",
      tone: "info" as const,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6);
}

function buildNextInvoiceItems(invoices: CreditCardInvoice[], installments: Installment[]) {
  const invoiceItems = invoices.map((invoice) => ({
    id: invoice.id,
    title: "Fatura aberta",
    amount: invoiceOpenAmount(invoice),
    dueDate: invoice.due_date,
    reason: "Pressiona o caixa do cartão neste mês",
    href: `/dashboard/invoices/${invoice.id}`,
    tone: "warning" as const,
  }));
  const installmentItems = installments.map((installment) => ({
    id: installment.id,
    title: installment.description,
    amount: Number(installment.installment_amount),
    dueDate: installment.due_month,
    reason: "Parcela ativa afeta faturas e caixa futuro",
    href: "/dashboard/installments",
    tone: "warning" as const,
  }));

  return [...invoiceItems, ...installmentItems].sort((a, b) => b.amount - a.amount).slice(0, 6);
}

function buildHighRiskItems(accounts: AccountPayable[], invoices: CreditCardInvoice[], now: Date) {
  return [
    ...accounts
      .filter((account) => ["high", "critical"].includes(account.priority) || account.status === "overdue")
      .map((account) => ({
        id: account.id,
        title: account.title,
        amount: calculateAccountInterest(account, now).total,
        dueDate: account.due_date,
        reason: account.status === "overdue" ? "Atrasada" : `Prioridade ${account.priority}`,
        href: "/dashboard/accounts",
        tone: account.priority === "critical" || account.status === "overdue" ? "danger" as const : "warning" as const,
      })),
    ...invoices
      .filter((invoice) => invoice.status === "overdue")
      .map((invoice) => ({
        id: invoice.id,
        title: "Fatura atrasada",
        amount: invoiceOpenAmount(invoice),
        dueDate: invoice.due_date,
        reason: "Atraso de cartão",
        href: `/dashboard/invoices/${invoice.id}`,
        tone: "danger" as const,
      })),
  ].sort((a, b) => b.amount - a.amount).slice(0, 6);
}

function buildFlowRows(
  accounts: AccountPayable[],
  incomeSources: IncomeSource[],
  invoices: CreditCardInvoice[],
  installments: Installment[],
  reimbursements: Reimbursement[],
  now: Date,
) {
  const rows: FlowRow[] = [
    ...accounts.map((account) => ({
      date: account.due_date,
      type: "Conta",
      description: account.title,
      amount: calculateAccountInterest(account, now).total,
      direction: "out" as const,
      status: account.status === "overdue" ? "Atrasada" : "Pendente",
      linkedMoney: false,
    })),
    ...incomeSources.map((income) => ({
      date: income.expected_date ?? "",
      type: income.inflow_kind === "real_income" ? "Receita real" : "Entrada vinculada",
      description: income.name,
      amount: Number(income.amount),
      direction: "in" as const,
      status: income.inflow_kind === "real_income" ? "Livre" : "Não é renda livre",
      linkedMoney: income.inflow_kind !== "real_income",
    })),
    ...invoices.map((invoice) => ({
      date: invoice.due_date,
      type: "Fatura",
      description: "Fatura de cartão",
      amount: invoiceOpenAmount(invoice),
      direction: "out" as const,
      status: invoice.status === "overdue" ? "Atrasada" : "Aberta",
      linkedMoney: false,
    })),
    ...installments.map((installment) => ({
      date: normalizeDate(installment.due_month) ?? installment.due_month,
      type: "Parcelamento",
      description: installment.description,
      amount: Number(installment.installment_amount),
      direction: "out" as const,
      status: "Ativo",
      linkedMoney: false,
    })),
    ...reimbursements
      .filter((item) => item.expected_date)
      .map((item) => ({
        date: item.expected_date ?? "",
        type: "Reembolso",
        description: item.description ?? "Reembolso esperado",
        amount: reimbursementOpenAmount(item),
        direction: "in" as const,
        status: item.status === "late" ? "Atrasado" : "Dinheiro vinculado",
        linkedMoney: true,
      })),
  ];

  return rows.filter((row) => row.date).sort((a, b) => a.date.localeCompare(b.date));
}

function getMonthBoundaries(now: Date, period?: PeriodValue) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const nextMonth = new Date(year, month + 1, 1);
  const nextMonthYear = nextMonth.getFullYear();
  const nextMonthIndex = nextMonth.getMonth();

  if (period && period.preset !== "all") {
    const nextPeriodStart = addDays(parseISODate(period.endDate), 1);
    const nextPeriodEnd = addMonths(nextPeriodStart, 1);
    nextPeriodEnd.setDate(nextPeriodEnd.getDate() - 1);

    return {
      monthStart: period.startDate,
      monthEnd: period.endDate,
      nextMonthStart: toISODate(nextPeriodStart),
      nextMonthEnd: toISODate(nextPeriodEnd),
    };
  }

  if (period?.preset === "all") {
    return {
      monthStart: "0001-01-01",
      monthEnd: "9999-12-31",
      nextMonthStart: toISODate(new Date(nextMonthYear, nextMonthIndex, 1)),
      nextMonthEnd: toISODate(new Date(nextMonthYear, nextMonthIndex + 1, 0)),
    };
  }

  return {
    monthStart: toISODate(new Date(year, month, 1)),
    monthEnd: toISODate(new Date(year, month + 1, 0)),
    nextMonthStart: toISODate(new Date(nextMonthYear, nextMonthIndex, 1)),
    nextMonthEnd: toISODate(new Date(nextMonthYear, nextMonthIndex + 1, 0)),
  };
}

function isWithin(date: string | null, start: string, end: string) {
  const normalized = normalizeDate(date);

  return Boolean(normalized && normalized >= start && normalized <= end);
}

function sum<T>(items: T[], selector: (item: T) => number) {
  return items.reduce((total, item) => total + Number(selector(item) || 0), 0);
}

function toISODate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDate(date: string | null) {
  if (!date) return null;
  if (/^\d{4}-\d{2}$/.test(date)) return `${date}-01`;
  return date;
}

function parseISODate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addMonths(date: Date, months: number) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}
