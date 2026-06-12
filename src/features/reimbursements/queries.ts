import type {
  ReimbursementGeneratedLinkValues,
  ReimbursementFormValues,
  ReimbursementRenegotiationValues,
  ReimbursementRow,
} from "@/features/reimbursements/types";
import type { AppSupabaseClient } from "@/features/shared/types";
import { archiveRecord, restoreArchivedRecord } from "@/features/shared/archive";
import type { CreditCardTransaction } from "@/lib/supabase/types";

export type GenerateRecurringReimbursementsResult = {
  created: number;
  skipped: number;
  error: { message: string } | null;
};

type FinancialLinkSyncResult = {
  error: { message: string } | null;
  invoiceId: string | null;
  transactionId: string | null;
};

export async function listReimbursements(client: AppSupabaseClient) {
  return client.from("reimbursements").select("*").is("archived_at", null).order("expected_date", { ascending: true });
}

export async function listReimbursementSupportData(client: AppSupabaseClient) {
  const [people, transactions, accounts, income, categories, cards, invoices] = await Promise.all([
    client.from("people").select("id,name").order("name", { ascending: true }),
    client
      .from("credit_card_transactions")
      .select("id,credit_card_id,invoice_id,category_id,description,amount,transaction_date,reimbursement_id,is_reimbursable")
      .is("archived_at", null)
      .order("transaction_date", { ascending: false }),
    client.from("accounts_payable").select("id,title,amount").order("due_date", { ascending: false }),
    client.from("income_sources").select("id,name,amount").order("expected_date", { ascending: false }),
    client.from("categories").select("id,name,type,color,icon").order("name", { ascending: true }),
    client.from("credit_cards").select("id,name,issuer").eq("is_active", true).order("name", { ascending: true }),
    client
      .from("credit_card_invoices")
      .select("id,credit_card_id,reference_month,due_date,status,total_amount")
      .is("archived_at", null)
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
  const current = await client.from("reimbursements").select("*").eq("id", id).single();

  if (current.error || !current.data) {
    console.error("Erro técnico ao carregar reembolso atual para atualização:", current.error);
    return { data: null, error: { message: "Não foi possível carregar o reembolso atual." } };
  }

  return client
    .from("reimbursements")
    .update(toPayload(undefined, values, current.data))
    .eq("id", id)
    .select("*")
    .single();
}

export async function archiveReimbursement(client: AppSupabaseClient, id: string, userId: string, reason?: string) {
  return archiveRecord(client, "reimbursements", id, userId, reason);
}

export async function restoreReimbursement(client: AppSupabaseClient, id: string, userId: string) {
  return restoreArchivedRecord(client, "reimbursements", id, userId);
}

export async function renegotiateReimbursements(
  client: AppSupabaseClient,
  userId: string,
  reimbursements: ReimbursementRow[],
  values: ReimbursementRenegotiationValues,
) {
  if (reimbursements.length === 0) {
    return { error: { message: "Selecione ao menos um reembolso para renegociar." } };
  }

  const personIds = new Set(reimbursements.map((item) => item.person_id));
  if (personIds.size > 1) {
    return { error: { message: "A renegociação só pode ser feita com reembolsos da mesma pessoa." } };
  }

  const ineligible = reimbursements.find((item) => !isEligibleForRenegotiation(item));
  if (ineligible) {
    return { error: { message: "Selecione apenas reembolsos em aberto, parciais ou atrasados." } };
  }

  const alreadyRenegotiated = reimbursements.find(
    (item) => item.status === "renegotiated" || item.renegotiated_into_id,
  );
  if (alreadyRenegotiated) {
    return { error: { message: "Um ou mais reembolsos selecionados já foram renegociados. Revise o histórico antes de tentar novamente." } };
  }

  const expectedDate = values.expected_date?.trim();
  const description = values.description?.trim();
  if (!expectedDate || !description) {
    return { error: { message: "Informe a nova data prevista e a descrição da renegociação." } };
  }

  const openTotal = reimbursements.reduce((sum, item) => sum + getOpenAmount(item), 0);
  if (openTotal <= 0) {
    return { error: { message: "Os reembolsos selecionados não possuem saldo em aberto para renegociar." } };
  }

  const sourceIds = reimbursements.map((item) => item.id);
  const notes = buildRenegotiationNotes(reimbursements, values.notes);
  const primaryCategoryId = reimbursements.every((item) => item.category_id === reimbursements[0].category_id)
    ? reimbursements[0].category_id
    : null;

  const insertResult = await client
    .from("reimbursements")
    .insert({
      user_id: userId,
      person_id: reimbursements[0].person_id,
      category_id: primaryCategoryId,
      source_type: "reimbursement_renegotiation",
      source_id: null,
      credit_card_transaction_id: null,
      account_payable_id: null,
      income_source_id: null,
      credit_card_invoice_id: null,
      description,
      expected_amount: openTotal,
      received_amount: 0,
      status: "expected",
      expected_date: expectedDate,
      received_at: null,
      received_date: null,
      is_recurring: false,
      recurrence_frequency: null,
      recurrence_start_date: null,
      recurrence_end_date: null,
      recurrence_parent_id: null,
      recurrence_generated_until: null,
      renegotiation_source_ids: sourceIds,
      pix_reference: null,
      notes,
    })
    .select("*")
    .single();

  if (insertResult.error) {
    console.error("Erro técnico ao criar reembolso renegociado:", insertResult.error);
    return { error: { message: "Não foi possível criar o novo título consolidado." } };
  }

  const renegotiatedAt = new Date().toISOString();
  const updateResult = await client
    .from("reimbursements")
    .update({
      status: "renegotiated",
      renegotiated_into_id: insertResult.data.id,
      renegotiated_at: renegotiatedAt,
    })
    .eq("user_id", userId)
    .in("id", sourceIds);

  if (updateResult.error) {
    console.error("Erro técnico ao marcar reembolsos antigos como renegociados:", updateResult.error);
    await client.from("reimbursements").delete().eq("user_id", userId).eq("id", insertResult.data.id);
    return { error: { message: "O novo título foi criado, mas os títulos antigos não puderam ser marcados como renegociados. A criação foi desfeita." } };
  }

  return { error: null, created: insertResult.data, count: sourceIds.length };
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

  const invoiceValidation = await client
    .from("credit_card_invoices")
    .select("id,credit_card_id")
    .is("archived_at", null)
    .eq("user_id", userId)
    .eq("id", values.invoice_id)
    .single();

  if (invoiceValidation.error || !invoiceValidation.data) {
    console.error("Erro técnico ao validar fatura do reembolso:", invoiceValidation.error);
    return { error: { message: "Fatura selecionada não foi encontrada." } };
  }

  if (invoiceValidation.data.credit_card_id !== values.credit_card_id) {
    return { error: { message: "A fatura selecionada não pertence ao cartão informado." } };
  }

  const existingLinkedTransaction = await client
    .from("credit_card_transactions")
    .select("id,invoice_id")
    .eq("user_id", userId)
    .eq("reimbursement_id", reimbursement.id)
    .maybeSingle();

  if (existingLinkedTransaction.error) {
    console.error("Erro técnico ao verificar lançamento já vinculado ao reembolso:", existingLinkedTransaction.error);
    return { error: { message: "Não foi possível verificar se este reembolso já possui lançamento vinculado." } };
  }

  if (existingLinkedTransaction.data) {
    return {
      error: {
        message: "Este reembolso já possui lançamento de fatura vinculado. Abra o lançamento existente antes de gerar outro.",
      },
    };
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
    .select("*")
    .single();

  if (insertResult.error) {
    console.error("Erro técnico ao gerar lançamento de fatura vinculado ao reembolso:", insertResult.error);
    return { error: { message: "Não foi possível gerar o lançamento na fatura." } };
  }

  const transactionId = insertResult.data.id;
  const recalculateResult = await recalculateInvoiceTotal(client, userId, values.invoice_id);

  if (recalculateResult.error) {
    await rollbackGeneratedTransaction(client, userId, transactionId);
    return { error: { message: "O lançamento foi criado, mas o total da fatura não foi recalculado. A criação foi desfeita." } };
  }

  const visibilityResult = await client
    .from("credit_card_transactions")
    .select("id")
    .eq("user_id", userId)
    .eq("id", transactionId)
    .eq("invoice_id", values.invoice_id)
    .maybeSingle();

  if (visibilityResult.error || !visibilityResult.data) {
    console.error("Erro técnico ao confirmar visibilidade do lançamento na fatura:", visibilityResult.error);
    await rollbackGeneratedTransaction(client, userId, transactionId);
    await recalculateInvoiceTotal(client, userId, values.invoice_id);
    return { error: { message: "O lançamento foi criado, mas não apareceu na consulta da fatura. A criação foi desfeita." } };
  }

  const updateResult = await client
    .from("reimbursements")
    .update({
      credit_card_transaction_id: transactionId,
      credit_card_invoice_id: values.invoice_id,
      source_type: "credit_card_transaction",
      source_id: transactionId,
    })
    .eq("user_id", userId)
    .eq("id", reimbursement.id);

  if (updateResult.error) {
    console.error("Erro técnico ao vincular lançamento de fatura ao reembolso:", updateResult.error);
    await rollbackGeneratedTransaction(client, userId, transactionId);
    await recalculateInvoiceTotal(client, userId, values.invoice_id);
    return { error: { message: "O lançamento foi criado, mas não foi possível vincular ao reembolso. A criação foi desfeita." } };
  }

  return {
    error: null,
    transactionId,
    invoiceId: values.invoice_id,
    invoiceTotal: recalculateResult.totalAmount,
  };
}

export async function recalculateInvoiceTotal(client: AppSupabaseClient, userId: string, invoiceId: string) {
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
    (sum, transaction: Pick<CreditCardTransaction, "amount">) => sum + Number(transaction.amount || 0),
    0,
  );

  const updateResult = await client
    .from("credit_card_invoices")
    .update({ total_amount: totalAmount })
    .is("archived_at", null)
    .eq("user_id", userId)
    .eq("id", invoiceId);

  if (updateResult.error) {
    console.error("Erro técnico ao atualizar total recalculado da fatura:", updateResult.error);
    return { totalAmount, error: updateResult.error };
  }

  return { totalAmount, error: null };
}

export async function syncReimbursementFinancialLink(
  client: AppSupabaseClient,
  userId: string,
  reimbursement: ReimbursementRow,
  values: ReimbursementFormValues,
): Promise<FinancialLinkSyncResult> {
  const mode = values.financial_link_mode;

  if (mode === "none" || mode === "keep_current") {
    return { error: null, invoiceId: reimbursement.credit_card_invoice_id ?? null, transactionId: reimbursement.credit_card_transaction_id ?? null };
  }

  const currentTransaction = reimbursement.credit_card_transaction_id
    ? await getTransactionById(client, userId, reimbursement.credit_card_transaction_id)
    : { data: null, error: null };

  if (currentTransaction.error) {
    console.error("Erro técnico ao carregar lançamento atual do reembolso:", currentTransaction.error);
    return { error: { message: "Não foi possível carregar o lançamento atual do reembolso." }, invoiceId: null, transactionId: null };
  }

  if (mode === "remove_current") {
    return removeFinancialLink(client, userId, reimbursement, currentTransaction.data, values.financial_link_remove_mode);
  }

  if (mode === "create_invoice_transaction") {
    return createFinancialTransaction(client, userId, reimbursement, currentTransaction.data, values);
  }

  if (mode === "link_existing") {
    return linkExistingTransaction(client, userId, reimbursement, currentTransaction.data, values);
  }

    return { error: null, invoiceId: null, transactionId: null };
  }

async function rollbackGeneratedTransaction(client: AppSupabaseClient, userId: string, transactionId: string) {
  const rollback = await client.from("credit_card_transactions").delete().eq("user_id", userId).eq("id", transactionId);
  if (rollback.error) {
    console.error("Erro técnico ao desfazer lançamento gerado por reembolso:", rollback.error);
  }
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

async function linkExistingTransaction(
  client: AppSupabaseClient,
  userId: string,
  reimbursement: ReimbursementRow,
  currentTransaction: CreditCardTransaction | null,
  values: ReimbursementFormValues,
): Promise<FinancialLinkSyncResult> {
  if (!values.financial_link_card_id || !values.financial_link_invoice_id || !values.financial_link_transaction_id) {
    return { error: { message: "Selecione cartão, fatura e lançamento para concluir o vínculo." }, invoiceId: null, transactionId: null };
  }

  const invoiceResult = await getInvoiceById(client, userId, values.financial_link_invoice_id);
  if (invoiceResult.error || !invoiceResult.data) {
    console.error("Erro técnico ao validar fatura para vínculo do reembolso:", invoiceResult.error);
    return { error: { message: "A fatura selecionada não foi encontrada ou está arquivada." }, invoiceId: null, transactionId: null };
  }

  if (invoiceResult.data.credit_card_id !== values.financial_link_card_id) {
    return { error: { message: "A fatura selecionada não pertence ao cartão informado." }, invoiceId: null, transactionId: null };
  }

  const transactionResult = await getTransactionById(client, userId, values.financial_link_transaction_id);
  if (transactionResult.error || !transactionResult.data) {
    console.error("Erro técnico ao validar lançamento para vínculo do reembolso:", transactionResult.error);
    return { error: { message: "O lançamento selecionado não foi encontrado ou está arquivado." }, invoiceId: null, transactionId: null };
  }

  const selectedTransaction = transactionResult.data;
  if (selectedTransaction.credit_card_id !== values.financial_link_card_id) {
    return { error: { message: "O lançamento selecionado não pertence ao cartão informado." }, invoiceId: null, transactionId: null };
  }

  if (selectedTransaction.reimbursement_id && selectedTransaction.reimbursement_id !== reimbursement.id) {
    if (!values.financial_link_allow_reuse) {
      return { error: { message: "Este lançamento já está vinculado a outro reembolso. Confirme a substituição para continuar." }, invoiceId: null, transactionId: null };
    }

    const previousReimbursementResult = await client
      .from("reimbursements")
      .select("*")
      .eq("user_id", userId)
      .eq("id", selectedTransaction.reimbursement_id)
      .single();

    if (previousReimbursementResult.error || !previousReimbursementResult.data) {
      console.error("Erro técnico ao carregar reembolso anterior do lançamento:", previousReimbursementResult.error);
      return { error: { message: "Não foi possível preparar a substituição do vínculo anterior." }, invoiceId: null, transactionId: null };
    }

    const previousClear = await clearReimbursementCardLink(client, userId, previousReimbursementResult.data);
    if (previousClear.error) return previousClear;
  }

  if (currentTransaction && currentTransaction.id !== selectedTransaction.id) {
    const detachCurrent = await detachTransactionFromReimbursement(client, userId, currentTransaction.id);
    if (detachCurrent.error) return detachCurrent;
  }

  const previousInvoiceId = selectedTransaction.invoice_id;
  const updateTransaction = await client
    .from("credit_card_transactions")
    .update({
      credit_card_id: values.financial_link_card_id,
      invoice_id: values.financial_link_invoice_id,
      reimbursement_id: reimbursement.id,
      is_reimbursable: true,
      reimbursement_status: toTransactionReimbursementStatus(reimbursement.status),
    })
    .eq("user_id", userId)
    .eq("id", selectedTransaction.id);

  if (updateTransaction.error) {
    console.error("Erro técnico ao atualizar lançamento vinculado ao reembolso:", updateTransaction.error);
    return { error: { message: "Não foi possível vincular o lançamento selecionado ao reembolso." }, invoiceId: null, transactionId: null };
  }

  const updateReimbursement = await client
    .from("reimbursements")
    .update({
      credit_card_transaction_id: selectedTransaction.id,
      credit_card_invoice_id: values.financial_link_invoice_id,
      source_type: "credit_card_transaction",
      source_id: selectedTransaction.id,
      account_payable_id: null,
      income_source_id: null,
    })
    .eq("user_id", userId)
    .eq("id", reimbursement.id);

  if (updateReimbursement.error) {
    console.error("Erro técnico ao salvar vínculo do reembolso com lançamento existente:", updateReimbursement.error);
    return { error: { message: "O lançamento foi preparado, mas o reembolso não pôde ser atualizado." }, invoiceId: null, transactionId: null };
  }

  const invoiceIdsToRecalculate = new Set<string>();
  if (previousInvoiceId) invoiceIdsToRecalculate.add(previousInvoiceId);
  if (values.financial_link_invoice_id) invoiceIdsToRecalculate.add(values.financial_link_invoice_id);

  for (const invoiceId of invoiceIdsToRecalculate) {
    const recalculate = await recalculateInvoiceTotal(client, userId, invoiceId);
    if (recalculate.error) {
      return { error: { message: "O vínculo foi salvo, mas não foi possível recalcular o total da fatura." }, invoiceId: null, transactionId: null };
    }
  }

  return { error: null, invoiceId: values.financial_link_invoice_id, transactionId: selectedTransaction.id };
}

async function createFinancialTransaction(
  client: AppSupabaseClient,
  userId: string,
  reimbursement: ReimbursementRow,
  currentTransaction: CreditCardTransaction | null,
  values: ReimbursementFormValues,
): Promise<FinancialLinkSyncResult> {
  if (currentTransaction) {
    return { error: { message: "Este reembolso já possui lançamento vinculado. Remova ou ajuste o vínculo atual antes de criar outro." }, invoiceId: null, transactionId: null };
  }

  if (
    !values.financial_link_card_id ||
    !values.financial_link_invoice_id ||
    !values.financial_link_new_description.trim() ||
    Number(values.financial_link_new_amount || 0) < 0 ||
    !values.financial_link_new_date
  ) {
    return { error: { message: "Informe cartão, fatura, descrição, valor e data válidos para criar o lançamento." }, invoiceId: null, transactionId: null };
  }

  const invoiceResult = await getInvoiceById(client, userId, values.financial_link_invoice_id);
  if (invoiceResult.error || !invoiceResult.data) {
    console.error("Erro técnico ao validar fatura para novo lançamento do reembolso:", invoiceResult.error);
    return { error: { message: "A fatura selecionada não foi encontrada ou está arquivada." }, invoiceId: null, transactionId: null };
  }

  if (invoiceResult.data.credit_card_id !== values.financial_link_card_id) {
    return { error: { message: "A fatura selecionada não pertence ao cartão informado." }, invoiceId: null, transactionId: null };
  }

  const insertResult = await client
    .from("credit_card_transactions")
    .insert({
      user_id: userId,
      credit_card_id: values.financial_link_card_id,
      invoice_id: values.financial_link_invoice_id,
      category_id: values.financial_link_new_category_id || reimbursement.category_id || null,
      person_id: reimbursement.person_id,
      description: values.financial_link_new_description.trim(),
      amount: Number(values.financial_link_new_amount || 0),
      transaction_date: values.financial_link_new_date,
      ownership_type: "third_party",
      is_reimbursable: true,
      reimbursement_status: toTransactionReimbursementStatus(reimbursement.status),
      reimbursement_id: reimbursement.id,
      notes: "Lançamento gerado a partir de reembolso.",
    })
    .select("*")
    .single();

  if (insertResult.error) {
    console.error("Erro técnico ao criar lançamento da fatura para o reembolso:", insertResult.error);
    return { error: { message: "Não foi possível criar o lançamento na fatura selecionada." }, invoiceId: null, transactionId: null };
  }

  const updateReimbursement = await client
    .from("reimbursements")
    .update({
      credit_card_transaction_id: insertResult.data.id,
      credit_card_invoice_id: values.financial_link_invoice_id,
      source_type: "credit_card_transaction",
      source_id: insertResult.data.id,
      account_payable_id: null,
      income_source_id: null,
    })
    .eq("user_id", userId)
    .eq("id", reimbursement.id);

  if (updateReimbursement.error) {
    console.error("Erro técnico ao vincular novo lançamento ao reembolso:", updateReimbursement.error);
    await rollbackGeneratedTransaction(client, userId, insertResult.data.id);
    await recalculateInvoiceTotal(client, userId, values.financial_link_invoice_id);
    return { error: { message: "O lançamento foi criado, mas não foi possível concluir o vínculo com o reembolso." }, invoiceId: null, transactionId: null };
  }

  const recalculate = await recalculateInvoiceTotal(client, userId, values.financial_link_invoice_id);
  if (recalculate.error) {
    return { error: { message: "O lançamento foi criado, mas o total da fatura não pôde ser recalculado." }, invoiceId: null, transactionId: null };
  }

  return { error: null, invoiceId: values.financial_link_invoice_id, transactionId: insertResult.data.id };
}

async function removeFinancialLink(
  client: AppSupabaseClient,
  userId: string,
  reimbursement: ReimbursementRow,
  currentTransaction: CreditCardTransaction | null,
  removeMode: ReimbursementFormValues["financial_link_remove_mode"],
): Promise<FinancialLinkSyncResult> {
  if (!currentTransaction) {
    return clearReimbursementCardLink(client, userId, reimbursement);
  }

  const previousInvoiceId = currentTransaction.invoice_id;
  const detachResult = await detachTransactionFromReimbursement(client, userId, currentTransaction.id);
  if (detachResult.error) return detachResult;

  if (removeMode === "archive_transaction") {
    const archiveResult = await archiveRecord(
      client,
      "credit_card_transactions",
      currentTransaction.id,
      userId,
      "Lançamento arquivado ao remover vínculo do reembolso.",
    );

    if (archiveResult.error) {
      console.error("Erro técnico ao arquivar lançamento removido do reembolso:", archiveResult.error);
      return { error: { message: "O vínculo foi removido, mas não foi possível arquivar o lançamento vinculado." }, invoiceId: null, transactionId: null };
    }
  }

  const clearReimbursement = await clearReimbursementCardLink(client, userId, reimbursement);
  if (clearReimbursement.error) return clearReimbursement;

  if (previousInvoiceId) {
    const recalculate = await recalculateInvoiceTotal(client, userId, previousInvoiceId);
    if (recalculate.error) {
      return { error: { message: "O vínculo foi removido, mas não foi possível recalcular o total da fatura." }, invoiceId: null, transactionId: null };
    }
  }

  return { error: null, invoiceId: null, transactionId: null };
}

async function clearReimbursementCardLink(
  client: AppSupabaseClient,
  userId: string,
  reimbursement: ReimbursementRow,
): Promise<FinancialLinkSyncResult> {
  const updateResult = await client
    .from("reimbursements")
    .update({
      credit_card_transaction_id: null,
      credit_card_invoice_id: null,
      ...buildNonCardSourcePayload(reimbursement.account_payable_id, reimbursement.income_source_id),
    })
    .eq("user_id", userId)
    .eq("id", reimbursement.id);

  if (updateResult.error) {
    console.error("Erro técnico ao limpar vínculo financeiro do reembolso:", updateResult.error);
    return { error: { message: "Não foi possível remover o vínculo atual do reembolso." }, invoiceId: null, transactionId: null };
  }

  return { error: null, invoiceId: null, transactionId: null };
}

async function detachTransactionFromReimbursement(
  client: AppSupabaseClient,
  userId: string,
  transactionId: string,
): Promise<FinancialLinkSyncResult> {
  const updateResult = await client
    .from("credit_card_transactions")
    .update({
      reimbursement_id: null,
      is_reimbursable: false,
      reimbursement_status: "not_applicable",
    })
    .eq("user_id", userId)
    .eq("id", transactionId);

  if (updateResult.error) {
    console.error("Erro técnico ao remover vínculo do lançamento com reembolso:", updateResult.error);
    return { error: { message: "Não foi possível atualizar o lançamento vinculado ao reembolso." }, invoiceId: null, transactionId: null };
  }

  return { error: null, invoiceId: null, transactionId: null };
}

async function getInvoiceById(client: AppSupabaseClient, userId: string, invoiceId: string) {
  return client
    .from("credit_card_invoices")
    .select("id,credit_card_id,reference_month,due_date,status,total_amount")
    .eq("user_id", userId)
    .eq("id", invoiceId)
    .is("archived_at", null)
    .neq("status", "cancelled")
    .single();
}

async function getTransactionById(client: AppSupabaseClient, userId: string, transactionId: string) {
  return client
    .from("credit_card_transactions")
    .select("*")
    .eq("user_id", userId)
    .eq("id", transactionId)
    .is("archived_at", null)
    .single();
}

function buildNonCardSourcePayload(accountPayableId: string | null, incomeSourceId: string | null) {
  if (accountPayableId) {
    return { source_type: "account_payable", source_id: accountPayableId };
  }

  if (incomeSourceId) {
    return { source_type: "income_source", source_id: incomeSourceId };
  }

  return { source_type: "manual", source_id: null };
}

function toPayload(
  userId: string | undefined,
  values: ReimbursementFormValues,
  current?: ReimbursementRow,
): Partial<ReimbursementRow> {
  const linkedTransactionId =
    values.financial_link_mode === "create_invoice_transaction" || values.financial_link_mode === "remove_current"
      ? null
      : values.credit_card_transaction_id || null;
  const linkedAccountId = values.account_payable_id || null;
  const linkedIncomeId = values.income_source_id || null;
  const sourcePayload = linkedTransactionId
    ? { source_type: "credit_card_transaction", source_id: linkedTransactionId }
    : buildNonCardSourcePayload(linkedAccountId, linkedIncomeId);

  return {
    ...(userId ? { user_id: userId } : {}),
    person_id: values.person_id,
    category_id: values.category_id || null,
    credit_card_transaction_id: linkedTransactionId,
    credit_card_invoice_id: linkedTransactionId
      ? values.financial_link_invoice_id || current?.credit_card_invoice_id || values.credit_card_invoice_id || null
      : null,
    account_payable_id: linkedAccountId,
    income_source_id: linkedIncomeId,
    description: values.description.trim() || null,
    expected_amount: Number(values.expected_amount || 0),
    received_amount: Number(values.received_amount || 0),
    expected_date: values.expected_date || null,
    received_date: values.received_date || null,
    received_at: values.received_date ? `${values.received_date}T00:00:00.000Z` : null,
    status: values.status,
    ...sourcePayload,
    is_recurring: values.is_recurring,
    recurrence_frequency: values.is_recurring ? "monthly" : null,
    recurrence_start_date: values.is_recurring ? values.recurrence_start_date || values.expected_date || null : null,
    recurrence_end_date: values.is_recurring && values.recurrence_end_date ? values.recurrence_end_date : null,
    notes: values.notes.trim() || null,
  };
}

function isEligibleForRenegotiation(reimbursement: ReimbursementRow) {
  return ["expected", "partial", "late"].includes(reimbursement.status) && getOpenAmount(reimbursement) > 0;
}

function getOpenAmount(reimbursement: ReimbursementRow) {
  if (["received", "cancelled", "forgiven", "renegotiated"].includes(reimbursement.status)) return 0;
  return Math.max(Number(reimbursement.expected_amount || 0) - Number(reimbursement.received_amount || 0), 0);
}

function buildRenegotiationNotes(reimbursements: ReimbursementRow[], notes: string) {
  const lines = reimbursements.map((item) => {
    const label = item.description?.trim() || "Sem descrição";
    return `- ${label} (${item.expected_date ?? "sem data"}) · em aberto ${getOpenAmount(item).toFixed(2)}`;
  });

  return [
    notes.trim() || null,
    "Renegociação originada dos títulos:",
    ...lines,
  ]
    .filter(Boolean)
    .join("\n");
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
