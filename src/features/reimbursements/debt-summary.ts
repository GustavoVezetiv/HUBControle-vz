import type { ReimbursementPerson, ReimbursementRow } from "@/features/reimbursements/types";
import type { StatusTone } from "@/components/ui/status-badge";

export type PersonDebtStatus = "em_dia" | "atrasado" | "parcial" | "quitado";
export type PersonDebtViewMode = "open_period" | "late" | "all_debt" | "all_history" | "hide_settled";

export type PersonDebtSummary = {
  person: ReimbursementPerson;
  totalExpected: number;
  received: number;
  open: number;
  late: number;
  periodOpen: number;
  periodExpectedCount: number;
  openCount: number;
  lateCount: number;
  partialCount: number;
  totalCount: number;
  nextExpectedDate: string | null;
  status: PersonDebtStatus;
};

export function buildPersonDebtSummaries(
  people: ReimbursementPerson[],
  reimbursements: ReimbursementRow[],
  today = new Date().toISOString().slice(0, 10),
) {
  return people
    .map((person) => {
      const personRows = reimbursements.filter((item) => item.person_id === person.id);
      const totalExpected = personRows.reduce((sum, item) => sum + Number(item.expected_amount || 0), 0);
      const received = personRows.reduce((sum, item) => sum + Number(item.received_amount || 0), 0);
      const open = personRows.reduce((sum, item) => sum + getReimbursementOpenAmount(item), 0);
      const lateRows = personRows.filter((item) => isReimbursementLateByDate(item, today));
      const periodRows = personRows.filter((item) => isDebtRelevantStatus(item.status));
      const late = lateRows.reduce((sum, item) => sum + getReimbursementOpenAmount(item), 0);
      const periodOpen = periodRows.reduce((sum, item) => sum + getReimbursementOpenAmount(item), 0);
      const openCount = personRows.filter((item) => getReimbursementOpenAmount(item) > 0).length;
      const partialCount = personRows.filter((item) => isDebtRelevantStatus(item.status) && (item.status === "partial" || isPartiallyReceived(item))).length;
      const nextExpectedDate =
        personRows
          .filter((item) => getReimbursementOpenAmount(item) > 0)
          .map((item) => item.expected_date)
          .filter((date): date is string => Boolean(date))
          .sort()
          .at(0) ?? null;
      const status = getPersonDebtStatus({ open, lateCount: lateRows.length, partialCount });

      return {
        person,
        totalExpected,
        received,
        open,
        late,
        periodOpen,
        periodExpectedCount: periodRows.length,
        openCount,
        lateCount: lateRows.length,
        partialCount,
        totalCount: personRows.length,
        nextExpectedDate,
        status,
      };
    })
    .filter((item) => item.totalCount > 0)
    .sort((a, b) => b.open - a.open || b.late - a.late || b.lateCount - a.lateCount || a.person.name.localeCompare(b.person.name));
}

export function filterPersonDebtSummaries(summaries: PersonDebtSummary[], mode: PersonDebtViewMode) {
  if (mode === "all_history") return summaries;
  if (mode === "late") return summaries.filter((item) => item.late > 0);
  if (mode === "all_debt") return summaries.filter((item) => item.open > 0 || item.partialCount > 0 || item.late > 0);
  if (mode === "hide_settled") return summaries.filter((item) => item.open > 0 || item.partialCount > 0 || item.late > 0);
  return summaries.filter(
    (item) => item.periodOpen > 0 || item.periodExpectedCount > 0 || item.partialCount > 0 || item.late > 0,
  );
}

export function getReimbursementOpenAmount(reimbursement: ReimbursementRow) {
  if (["received", "cancelled", "forgiven", "renegotiated"].includes(reimbursement.status)) return 0;
  return Math.max(Number(reimbursement.expected_amount || 0) - Number(reimbursement.received_amount || 0), 0);
}

export function isReimbursementLateByDate(reimbursement: ReimbursementRow, today = new Date().toISOString().slice(0, 10)) {
  return Boolean(
    reimbursement.expected_date &&
      reimbursement.expected_date < today &&
      isDebtRelevantStatus(reimbursement.status) &&
      getReimbursementOpenAmount(reimbursement) > 0,
  );
}

export function getPersonDebtStatusLabel(status: PersonDebtStatus) {
  if (status === "atrasado") return "Atrasado";
  if (status === "parcial") return "Parcial";
  if (status === "quitado") return "Quitado";
  return "Em dia";
}

export function getPersonDebtStatusTone(status: PersonDebtStatus): StatusTone {
  if (status === "atrasado") return "danger";
  if (status === "parcial") return "warning";
  if (status === "quitado") return "neutral";
  return "success";
}

function getPersonDebtStatus({
  open,
  lateCount,
  partialCount,
}: {
  open: number;
  lateCount: number;
  partialCount: number;
}): PersonDebtStatus {
  if (lateCount > 0) return "atrasado";
  if (partialCount > 0) return "parcial";
  if (open > 0) return "em_dia";
  return "quitado";
}

function isPartiallyReceived(reimbursement: ReimbursementRow) {
  const received = Number(reimbursement.received_amount || 0);
  const expected = Number(reimbursement.expected_amount || 0);
  return received > 0 && received < expected;
}

function isDebtRelevantStatus(status: ReimbursementRow["status"]) {
  return !["received", "cancelled", "forgiven", "renegotiated"].includes(status);
}
