import type { AccountPayable } from "@/lib/supabase/types";

const openStatuses = new Set(["pending", "overdue"]);

export type AccountInterestBreakdown = {
  principal: number;
  interest: number;
  lateFee: number;
  total: number;
  overdueDays: number;
  periods: number;
  isAccruing: boolean;
};

export function calculateAccountInterest(
  account: Pick<
    AccountPayable,
    | "amount"
    | "due_date"
    | "status"
    | "late_interest_enabled"
    | "late_interest_rate"
    | "late_interest_frequency"
    | "late_fee_amount"
    | "interest_start_date"
  >,
  asOf = new Date(),
): AccountInterestBreakdown {
  const principal = Math.max(Number(account.amount) || 0, 0);
  const startDate = account.interest_start_date || addDays(account.due_date, 1);
  const asOfDate = toISODate(asOf);
  const overdueDays = Math.max(diffDays(startDate, asOfDate) + 1, 0);
  const isAccruing = Boolean(
    account.late_interest_enabled &&
      openStatuses.has(account.status) &&
      startDate &&
      asOfDate >= startDate,
  );

  if (!isAccruing) {
    return { principal, interest: 0, lateFee: 0, total: principal, overdueDays: 0, periods: 0, isAccruing: false };
  }

  const periods = account.late_interest_frequency === "daily" ? overdueDays : Math.max(Math.ceil(overdueDays / 30), 1);
  const interest = roundMoney(principal * (Math.max(Number(account.late_interest_rate) || 0, 0) / 100) * periods);
  const lateFee = roundMoney(Math.max(Number(account.late_fee_amount) || 0, 0));

  return {
    principal,
    interest,
    lateFee,
    total: roundMoney(principal + interest + lateFee),
    overdueDays,
    periods,
    isAccruing: true,
  };
}

function addDays(date: string, days: number) {
  const parsed = parseISODate(date);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function diffDays(start: string, end: string) {
  return Math.floor((parseISODate(end).getTime() - parseISODate(start).getTime()) / 86_400_000);
}

function parseISODate(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}

function toISODate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
