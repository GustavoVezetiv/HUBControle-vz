import type { AppSupabaseClient } from "@/features/shared/types";
import type { CreditCard, CreditCardInvoice } from "@/lib/supabase/types";

export type InvoiceCycleCard = Pick<CreditCard, "id" | "name" | "closing_day" | "due_day">;
export type AutoInvoiceRow = Pick<
  CreditCardInvoice,
  "id" | "credit_card_id" | "reference_month" | "closing_date" | "due_date" | "status" | "total_amount" | "paid_amount"
> & {
  archived_at?: string | null;
};

export type InvoiceCycleDates = {
  reference_month: string;
  closing_date: string;
  due_date: string;
};

export type FindOrCreateInvoiceResult = {
  invoice: AutoInvoiceRow | null;
  created: boolean;
  error: { message: string } | null;
};

export type GenerateFutureInvoicesResult = {
  created: number;
  existing: number;
  errors: string[];
};

export function calculateInvoiceCycleForTransactionDate(
  card: InvoiceCycleCard,
  transactionDate: string,
): InvoiceCycleDates {
  validateCardCycle(card);
  const [year, month, day] = parseDateParts(transactionDate);
  const referenceDate = new Date(year, month - 1 + (day > Number(card.closing_day) ? 1 : 0), 1);

  return calculateInvoiceCycleForReferenceMonth(card, toMonthInputValue(referenceDate));
}

export function calculateInvoiceCycleForReferenceMonth(
  card: InvoiceCycleCard,
  referenceMonth: string,
): InvoiceCycleDates {
  validateCardCycle(card);
  const [year, month] = referenceMonth.slice(0, 7).split("-").map(Number);
  const closingDate = buildClampedDate(year, month, Number(card.closing_day));
  const dueOffset = Number(card.due_day) <= Number(card.closing_day) ? 1 : 0;
  const dueBaseDate = new Date(year, month - 1 + dueOffset, 1);
  const dueDate = buildClampedDate(dueBaseDate.getFullYear(), dueBaseDate.getMonth() + 1, Number(card.due_day));

  return {
    reference_month: `${toMonthInputValue(new Date(year, month - 1, 1))}-01`,
    closing_date: closingDate,
    due_date: dueDate,
  };
}

export async function findOrCreateInvoiceForTransactionDate(
  client: AppSupabaseClient,
  userId: string,
  creditCardId: string,
  transactionDate: string,
): Promise<FindOrCreateInvoiceResult> {
  const cardResult = await client
    .from("credit_cards")
    .select("id,name,closing_day,due_day")
    .eq("user_id", userId)
    .eq("id", creditCardId)
    .single();

  if (cardResult.error || !cardResult.data) {
    console.error("Erro técnico ao buscar cartão para fatura automática:", cardResult.error);
    return { invoice: null, created: false, error: { message: "Não foi possível buscar o cartão para definir a fatura." } };
  }

  try {
    return findOrCreateInvoiceForCycle(client, userId, cardResult.data, calculateInvoiceCycleForTransactionDate(cardResult.data, transactionDate));
  } catch (error) {
    console.error("Erro técnico ao calcular fatura automática:", error);
    return { invoice: null, created: false, error: { message: error instanceof Error ? error.message : "Não foi possível calcular a fatura correta." } };
  }
}

export async function findOrCreateInvoiceForReferenceMonth(
  client: AppSupabaseClient,
  userId: string,
  card: InvoiceCycleCard,
  referenceMonth: string,
): Promise<FindOrCreateInvoiceResult> {
  try {
    return findOrCreateInvoiceForCycle(client, userId, card, calculateInvoiceCycleForReferenceMonth(card, referenceMonth));
  } catch (error) {
    console.error("Erro técnico ao calcular fatura por mês de referência:", error);
    return { invoice: null, created: false, error: { message: error instanceof Error ? error.message : "Não foi possível calcular a fatura correta." } };
  }
}

export async function generateFutureInvoicesForCard(
  client: AppSupabaseClient,
  userId: string,
  creditCardId: string,
  months: number,
): Promise<GenerateFutureInvoicesResult> {
  const safeMonths = Math.min(Math.max(Math.floor(months), 1), 24);
  const cardResult = await client
    .from("credit_cards")
    .select("id,name,closing_day,due_day")
    .eq("user_id", userId)
    .eq("id", creditCardId)
    .single();

  if (cardResult.error || !cardResult.data) {
    console.error("Erro técnico ao buscar cartão para gerar faturas futuras:", cardResult.error);
    return { created: 0, existing: 0, errors: ["Não foi possível buscar o cartão selecionado."] };
  }

  const today = new Date();
  let created = 0;
  let existing = 0;
  const errors: string[] = [];

  for (let index = 0; index < safeMonths; index += 1) {
    const referenceDate = new Date(today.getFullYear(), today.getMonth() + index, 1);
    const result = await findOrCreateInvoiceForReferenceMonth(
      client,
      userId,
      cardResult.data,
      toMonthInputValue(referenceDate),
    );

    if (result.error) {
      errors.push(result.error.message);
    } else if (result.created) {
      created += 1;
    } else {
      existing += 1;
    }
  }

  return { created, existing, errors };
}

export async function ensureInvoicesForTransactionDates(
  client: AppSupabaseClient,
  userId: string,
  creditCardId: string,
  dates: string[],
): Promise<{ invoicesByDate: Map<string, AutoInvoiceRow>; error: { message: string } | null }> {
  const invoicesByDate = new Map<string, AutoInvoiceRow>();
  const uniqueDates = [...new Set(dates.filter(Boolean))];

  for (const date of uniqueDates) {
    const result = await findOrCreateInvoiceForTransactionDate(client, userId, creditCardId, date);
    if (result.error || !result.invoice) {
      return { invoicesByDate: new Map(), error: result.error ?? { message: "Não foi possível preparar faturas automáticas." } };
    }
    invoicesByDate.set(date, result.invoice);
  }

  return { invoicesByDate, error: null };
}

export async function recalculateInvoiceTotal(client: AppSupabaseClient, userId: string, invoiceId: string) {
  const invoiceResult = await client
    .from("credit_card_invoices")
    .select("id,status")
    .eq("user_id", userId)
    .eq("id", invoiceId)
    .is("archived_at", null)
    .single();

  if (invoiceResult.error || !invoiceResult.data) {
    console.error("Erro técnico ao buscar fatura para recalcular total:", invoiceResult.error);
    return { totalAmount: 0, error: invoiceResult.error ?? { message: "Fatura não encontrada." } };
  }

  if (invoiceResult.data.status === "paid") {
    return { totalAmount: 0, error: null, skipped: true };
  }

  const transactionsResult = await client
    .from("credit_card_transactions")
    .select("amount")
    .eq("user_id", userId)
    .eq("invoice_id", invoiceId)
    .is("archived_at", null);

  if (transactionsResult.error) {
    console.error("Erro técnico ao buscar lançamentos para recalcular fatura:", transactionsResult.error);
    return { totalAmount: 0, error: transactionsResult.error };
  }

  const totalAmount = (transactionsResult.data ?? []).reduce(
    (sum, transaction: { amount: number }) => sum + Number(transaction.amount || 0),
    0,
  );

  const updateResult = await client
    .from("credit_card_invoices")
    .update({ total_amount: totalAmount })
    .eq("user_id", userId)
    .eq("id", invoiceId)
    .is("archived_at", null);

  if (updateResult.error) {
    console.error("Erro técnico ao atualizar total recalculado da fatura:", updateResult.error);
    return { totalAmount, error: updateResult.error };
  }

  return { totalAmount, error: null, skipped: false };
}

async function findOrCreateInvoiceForCycle(
  client: AppSupabaseClient,
  userId: string,
  card: InvoiceCycleCard,
  cycle: InvoiceCycleDates,
): Promise<FindOrCreateInvoiceResult> {
  const existingResult = await client
    .from("credit_card_invoices")
    .select("id,credit_card_id,reference_month,closing_date,due_date,status,total_amount,paid_amount,archived_at")
    .eq("user_id", userId)
    .eq("credit_card_id", card.id)
    .eq("reference_month", cycle.reference_month)
    .maybeSingle();

  if (existingResult.error) {
    console.error("Erro técnico ao buscar fatura automática:", existingResult.error);
    return { invoice: null, created: false, error: { message: "Não foi possível buscar a fatura do período." } };
  }

  if (existingResult.data) {
    if (existingResult.data.archived_at) {
      return {
        invoice: null,
        created: false,
        error: { message: "Já existe uma fatura arquivada para este cartão e mês. Restaure-a antes de gerar automaticamente." },
      };
    }

    return { invoice: existingResult.data, created: false, error: null };
  }

  const insertResult = await client
    .from("credit_card_invoices")
    .insert({
      user_id: userId,
      credit_card_id: card.id,
      reference_month: cycle.reference_month,
      closing_date: cycle.closing_date,
      due_date: cycle.due_date,
      total_amount: 0,
      paid_amount: 0,
      status: "open",
      notes: "Fatura criada automaticamente pelo Hub VZ.",
    })
    .select("id,credit_card_id,reference_month,closing_date,due_date,status,total_amount,paid_amount")
    .single();

  if (insertResult.error) {
    const retryResult = await client
      .from("credit_card_invoices")
      .select("id,credit_card_id,reference_month,closing_date,due_date,status,total_amount,paid_amount,archived_at")
      .eq("user_id", userId)
      .eq("credit_card_id", card.id)
      .eq("reference_month", cycle.reference_month)
      .maybeSingle();

    if (!retryResult.error && retryResult.data && !retryResult.data.archived_at) {
      return { invoice: retryResult.data, created: false, error: null };
    }

    console.error("Erro técnico ao criar fatura automática:", insertResult.error);
    return { invoice: null, created: false, error: { message: "Não foi possível criar a fatura automaticamente." } };
  }

  return { invoice: insertResult.data, created: true, error: null };
}

function validateCardCycle(card: InvoiceCycleCard) {
  if (!card.closing_day || !card.due_day) {
    throw new Error(`Configure dia de fechamento e vencimento do cartão ${card.name} antes de gerar faturas.`);
  }
}

function parseDateParts(date: string) {
  const parts = date.split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    throw new Error("Data inválida para calcular fatura.");
  }
  return parts as [number, number, number];
}

function buildClampedDate(year: number, month: number, configuredDay: number) {
  const date = new Date(year, month - 1, 1);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(Math.max(configuredDay, 1), lastDay));
  return toDateInputValue(date);
}

function toMonthInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function toDateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
