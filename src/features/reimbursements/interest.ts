import type { Reimbursement } from "@/lib/supabase/types";

const closedStatuses = new Set(["received", "cancelled", "forgiven", "renegotiated", "carried_over"]);

export type ReimbursementInterestBreakdown = {
  principalOpen: number;
  interest: number;
  lateFee: number;
  totalOpen: number;
  overdueDays: number;
  periods: number;
  isAccruing: boolean;
};

export function calculateReimbursementInterest(
  reimbursement: Pick<
    Reimbursement,
    | "expected_amount"
    | "received_amount"
    | "expected_date"
    | "status"
    | "late_interest_enabled"
    | "late_interest_rate"
    | "late_interest_frequency"
    | "late_fee_amount"
    | "interest_start_date"
  >,
  asOf = new Date(),
): ReimbursementInterestBreakdown {
  const principalOpen = Math.max(Number(reimbursement.expected_amount || 0) - Number(reimbursement.received_amount || 0), 0);
  const startDate = reimbursement.interest_start_date || (reimbursement.expected_date ? addDays(reimbursement.expected_date, 1) : null);
  const asOfDate = toISODate(asOf);
  const isAccruing = Boolean(
    principalOpen > 0 &&
      reimbursement.late_interest_enabled &&
      !closedStatuses.has(reimbursement.status) &&
      startDate &&
      asOfDate >= startDate,
  );

  if (!isAccruing) {
    return { principalOpen, interest: 0, lateFee: 0, totalOpen: principalOpen, overdueDays: 0, periods: 0, isAccruing: false };
  }

  const overdueDays = Math.max(diffDays(startDate as string, asOfDate) + 1, 0);
  const periods = reimbursement.late_interest_frequency === "daily" ? overdueDays : Math.max(Math.ceil(overdueDays / 30), 1);
  const interest = roundMoney(principalOpen * (Math.max(Number(reimbursement.late_interest_rate) || 0, 0) / 100) * periods);
  const lateFee = roundMoney(Math.max(Number(reimbursement.late_fee_amount) || 0, 0));

  return {
    principalOpen,
    interest,
    lateFee,
    totalOpen: roundMoney(principalOpen + interest + lateFee),
    overdueDays,
    periods,
    isAccruing: true,
  };
}

function addDays(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function diffDays(start: string, end: string) {
  return Math.floor((new Date(`${end}T00:00:00.000Z`).getTime() - new Date(`${start}T00:00:00.000Z`).getTime()) / 86_400_000);
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
