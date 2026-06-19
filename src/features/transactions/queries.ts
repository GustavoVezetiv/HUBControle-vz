import type { AppSupabaseClient } from "@/features/shared/types";
import type { MoveTransactionInvoiceValues, TransactionFormValues, TransactionRow } from "@/features/transactions/types";
import { safeLogAction, safeLogCreate, safeLogFieldDiffs } from "@/features/audit/logger";
import { archiveRecord, restoreArchivedRecord } from "@/features/shared/archive";
import {
  ensureInvoicesForTransactionDates,
  findOrCreateInvoiceForTransactionDate,
  recalculateInvoiceTotal,
} from "@/features/invoices/auto-invoices";
import { createSafeUuid } from "@/lib/uuid";
import type { Reimbursement } from "@/lib/supabase/types";

export type GenerateRecurringTransactionsResult = {
  created: number;
  skipped: number;
  reimbursementCreated: number;
  reimbursementSkipped: number;
  error: { message: string } | null;
};

export type GenerateInstallmentTransactionsResult = {
  created: number;
  skipped: number;
  error: { message: string } | null;
};

export async function listTransactionSupportData(client: AppSupabaseClient) {
  const [cards, invoices, categories, people] = await Promise.all([
    client.from("credit_cards").select("id,name,closing_day,due_day").eq("is_active", true).order("name", { ascending: true }),
    client
      .from("credit_card_invoices")
      .select("id,credit_card_id,reference_month,due_date,status")
      .is("archived_at", null)
      .neq("status", "cancelled")
      .order("due_date", { ascending: false }),
    client
      .from("categories")
      .select("id,name,type,color,icon,scopes")
      .eq("is_active", true)
      .order("name", { ascending: true }),
    client.from("people").select("id,name").order("name", { ascending: true }),
  ]);

  return { cards, invoices, categories, people };
}

export async function listInvoiceTransactions(client: AppSupabaseClient, invoiceId: string) {
  return client
    .from("credit_card_transactions")
    .select("*")
    .eq("invoice_id", invoiceId)
    .is("archived_at", null)
    .order("transaction_date", { ascending: false });
}

export async function createTransaction(
  client: AppSupabaseClient,
  userId: string,
  values: TransactionFormValues,
) {
  const payloadResult = await buildPayloadWithResolvedInvoice(client, userId, values);
  if (payloadResult.error) return { data: null, error: payloadResult.error };

  const insertResult = await client
    .from("credit_card_transactions")
    .insert(payloadResult.payload)
    .select("*")
    .single();

  if (!insertResult.error && insertResult.data?.invoice_id) {
    await recalculateInvoiceTotal(client, userId, insertResult.data.invoice_id);
  }

  if (!insertResult.error && insertResult.data) {
    await safeLogCreate(client, userId, "credit_card_transactions", insertResult.data.id, insertResult.data);
  }

  return insertResult;
}

export async function updateTransaction(
  client: AppSupabaseClient,
  id: string,
  values: TransactionFormValues,
) {
  const currentResult = await client.from("credit_card_transactions").select("*").eq("id", id).single();
  const userId = currentResult.data?.user_id;
  const payloadResult = userId ? await buildPayloadWithResolvedInvoice(client, userId, values) : { payload: toPayload(undefined, values), error: null };
  if (payloadResult.error) return { data: null, error: payloadResult.error };

  const updateResult = await client
    .from("credit_card_transactions")
    .update(payloadResult.payload)
    .eq("id", id)
    .select("*")
    .single();

  if (!updateResult.error && userId) {
    const invoiceIds = new Set<string>();
    if (currentResult.data?.invoice_id) invoiceIds.add(currentResult.data.invoice_id);
    if (updateResult.data?.invoice_id) invoiceIds.add(updateResult.data.invoice_id);
    for (const invoiceId of invoiceIds) {
      await recalculateInvoiceTotal(client, userId, invoiceId);
    }
    if (currentResult.data) {
      await safeLogFieldDiffs(client, userId, "credit_card_transactions", updateResult.data.id, currentResult.data, updateResult.data);
    }
  }

  return updateResult;
}

export async function moveTransactionToInvoice(
  client: AppSupabaseClient,
  userId: string,
  transactionId: string,
  values: MoveTransactionInvoiceValues,
) {
  if (!values.credit_card_id || !values.invoice_id) {
    return { data: null, error: { message: "Selecione o cartão e a fatura destino." } };
  }

  const currentResult = await client
    .from("credit_card_transactions")
    .select("id,user_id,credit_card_id,invoice_id")
    .eq("user_id", userId)
    .eq("id", transactionId)
    .is("archived_at", null)
    .single();

  if (currentResult.error || !currentResult.data) {
    console.error("Erro técnico ao buscar lançamento para mover:", currentResult.error);
    return { data: null, error: { message: "Não foi possível encontrar o lançamento." } };
  }

  const destinationResult = await client
    .from("credit_card_invoices")
    .select("id,credit_card_id,status,archived_at,reference_month,due_date")
    .eq("user_id", userId)
    .eq("id", values.invoice_id)
    .single();

  if (destinationResult.error || !destinationResult.data) {
    console.error("Erro técnico ao buscar fatura destino:", destinationResult.error);
    return { data: null, error: { message: "Não foi possível encontrar a fatura destino." } };
  }

  const destinationInvoice = destinationResult.data;

  if (destinationInvoice.archived_at) {
    return { data: null, error: { message: "Não é possível mover para uma fatura arquivada." } };
  }

  if (isCancelledInvoiceStatus(destinationInvoice.status)) {
    return { data: null, error: { message: "Não é possível mover para uma fatura cancelada." } };
  }

  if (destinationInvoice.credit_card_id !== values.credit_card_id) {
    return { data: null, error: { message: "A fatura selecionada não pertence ao cartão escolhido." } };
  }

  if (currentResult.data.invoice_id === destinationInvoice.id) {
    return { data: null, error: { message: "Selecione uma fatura diferente da atual." } };
  }

  const sourceInvoiceResult = currentResult.data.invoice_id
    ? await client
        .from("credit_card_invoices")
        .select("id,credit_card_id,status,archived_at,reference_month,due_date")
        .eq("user_id", userId)
        .eq("id", currentResult.data.invoice_id)
        .single()
    : null;

  if (sourceInvoiceResult?.error) {
    console.error("Erro técnico ao buscar fatura atual do lançamento:", sourceInvoiceResult.error);
    return { data: null, error: { message: "Não foi possível validar a fatura atual do lançamento." } };
  }

  const sourceInvoice = sourceInvoiceResult?.data ?? null;
  const isCardChange = currentResult.data.credit_card_id !== destinationInvoice.credit_card_id;

  if (isCardChange && !values.confirm_card_change) {
    return { data: null, error: { message: "Confirme explicitamente a troca de cartão antes de mover." } };
  }

  const involvesPaidInvoice =
    isPaidInvoiceStatus(sourceInvoice?.status) || isPaidInvoiceStatus(destinationInvoice.status);

  if (involvesPaidInvoice && !values.confirm_paid_invoice_move) {
    return { data: null, error: { message: "Mover lançamento de fatura paga exige confirmação forte." } };
  }

  const updateResult = await client
    .from("credit_card_transactions")
    .update({
      credit_card_id: destinationInvoice.credit_card_id,
      invoice_id: destinationInvoice.id,
    })
    .eq("user_id", userId)
    .eq("id", transactionId)
    .select("*")
    .single();

  if (updateResult.error) {
    console.error("Erro técnico ao mover lançamento entre faturas:", updateResult.error);
    return { data: null, error: { message: "Não foi possível mover o lançamento." } };
  }

  const reimbursementResult = await client
    .from("reimbursements")
    .update({ credit_card_invoice_id: destinationInvoice.id })
    .eq("user_id", userId)
    .eq("credit_card_transaction_id", transactionId)
    .is("archived_at", null);

  if (reimbursementResult.error) {
    console.error("Erro técnico ao atualizar reembolso vinculado ao mover lançamento:", reimbursementResult.error);
    return {
      data: updateResult.data,
      error: { message: "Lançamento movido, mas não foi possível atualizar o reembolso vinculado." },
    };
  }

  const affectedInvoiceIds = new Set(
    [sourceInvoice?.id ?? currentResult.data.invoice_id, destinationInvoice.id].filter(
      (invoiceId): invoiceId is string => Boolean(invoiceId),
    ),
  );

  for (const invoiceId of affectedInvoiceIds) {
    const recalculateResult = await recalculateInvoiceTotal(client, userId, invoiceId, {
      includePaid: values.confirm_paid_invoice_move,
    });

    if (recalculateResult.error) {
      console.error("Erro técnico ao recalcular fatura após mover lançamento:", recalculateResult.error);
      return {
        data: updateResult.data,
        error: { message: "Lançamento movido, mas não foi possível recalcular uma das faturas." },
      };
    }
  }

  await safeLogAction(client, {
    user_id: userId,
    module: "credit_card_transactions",
    record_id: transactionId,
    action: "move_invoice",
    field_name: "invoice_id",
    old_value: currentResult.data.invoice_id,
    new_value: destinationInvoice.id,
    metadata: {
      from_credit_card_id: currentResult.data.credit_card_id,
      to_credit_card_id: destinationInvoice.credit_card_id,
      source_invoice_id: sourceInvoice?.id ?? null,
      destination_invoice_id: destinationInvoice.id,
    },
  });

  return { data: updateResult.data, error: null };
}

async function buildPayloadWithResolvedInvoice(
  client: AppSupabaseClient,
  userId: string,
  values: TransactionFormValues,
) {
  const payload = toPayload(userId, values);

  if (!payload.invoice_id && values.credit_card_id && values.transaction_date) {
    const invoiceResult = await findOrCreateInvoiceForTransactionDate(client, userId, values.credit_card_id, values.transaction_date);
    if (invoiceResult.error || !invoiceResult.invoice) {
      return { payload, error: invoiceResult.error ?? { message: "Não foi possível definir a fatura automaticamente." } };
    }
    payload.invoice_id = invoiceResult.invoice.id;
  }

  return { payload, error: null };
}

export async function archiveTransaction(client: AppSupabaseClient, id: string, userId: string, reason?: string) {
  return archiveRecord(client, "credit_card_transactions", id, userId, reason);
}

export async function restoreTransaction(client: AppSupabaseClient, id: string, userId: string) {
  return restoreArchivedRecord(client, "credit_card_transactions", id, userId);
}

export async function generateRecurringTransactions(
  client: AppSupabaseClient,
  userId: string,
  transaction: TransactionRow,
  requestedOccurrences: number,
): Promise<GenerateRecurringTransactionsResult> {
  const occurrences = Math.min(Math.max(Math.floor(requestedOccurrences), 1), 24);

  if (!transaction.is_recurring || transaction.recurrence_frequency !== "monthly") {
    return emptyGenerationResult("Este lançamento não está configurado como recorrente.");
  }

  const parentId = transaction.recurrence_parent_id ?? transaction.id;
  const baseDate = transaction.recurrence_start_date ?? transaction.transaction_date;

  if (!baseDate) {
    return emptyGenerationResult("Informe a data inicial da recorrência do lançamento.");
  }

  const candidateDates = buildMonthlyCandidateDates(baseDate, transaction.recurrence_end_date, occurrences);

  if (candidateDates.length === 0) {
    return emptyGenerationResult("Nenhuma ocorrência futura dentro do período da recorrência.");
  }

  const ensuredInvoices = await ensureInvoicesForTransactionDates(client, userId, transaction.credit_card_id, candidateDates);

  if (ensuredInvoices.error) {
    return emptyGenerationResult(ensuredInvoices.error.message);
  }

  const invoicesByDate = ensuredInvoices.invoicesByDate;

  const existingResult = await client
    .from("credit_card_transactions")
    .select("*")
    .eq("user_id", userId)
    .eq("recurrence_parent_id", parentId)
    .in("transaction_date", candidateDates);

  if (existingResult.error) {
    console.error("Erro técnico ao verificar lançamentos recorrentes existentes:", existingResult.error);
    return emptyGenerationResult("Não foi possível verificar lançamentos já gerados.");
  }

  const existingByDate = new Map((existingResult.data ?? []).map((item) => [item.transaction_date, item as TransactionRow]));
  const rows = candidateDates
    .filter((date) => !existingByDate.has(date))
    .map((date) => ({
      user_id: userId,
      credit_card_id: transaction.credit_card_id,
      invoice_id: invoicesByDate.get(date)?.id ?? null,
      category_id: transaction.category_id,
      person_id: transaction.person_id,
      description: transaction.description,
      merchant: transaction.merchant,
      amount: Number(transaction.amount),
      transaction_date: date,
      posting_date: null,
      ownership_type: transaction.ownership_type,
      is_reimbursable: transaction.is_reimbursable,
      reimbursement_status: transaction.reimbursement_status,
      installment_group_id: transaction.installment_group_id,
      installment_number: transaction.installment_number,
      installment_total: transaction.installment_total,
      is_recurring: true,
      recurrence_frequency: "monthly",
      recurrence_start_date: transaction.recurrence_start_date ?? transaction.transaction_date,
      recurrence_end_date: transaction.recurrence_end_date,
      recurrence_parent_id: parentId,
      notes: transaction.notes,
    }));

  let createdTransactions: TransactionRow[] = [];

  if (rows.length > 0) {
    const insertResult = await client.from("credit_card_transactions").insert(rows).select("*");

    if (insertResult.error) {
      console.error("Erro técnico ao gerar lançamentos recorrentes:", insertResult.error);
      return emptyGenerationResult("Não foi possível gerar os próximos lançamentos.");
    }

    createdTransactions = (insertResult.data ?? []) as TransactionRow[];

    const affectedInvoiceIds = new Set(createdTransactions.map((item) => item.invoice_id).filter((invoiceId): invoiceId is string => Boolean(invoiceId)));
    for (const invoiceId of affectedInvoiceIds) {
      await recalculateInvoiceTotal(client, userId, invoiceId);
    }
  }

  const allOccurrencesByDate = new Map<string, TransactionRow>(existingByDate);
  createdTransactions.forEach((item) => allOccurrencesByDate.set(item.transaction_date, item));
  const allCandidateTransactions = candidateDates
    .map((date) => allOccurrencesByDate.get(date))
    .filter((item): item is TransactionRow => Boolean(item));

  const reimbursementResult = await generateLinkedRecurringReimbursements(
    client,
    userId,
    parentId,
    allCandidateTransactions,
  );

  if (reimbursementResult.error) {
    return {
      created: createdTransactions.length,
      skipped: candidateDates.length - rows.length,
      reimbursementCreated: reimbursementResult.created,
      reimbursementSkipped: reimbursementResult.skipped,
      error: reimbursementResult.error,
    };
  }

  const updateResult = await client
    .from("credit_card_transactions")
    .update({ recurrence_generated_until: candidateDates[candidateDates.length - 1] })
    .eq("id", parentId);

  if (updateResult.error) {
    console.error("Erro técnico ao atualizar controle da recorrência de lançamento:", updateResult.error);
    return {
      created: createdTransactions.length,
      skipped: candidateDates.length - rows.length,
      reimbursementCreated: reimbursementResult.created,
      reimbursementSkipped: reimbursementResult.skipped,
      error: { message: "Os lançamentos foram gerados, mas o controle da recorrência não foi atualizado." },
    };
  }

  return {
    created: createdTransactions.length,
    skipped: candidateDates.length - rows.length,
    reimbursementCreated: reimbursementResult.created,
    reimbursementSkipped: reimbursementResult.skipped,
    error: null,
  };
}

export async function generateInstallmentTransactions(
  client: AppSupabaseClient,
  userId: string,
  transaction: TransactionRow,
): Promise<GenerateInstallmentTransactionsResult> {
  const currentInstallment = transaction.installment_number ?? 1;
  const totalInstallments = transaction.installment_total ?? 1;

  if (!transaction.installment_number || !transaction.installment_total || totalInstallments <= currentInstallment) {
    return { created: 0, skipped: 0, error: null };
  }

  const installmentGroupId = transaction.installment_group_id ?? createSafeUuid();
  const futureNumbers = Array.from(
    { length: totalInstallments - currentInstallment },
    (_, index) => currentInstallment + index + 1,
  );
  const futureDates = futureNumbers.map((number) => addMonths(transaction.transaction_date, number - currentInstallment));
  const ensuredInvoices = await ensureInvoicesForTransactionDates(client, userId, transaction.credit_card_id, futureDates);

  if (ensuredInvoices.error) {
    return { created: 0, skipped: 0, error: ensuredInvoices.error };
  }

  if (!transaction.installment_group_id) {
    const updateParent = await client
      .from("credit_card_transactions")
      .update({ installment_group_id: installmentGroupId })
      .eq("id", transaction.id);

    if (updateParent.error) {
      console.error("Erro técnico ao atualizar grupo do parcelamento:", updateParent.error);
      return { created: 0, skipped: 0, error: { message: "Não foi possível preparar o vínculo das parcelas." } };
    }
  }

  const existingResult = await client
    .from("credit_card_transactions")
    .select("id,installment_group_id,installment_number")
    .eq("user_id", userId)
    .eq("installment_group_id", installmentGroupId)
    .in("installment_number", futureNumbers);

  if (existingResult.error) {
    console.error("Erro técnico ao verificar parcelas existentes:", existingResult.error);
    return { created: 0, skipped: 0, error: { message: "Não foi possível verificar parcelas já geradas." } };
  }

  const existingNumbers = new Set((existingResult.data ?? []).map((item) => item.installment_number));
  const rows = futureNumbers
    .filter((number) => !existingNumbers.has(number))
    .map((number) => {
      const transactionDate = addMonths(transaction.transaction_date, number - currentInstallment);

      return {
        user_id: userId,
        credit_card_id: transaction.credit_card_id,
        invoice_id: ensuredInvoices.invoicesByDate.get(transactionDate)?.id ?? null,
        category_id: transaction.category_id,
        person_id: transaction.person_id,
        description: transaction.description,
        merchant: transaction.merchant,
        amount: Number(transaction.amount),
        transaction_date: transactionDate,
        posting_date: null,
        ownership_type: transaction.ownership_type,
        is_reimbursable: transaction.is_reimbursable,
        reimbursement_status: transaction.reimbursement_status,
        installment_group_id: installmentGroupId,
        installment_number: number,
        installment_total: totalInstallments,
        is_recurring: false,
        recurrence_frequency: null,
        recurrence_start_date: null,
        recurrence_end_date: null,
        recurrence_parent_id: null,
        notes: transaction.notes,
      };
    });

  if (rows.length === 0) {
    return { created: 0, skipped: futureNumbers.length, error: null };
  }

  const insertResult = await client.from("credit_card_transactions").insert(rows).select("id");

  if (insertResult.error) {
    console.error("Erro técnico ao gerar parcelas no cartão:", insertResult.error);
    return { created: 0, skipped: futureNumbers.length - rows.length, error: { message: "Não foi possível gerar as parcelas futuras." } };
  }

  const affectedInvoiceIds = new Set(rows.map((item) => item.invoice_id).filter((invoiceId): invoiceId is string => Boolean(invoiceId)));
  for (const invoiceId of affectedInvoiceIds) {
    await recalculateInvoiceTotal(client, userId, invoiceId);
  }

  return {
    created: insertResult.data?.length ?? rows.length,
    skipped: futureNumbers.length - rows.length,
    error: null,
  };
}

export async function createExpectedReimbursementForTransaction(
  client: AppSupabaseClient,
  userId: string,
  transaction: TransactionRow,
  expectedDate: string,
) {
  return client.from("reimbursements").insert({
    user_id: userId,
    person_id: transaction.person_id as string,
    category_id: transaction.category_id,
    credit_card_transaction_id: transaction.id,
    credit_card_invoice_id: transaction.invoice_id,
    description: transaction.description,
    expected_amount: Number(transaction.amount),
    received_amount: 0,
    expected_date: expectedDate || transaction.transaction_date,
    status: "expected",
    source_type: "credit_card_transaction",
    source_id: transaction.id,
    is_recurring: transaction.is_recurring,
    recurrence_frequency: transaction.is_recurring ? "monthly" : null,
    recurrence_start_date: transaction.is_recurring ? expectedDate || transaction.transaction_date : null,
    recurrence_end_date: transaction.is_recurring ? transaction.recurrence_end_date : null,
  });
}

function toPayload(
  userId: string | undefined,
  values: TransactionFormValues,
): Partial<TransactionRow> {
  const isCreate = Boolean(userId);
  return {
    ...(userId ? { user_id: userId } : {}),
    credit_card_id: values.credit_card_id,
    invoice_id: values.invoice_id || null,
    transaction_date: values.transaction_date,
    description: values.description.trim(),
    amount: Number(values.amount || 0),
    category_id: values.category_id || null,
    person_id: values.person_id || null,
    ownership_type: values.ownership_type,
    installment_number: values.is_installment_purchase && values.installment_number ? Number(values.installment_number) : null,
    installment_total: values.is_installment_purchase && values.installment_total ? Number(values.installment_total) : null,
    ...(isCreate && values.is_installment_purchase ? { installment_group_id: createSafeUuid() } : {}),
    is_reimbursable: values.is_reimbursable,
    reimbursement_status: values.is_reimbursable ? "expected" : "not_applicable",
    is_recurring: values.is_recurring,
    recurrence_frequency: values.is_recurring ? "monthly" : null,
    recurrence_start_date: values.is_recurring ? values.recurrence_start_date || values.transaction_date : null,
    recurrence_end_date: values.is_recurring && values.recurrence_end_date ? values.recurrence_end_date : null,
    notes: values.notes.trim() || null,
  };
}

async function generateLinkedRecurringReimbursements(
  client: AppSupabaseClient,
  userId: string,
  parentTransactionId: string,
  transactions: TransactionRow[],
) {
  const linkedResult = await client
    .from("reimbursements")
    .select("*")
    .eq("user_id", userId)
    .eq("credit_card_transaction_id", parentTransactionId)
    .eq("is_recurring", true);

  if (linkedResult.error) {
    console.error("Erro técnico ao buscar reembolsos recorrentes vinculados:", linkedResult.error);
    return { created: 0, skipped: 0, error: { message: "Não foi possível buscar reembolsos recorrentes vinculados." } };
  }

  const parentReimbursements = (linkedResult.data ?? []) as Reimbursement[];

  if (parentReimbursements.length === 0 || transactions.length === 0) {
    return { created: 0, skipped: 0, error: null };
  }

  const candidateRows = parentReimbursements.flatMap((reimbursement) => {
    const reimbursementParentId = reimbursement.recurrence_parent_id ?? reimbursement.id;
    const baseExpectedDate = reimbursement.recurrence_start_date ?? reimbursement.expected_date;

    if (!baseExpectedDate) return [];

    return transactions
      .map((transaction) => {
        const expectedDate = moveDateToMonth(baseExpectedDate, transaction.transaction_date);

        if (reimbursement.recurrence_end_date && expectedDate > reimbursement.recurrence_end_date) {
          return null;
        }

        return {
          user_id: userId,
          person_id: reimbursement.person_id,
          category_id: reimbursement.category_id,
          source_type: "credit_card_transaction",
          source_id: transaction.id,
          credit_card_transaction_id: transaction.id,
          account_payable_id: null,
          credit_card_invoice_id: transaction.invoice_id,
          income_source_id: null,
          description: reimbursement.description,
          expected_amount: Number(reimbursement.expected_amount),
          received_amount: 0,
          expected_date: expectedDate,
          received_at: null,
          received_date: null,
          status: "expected",
          pix_reference: null,
          notes: reimbursement.notes,
          is_recurring: true,
          recurrence_frequency: "monthly",
          recurrence_start_date: reimbursement.recurrence_start_date ?? reimbursement.expected_date,
          recurrence_end_date: reimbursement.recurrence_end_date,
          recurrence_parent_id: reimbursementParentId,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
  });

  if (candidateRows.length === 0) {
    return { created: 0, skipped: 0, error: null };
  }

  const parentIds = [...new Set(candidateRows.map((row) => row.recurrence_parent_id).filter(Boolean))];
  const expectedDates = [...new Set(candidateRows.map((row) => row.expected_date).filter(Boolean))];
  const existingResult = await client
    .from("reimbursements")
    .select("id,recurrence_parent_id,expected_date")
    .eq("user_id", userId)
    .in("recurrence_parent_id", parentIds)
    .in("expected_date", expectedDates);

  if (existingResult.error) {
    console.error("Erro técnico ao verificar reembolsos vinculados existentes:", existingResult.error);
    return { created: 0, skipped: 0, error: { message: "Não foi possível verificar reembolsos vinculados já gerados." } };
  }

  const existingKeys = new Set(
    (existingResult.data ?? []).map((item) => `${item.recurrence_parent_id}:${item.expected_date}`),
  );
  const rows = candidateRows.filter((row) => !existingKeys.has(`${row.recurrence_parent_id}:${row.expected_date}`));

  if (rows.length === 0) {
    return { created: 0, skipped: candidateRows.length, error: null };
  }

  const insertResult = await client.from("reimbursements").insert(rows).select("id");

  if (insertResult.error) {
    console.error("Erro técnico ao gerar reembolsos vinculados:", insertResult.error);
    return { created: 0, skipped: candidateRows.length - rows.length, error: { message: "Os lançamentos foram gerados, mas os reembolsos vinculados não foram criados." } };
  }

  return {
    created: insertResult.data?.length ?? rows.length,
    skipped: candidateRows.length - rows.length,
    error: null,
  };
}

function emptyGenerationResult(message: string): GenerateRecurringTransactionsResult {
  return { created: 0, skipped: 0, reimbursementCreated: 0, reimbursementSkipped: 0, error: { message } };
}

function isPaidInvoiceStatus(status: string | null | undefined) {
  return status === "paid";
}

function isCancelledInvoiceStatus(status: string | null | undefined) {
  return status === "cancelled" || status === "canceled";
}

function buildMonthlyCandidateDates(baseDate: string, endDate: string | null, occurrences: number) {
  const dates: string[] = [];

  for (let index = 1; index <= occurrences; index += 1) {
    const date = addMonths(baseDate, index);

    if (endDate && date > endDate) break;

    dates.push(date);
  }

  return dates;
}

function addMonths(date: string, months: number) {
  const [year, month, day] = date.split("-").map(Number);
  const nextDate = new Date(year, month - 1 + months, 1);
  const lastDay = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, 0).getDate();
  nextDate.setDate(Math.min(day, lastDay));

  return toDateInputValue(nextDate);
}

function moveDateToMonth(baseDate: string, targetDate: string) {
  const [, , baseDay] = baseDate.split("-").map(Number);
  const [targetYear, targetMonth] = targetDate.split("-").map(Number);
  const nextDate = new Date(targetYear, targetMonth - 1, 1);
  const lastDay = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, 0).getDate();
  nextDate.setDate(Math.min(baseDay, lastDay));

  return toDateInputValue(nextDate);
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
