import type {
  ReimbursementCard,
  ReimbursementCategory,
  ReimbursementInvoice,
  ReimbursementPerson,
  ReimbursementRow,
  ReimbursementTransaction,
} from "./types";

export type AdvancedReimbursementFilters = {
  balanceFilter: string;
  maturityFilter: string;
  recurrenceFilter: string;
  cardFilter: string;
  minAmount: string;
  maxAmount: string;
};

export const defaultAdvancedReimbursementFilters: AdvancedReimbursementFilters = {
  balanceFilter: "all",
  maturityFilter: "all",
  recurrenceFilter: "all",
  cardFilter: "all",
  minAmount: "",
  maxAmount: "",
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function getAmountRangeError(minAmount: string, maxAmount: string) {
  const min = minAmount === "" ? null : Number(minAmount);
  const max = maxAmount === "" ? null : Number(maxAmount);
  if (
    (min !== null && (!Number.isFinite(min) || min < 0)) ||
    (max !== null && (!Number.isFinite(max) || max < 0))
  )
    return "Informe valores válidos, maiores ou iguais a zero.";
  if (min !== null && max !== null && min > max)
    return "O saldo mínimo não pode ser maior que o máximo.";
  return null;
}

export function filterReimbursementRows(
  rows: ReimbursementRow[],
  filters: AdvancedReimbursementFilters & {
    search: string;
    personFilter: string;
    statusFilter: string;
    linkedFilter: string;
    categoryFilter: string;
  },
  refs: {
    people: ReimbursementPerson[];
    categories: ReimbursementCategory[];
    cards: ReimbursementCard[];
    invoices: ReimbursementInvoice[];
    transactions: ReimbursementTransaction[];
  },
  today: string,
) {
  if (getAmountRangeError(filters.minAmount, filters.maxAmount)) return [];
  const people = new Map(refs.people.map((person) => [person.id, person]));
  const categories = new Map(refs.categories.map((category) => [category.id, category]));
  const cards = new Map(refs.cards.map((card) => [card.id, card]));
  const invoices = new Map(refs.invoices.map((invoice) => [invoice.id, invoice]));
  const transactions = new Map(
    refs.transactions.map((transaction) => [transaction.id, transaction]),
  );
  const needle = normalize(filters.search);
  const week = new Date(`${today}T12:00:00Z`);
  week.setUTCDate(week.getUTCDate() + 7);
  const nextWeek = week.toISOString().slice(0, 10);
  const closed = new Set([
    "received",
    "cancelled",
    "forgiven",
    "renegotiated",
    "carried_over",
  ]);
  return rows.filter((row) => {
    const remaining = closed.has(row.status)
      ? 0
      : Math.max(Number(row.expected_amount) - Number(row.received_amount), 0);
    const open = remaining > 0.009;
    const recurring = row.is_recurring || Boolean(row.recurrence_parent_id);
    const cardId =
      transactions.get(row.credit_card_transaction_id ?? "")?.credit_card_id ??
      invoices.get(row.credit_card_invoice_id ?? "")?.credit_card_id ??
      null;
    const hasLink = Boolean(
      row.credit_card_transaction_id ||
      row.credit_card_invoice_id ||
      row.account_payable_id ||
      row.income_source_id,
    );
    return (
      (!needle ||
        normalize(
          [
            row.description,
            row.notes,
            people.get(row.person_id)?.name,
            categories.get(row.category_id ?? "")?.name,
            cards.get(cardId ?? "")?.name,
          ]
            .filter(Boolean)
            .join(" "),
        ).includes(needle)) &&
      (filters.personFilter === "all" || filters.personFilter === row.person_id) &&
      (filters.statusFilter === "all" || filters.statusFilter === row.status) &&
      (filters.categoryFilter === "all" ||
        (filters.categoryFilter === "none" && !row.category_id) ||
        filters.categoryFilter === row.category_id) &&
      (filters.linkedFilter === "all" ||
        (filters.linkedFilter === "linked" && hasLink) ||
        (filters.linkedFilter === "manual" && !hasLink)) &&
      (filters.balanceFilter === "all" ||
        (filters.balanceFilter === "open" && open) ||
        (filters.balanceFilter === "closed" && !open)) &&
      (filters.maturityFilter === "all" ||
        (filters.maturityFilter === "undated" && !row.expected_date) ||
        (filters.maturityFilter === "late" &&
          open &&
          Boolean(row.expected_date && row.expected_date < today)) ||
        (filters.maturityFilter === "today" && open && row.expected_date === today) ||
        (filters.maturityFilter === "week" &&
          open &&
          Boolean(
            row.expected_date &&
            row.expected_date >= today &&
            row.expected_date <= nextWeek,
          ))) &&
      (filters.recurrenceFilter === "all" ||
        (filters.recurrenceFilter === "recurring" && recurring) ||
        (filters.recurrenceFilter === "single" && !recurring)) &&
      (filters.cardFilter === "all" ||
        (filters.cardFilter === "none" &&
          !cardId &&
          !row.credit_card_transaction_id &&
          !row.credit_card_invoice_id) ||
        filters.cardFilter === cardId) &&
      (filters.minAmount === "" ||
        Math.round(remaining * 100) >= Math.round(Number(filters.minAmount) * 100)) &&
      (filters.maxAmount === "" ||
        Math.round(remaining * 100) <= Math.round(Number(filters.maxAmount) * 100))
    );
  });
}
