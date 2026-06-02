import type {
  ReimbursementGeneratedLinkValues,
  ReimbursementFormValues,
  ReimbursementRow,
} from "@/features/reimbursements/types";
import type { AppSupabaseClient } from "@/features/shared/types";

export type GenerateRecurringReimbursementsResult = {
  created: number;
  skipped: number;
  error: { message: string } | null;
};

export async function listReimbursements(client: AppSupabaseClient) {
  return client.from("reimbursements").select("*").order("expected_date", { ascending: true });
}

export async function listReimbursementSupportData(client: AppSupabaseClient) {
  const [people, transactions, accounts, income, categories, cards, invoices] = await Promise.all([
    client.from("people").select("id,name").order("name", { ascending: true }),
    client
      .from("credit_card_transactions")
      .select("id,description,amount,transaction_date")
      .order("transaction_date", { ascending: false }),
    client.from("accounts_payable").select("id,title,amount").order("due_date", { ascending: false }),
    client.from("income_sources").select("id,name,amount").order("expected_date", { ascending: false }),
    client.from("categories").select("id,name,type,color,icon").order("name", { ascending: true }),
    client.from("credit_cards").select("id,name,issuer").eq("is_active", true).order("name", { ascending: true }),
    client
      .from("credit_card_invoices")
      .select("id,credit_card_id,reference_month,due_date,status,total_amount")
      .neq("status", "cancelled")
      .order("due_date", { ascending: false }),
  ]);

  return { people, transactions, accounts, income, categories, cards, invoices };
}

export async function createReimbursement(
  client: AppSupabaseClient,
  userId: string,
  values: ReimbursementFormValues,
) {
  return client.from("reimbursements").insert(toPayload(userId, values)).select("*").single();
}

export async function updateReimbursement(
  client: AppSupabaseClient,
  id: string,
  values: ReimbursementFormValues,
) {
  return client.from("reimbursements").update(toPayload(undefined, values)).eq("id", id).select("*").single();
}

export async function deleteReimbursement(client: AppSupabaseClient, id: string) {
  return client.from("reimbursements").delete().eq("id", id);
}

export async function generateLinkedEntryFromReimbursement(
  client: AppSupabaseClient,
  userId: string,
  reimbursement: ReimbursementRow,
  values: ReimbursementGeneratedLinkValues,
) {
  if (
    reimbursement.account_payable_id ||
    reimbursement.credit_card_transaction_id ||
    reimbursement.credit_card_invoice_id
  ) {
    return { error: { message: "Este reembolso já possui vínculo. Edite o vínculo atual antes de gerar outro lançamento." } };
  }

  if (values.target === "account") {
    const amount = Number(values.amount || 0);

    if (!values.title.trim() || amount < 0 || !values.due_date) {
      return { error: { message: "Informe título, valor e vencimento válidos." } };
    }

    const insertResult = await client
      .from("accounts_payable")
      .insert({
        user_id: userId,
        category_id: reimbursement.category_id,
        person_id: reimbursement.person_id,
        title: values.title.trim(),
        description: values.description.trim() || null,
        amount,
        due_date: values.due_date,
        status: "pending",
        priority: "medium",
        risk_level: "medium",
        payment_method_planned: "unknown",
        can_delay: true,
        delay_risk: "medium",
        source_type: "reimbursement",
        source_id: reimbursement.id,
        reimbursement_id: reimbursement.id,
        notes: "Conta gerada a partir de reembolso.",
      })
      .select("id")
      .single();

    if (insertResult.error) {
      console.error("Erro técnico ao gerar conta vinculada ao reembolso:", insertResult.error);
      return { error: { message: "Não foi possível gerar a conta vinculada." } };
    }

    const updateResult = await client
      .from("reimbursements")
      .update({
        account_payable_id: insertResult.data.id,
        source_type: "account_payable",
        source_id: insertResult.data.id,
      })
      .eq("id", reimbursement.id);

    if (updateResult.error) {
      console.error("Erro técnico ao vincular conta ao reembolso:", updateResult.error);
      return { error: { message: "A conta foi criada, mas não foi possível vincular ao reembolso." } };
    }

    return { error: null };
  }

  const amount = Number(values.amount || 0);

  if (!values.credit_card_id || !values.invoice_id || !values.description.trim() || amount < 0 || !values.transaction_date) {
    return { error: { message: "Informe cartão, fatura, descrição, valor e data válidos." } };
  }

  const insertResult = await client
    .from("credit_card_transactions")
    .insert({
      user_id: userId,
      credit_card_id: values.credit_card_id,
      invoice_id: values.invoice_id,
      category_id: reimbursement.category_id,
      person_id: reimbursement.person_id,
      description: values.description.trim(),
      amount,
      transaction_date: values.transaction_date,
      ownership_type: "third_party",
      is_reimbursable: true,
      reimbursement_status: toTransactionReimbursementStatus(reimbursement.status),
      reimbursement_id: reimbursement.id,
      notes: "Lançamento gerado a partir de reembolso.",
    })
    .select("id")
    .single();

  if (insertResult.error) {
    console.error("Erro técnico ao gerar lançamento de fatura vinculado ao reembolso:", insertResult.error);
    return { error: { message: "Não foi possível gerar o lançamento na fatura." } };
  }

  const invoiceResult = await client
    .from("credit_card_invoices")
    .select("total_amount")
    .eq("id", values.invoice_id)
    .single();

  if (invoiceResult.error) {
    console.error("Erro técnico ao consultar fatura do reembolso:", invoiceResult.error);
    return { error: { message: "O lançamento foi criado, mas o total da fatura não foi atualizado." } };
  }

  const invoiceUpdateResult = await client
    .from("credit_card_invoices")
    .update({ total_amount: Number(invoiceResult.data.total_amount || 0) + amount })
    .eq("id", values.invoice_id);

  if (invoiceUpdateResult.error) {
    console.error("Erro técnico ao atualizar total da fatura do reembolso:", invoiceUpdateResult.error);
    return { error: { message: "O lançamento foi criado, mas o total da fatura não foi atualizado." } };
  }

  const updateResult = await client
    .from("reimbursements")
    .update({
      credit_card_transaction_id: insertResult.data.id,
      credit_card_invoice_id: values.invoice_id,
      source_type: "credit_card_transaction",
      source_id: insertResult.data.id,
    })
    .eq("id", reimbursement.id);

  if (updateResult.error) {
    console.error("Erro técnico ao vincular lançamento de fatura ao reembolso:", updateResult.error);
    return { error: { message: "O lançamento foi criado, mas não foi possível vincular ao reembolso." } };
  }

  return { error: null };
}

export async function generateRecurringReimbursements(
  client: AppSupabaseClient,
  userId: string,
  reimbursement: ReimbursementRow,
  requestedOccurrences: number,
): Promise<GenerateRecurringReimbursementsResult> {
  const occurrences = Math.min(Math.max(Math.floor(requestedOccurrences), 1), 24);

  if (!reimbursement.is_recurring || reimbursement.recurrence_frequency !== "monthly") {
    return { created: 0, skipped: 0, error: { message: "Este reembolso não está configurado como recorrente." } };
  }

  const parentId = reimbursement.recurrence_parent_id ?? reimbursement.id;
  const baseDate = reimbursement.recurrence_start_date ?? reimbursement.expected_date;

  if (!baseDate) {
    return { created: 0, skipped: 0, error: { message: "Informe a data inicial da recorrência." } };
  }

  const candidateDates: string[] = [];
  let cursor = baseDate;

  for (let index = 0; index < occurrences; index += 1) {
    cursor = addMonths(cursor, 1);

    if (reimbursement.recurrence_end_date && cursor > reimbursement.recurrence_end_date) {
      break;
    }

    candidateDates.push(cursor);
  }

  if (candidateDates.length === 0) {
    return { created: 0, skipped: 0, error: { message: "Nenhuma ocorrência futura dentro do período da recorrência." } };
  }

  const existingResult = await client
    .from("reimbursements")
    .select("id,expected_date")
    .eq("user_id", userId)
    .eq("recurrence_parent_id", parentId)
    .in("expected_date", candidateDates);

  if (existingResult.error) {
    console.error("Erro técnico ao verificar reembolsos recorrentes existentes:", existingResult.error);
    return { created: 0, skipped: 0, error: { message: "Não foi possível verificar ocorrências existentes." } };
  }

  const existingDates = new Set((existingResult.data ?? []).map((item) => item.expected_date));
  const rows = candidateDates
    .filter((date) => !existingDates.has(date))
    .map((date) => ({
      user_id: userId,
      person_id: reimbursement.person_id,
      category_id: reimbursement.category_id,
      source_type: reimbursement.source_type,
      source_id: reimbursement.source_id,
      credit_card_transaction_id: reimbursement.credit_card_transaction_id,
      account_payable_id: reimbursement.account_payable_id,
      credit_card_invoice_id: reimbursement.credit_card_invoice_id,
      income_source_id: reimbursement.income_source_id,
      description: reimbursement.description,
      expected_amount: Number(reimbursement.expected_amount),
      received_amount: 0,
      expected_date: date,
      received_at: null,
      received_date: null,
      status: "expected",
      pix_reference: null,
      notes: reimbursement.notes,
      is_recurring: true,
      recurrence_frequency: "monthly",
      recurrence_start_date: reimbursement.recurrence_start_date ?? reimbursement.expected_date,
      recurrence_end_date: reimbursement.recurrence_end_date,
      recurrence_parent_id: parentId,
    }));

  let created = 0;

  if (rows.length > 0) {
    const insertResult = await client.from("reimbursements").insert(rows).select("id");

    if (insertResult.error) {
      console.error("Erro técnico ao gerar reembolsos recorrentes:", insertResult.error);
      return { created: 0, skipped: candidateDates.length - rows.length, error: { message: "Não foi possível gerar os próximos reembolsos." } };
    }

    created = insertResult.data?.length ?? rows.length;
  }

  const updateResult = await client
    .from("reimbursements")
    .update({ recurrence_generated_until: candidateDates[candidateDates.length - 1] })
    .eq("id", parentId);

  if (updateResult.error) {
    console.error("Erro técnico ao atualizar controle da recorrência de reembolso:", updateResult.error);
    return {
      created,
      skipped: candidateDates.length - rows.length,
      error: { message: "Os reembolsos foram gerados, mas o controle da recorrência não foi atualizado." },
    };
  }

  return { created, skipped: candidateDates.length - rows.length, error: null };
}

function toPayload(
  userId: string | undefined,
  values: ReimbursementFormValues,
): Partial<ReimbursementRow> {
  const linkedTransactionId = values.credit_card_transaction_id || null;
  const linkedAccountId = values.account_payable_id || null;

  return {
    ...(userId ? { user_id: userId } : {}),
    person_id: values.person_id,
    category_id: values.category_id || null,
    credit_card_transaction_id: linkedTransactionId,
    account_payable_id: linkedAccountId,
    income_source_id: values.income_source_id || null,
    description: values.description.trim() || null,
    expected_amount: Number(values.expected_amount || 0),
    received_amount: Number(values.received_amount || 0),
    expected_date: values.expected_date || null,
    received_date: values.received_date || null,
    received_at: values.received_date ? `${values.received_date}T00:00:00.000Z` : null,
    status: values.status,
    source_type: linkedTransactionId
      ? "credit_card_transaction"
      : linkedAccountId
        ? "account_payable"
        : "manual",
    source_id: linkedTransactionId ?? linkedAccountId,
    is_recurring: values.is_recurring,
    recurrence_frequency: values.is_recurring ? "monthly" : null,
    recurrence_start_date: values.is_recurring ? values.recurrence_start_date || values.expected_date || null : null,
    recurrence_end_date: values.is_recurring && values.recurrence_end_date ? values.recurrence_end_date : null,
    notes: values.notes.trim() || null,
  };
}

function toTransactionReimbursementStatus(status: string) {
  if (status === "received") return "received";
  if (status === "partial") return "partial";
  return "pending";
}

function addMonths(date: string, months: number) {
  const [year, month, day] = date.split("-").map(Number);
  const nextDate = new Date(year, month - 1 + months, 1);
  const lastDay = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, 0).getDate();
  nextDate.setDate(Math.min(day, lastDay));

  return toDateInputValue(nextDate);
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
