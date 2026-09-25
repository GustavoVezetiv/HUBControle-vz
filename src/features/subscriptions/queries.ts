import { safeLogAction, safeLogCreate, safeLogFieldDiffs } from "@/features/audit/logger";
import { createTransaction } from "@/features/transactions/queries";
import type { AppSupabaseClient } from "@/features/shared/types";
import type { SubscriptionFormValues, SubscriptionRow } from "@/features/subscriptions/types";

export async function listSubscriptionsSupportData(client: AppSupabaseClient) {
  const [subscriptions, members, occurrences, cards, people, categories] = await Promise.all([
    client.from("subscriptions").select("*").is("archived_at", null).order("name", { ascending: true }),
    client.from("subscription_members").select("*").order("created_at", { ascending: true }),
    client.from("subscription_occurrences").select("*").order("reference_month", { ascending: false }),
    client.from("credit_cards").select("id,name,issuer").eq("is_active", true).order("name", { ascending: true }),
    client.from("people").select("id,name").order("name", { ascending: true }),
    client.from("categories").select("id,name,type,color,icon,scopes").eq("is_active", true).order("name", { ascending: true }),
  ]);

  return { subscriptions, members, occurrences, cards, people, categories };
}

export async function createSubscription(client: AppSupabaseClient, userId: string, values: SubscriptionFormValues) {
  const validationError = validateSubscriptionValues(values);
  if (validationError) return { data: null, error: { message: validationError } };

  const insertResult = await client.from("subscriptions").insert(toSubscriptionPayload(userId, values)).select("*").single();
  if (insertResult.error || !insertResult.data) {
    console.error("Erro técnico ao criar assinatura:", insertResult.error);
    return { data: null, error: { message: "Não foi possível criar a assinatura." } };
  }

  const membersResult = await replaceSubscriptionMembers(client, userId, insertResult.data.id, values.members);
  if (membersResult.error) {
    console.error("Erro técnico ao salvar participantes da assinatura:", membersResult.error);
    await client.from("subscriptions").delete().eq("user_id", userId).eq("id", insertResult.data.id);
    return { data: null, error: { message: "Não foi possível salvar os participantes da assinatura." } };
  }

  await safeLogCreate(client, userId, "subscriptions", insertResult.data.id, insertResult.data, { member_count: values.members.length });
  return { data: insertResult.data, error: null };
}

export async function updateSubscription(client: AppSupabaseClient, userId: string, id: string, values: SubscriptionFormValues) {
  const validationError = validateSubscriptionValues(values);
  if (validationError) return { data: null, error: { message: validationError } };

  const currentResult = await client.from("subscriptions").select("*").eq("user_id", userId).eq("id", id).single();
  if (currentResult.error || !currentResult.data) {
    console.error("Erro técnico ao buscar assinatura para edição:", currentResult.error);
    return { data: null, error: { message: "Não foi possível encontrar a assinatura." } };
  }

  const updateResult = await client.from("subscriptions").update(toSubscriptionPayload(undefined, values)).eq("user_id", userId).eq("id", id).select("*").single();
  if (updateResult.error || !updateResult.data) {
    console.error("Erro técnico ao atualizar assinatura:", updateResult.error);
    return { data: null, error: { message: "Não foi possível atualizar a assinatura." } };
  }

  const membersResult = await replaceSubscriptionMembers(client, userId, id, values.members);
  if (membersResult.error) {
    console.error("Erro técnico ao atualizar participantes da assinatura:", membersResult.error);
    return { data: null, error: { message: "A assinatura foi atualizada, mas os participantes não puderam ser salvos." } };
  }

  await safeLogFieldDiffs(client, userId, "subscriptions", id, currentResult.data, updateResult.data, { member_count: values.members.length });
  return { data: updateResult.data, error: null };
}

export async function generateSubscriptionOccurrence(
  client: AppSupabaseClient,
  userId: string,
  subscription: SubscriptionRow,
  referenceMonth: string,
) {
  if (subscription.status !== "active") return { data: null, error: { message: "Ative a assinatura antes de gerar uma cobrança." } };
  if (!/^\d{4}-\d{2}$/.test(referenceMonth)) return { data: null, error: { message: "Informe um mês de referência válido." } };

  const transactionDate = getBillingDate(referenceMonth, subscription.billing_day);
  if (subscription.start_date > transactionDate || (subscription.end_date && subscription.end_date < transactionDate)) {
    return { data: null, error: { message: "O mês selecionado está fora do período ativo desta assinatura." } };
  }

  const occurrenceResult = await client
    .from("subscription_occurrences")
    .insert({
      user_id: userId,
      subscription_id: subscription.id,
      reference_month: `${referenceMonth}-01`,
      transaction_date: transactionDate,
      status: "generating",
    })
    .select("*")
    .single();

  if (occurrenceResult.error || !occurrenceResult.data) {
    console.error("Erro técnico ao reservar ocorrência de assinatura:", occurrenceResult.error);
    return { data: null, error: { message: "Esta assinatura já possui uma cobrança gerada ou em processamento neste mês." } };
  }

  const occurrence = occurrenceResult.data;
  const membersResult = await client
    .from("subscription_members")
    .select("*")
    .eq("user_id", userId)
    .eq("subscription_id", subscription.id)
    .eq("is_active", true);

  if (membersResult.error) {
    return markOccurrenceFailed(client, userId, occurrence.id, "Não foi possível buscar os participantes da assinatura.");
  }

  const members = membersResult.data ?? [];
  const sharesTotal = members.reduce((sum, member) => sum + Number(member.share_amount || 0), 0);
  if (sharesTotal > Number(subscription.amount) + 0.001) {
    return markOccurrenceFailed(client, userId, occurrence.id, "A soma dos reembolsos não pode ser maior que o valor da assinatura.");
  }

  let groupId: string | null = null;
  if (members.length > 0) {
    const groupResult = await client
      .from("reimbursement_groups")
      .insert({
        user_id: userId,
        subscription_id: subscription.id,
        category_id: subscription.category_id,
        description: subscription.name,
        expected_date: transactionDate,
        total_amount: sharesTotal,
        notes: `Reembolsos gerados pela assinatura ${subscription.name}.`,
      })
      .select("*")
      .single();

    if (groupResult.error || !groupResult.data) {
      console.error("Erro técnico ao criar grupo de reembolsos da assinatura:", groupResult.error);
      return markOccurrenceFailed(client, userId, occurrence.id, "Não foi possível preparar os reembolsos compartilhados.");
    }
    groupId = groupResult.data.id;

    const reimbursementsResult = await client.from("reimbursements").insert(
      members.map((member) => ({
        user_id: userId,
        person_id: member.person_id,
        category_id: subscription.category_id,
        source_type: "reimbursement_group" as const,
        source_id: groupId,
        reimbursement_group_id: groupId,
        description: subscription.name,
        expected_amount: Number(member.share_amount),
        received_amount: 0,
        status: "expected",
        expected_date: transactionDate,
        notes: `Reembolso de assinatura gerado para ${referenceMonth}.`,
      })),
    );
    if (reimbursementsResult.error) {
      console.error("Erro técnico ao criar reembolsos da assinatura:", reimbursementsResult.error);
      await client.from("reimbursement_groups").delete().eq("user_id", userId).eq("id", groupId);
      return markOccurrenceFailed(client, userId, occurrence.id, "Não foi possível criar os reembolsos da assinatura.");
    }
  }

  const transactionResult = await createTransaction(client, userId, {
    credit_card_id: subscription.credit_card_id,
    invoice_id: "",
    transaction_date: transactionDate,
    description: subscription.name,
    amount: String(subscription.amount),
    category_id: subscription.category_id ?? "",
    person_id: "",
    ownership_type: members.length > 0 ? "shared" : "personal",
    is_installment_purchase: false,
    installment_number: "",
    installment_total: "",
    is_reimbursable: members.length > 0,
    notes: `Gerado pela assinatura ${subscription.name} (${referenceMonth}).`,
    create_reimbursement: false,
    reimbursement_expected_date: "",
    is_recurring: false,
    recurrence_frequency: "monthly",
    recurrence_start_date: "",
    recurrence_end_date: "",
    recurrence_occurrences: "0",
  });

  if (transactionResult.error || !transactionResult.data) {
    console.error("Erro técnico ao criar lançamento da assinatura:", transactionResult.error);
    if (groupId) {
      await client.from("reimbursements").delete().eq("user_id", userId).eq("reimbursement_group_id", groupId);
      await client.from("reimbursement_groups").delete().eq("user_id", userId).eq("id", groupId);
    }
    return markOccurrenceFailed(client, userId, occurrence.id, "Não foi possível criar o lançamento na fatura do cartão.");
  }

  if (groupId) {
    const groupUpdate = await client
      .from("reimbursement_groups")
      .update({ credit_card_transaction_id: transactionResult.data.id, credit_card_invoice_id: transactionResult.data.invoice_id })
      .eq("user_id", userId)
      .eq("id", groupId);
    if (groupUpdate.error) {
      console.error("Erro técnico ao vincular grupo de reembolsos à assinatura:", groupUpdate.error);
      return markOccurrenceFailed(client, userId, occurrence.id, "O lançamento foi criado, mas o vínculo dos reembolsos não pôde ser finalizado.", transactionResult.data.id, groupId);
    }
  }

  const completionResult = await client
    .from("subscription_occurrences")
    .update({
      status: "generated",
      credit_card_transaction_id: transactionResult.data.id,
      reimbursement_group_id: groupId,
      generated_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("user_id", userId)
    .eq("id", occurrence.id)
    .select("*")
    .single();

  if (completionResult.error || !completionResult.data) {
    console.error("Erro técnico ao finalizar ocorrência de assinatura:", completionResult.error);
    return { data: null, error: { message: "O lançamento foi criado, mas a ocorrência não pôde ser finalizada. Não gere novamente antes de revisar o histórico." } };
  }

  await safeLogAction(client, {
    user_id: userId,
    module: "subscriptions",
    record_id: subscription.id,
    action: "create",
    field_name: "occurrence",
    old_value: null,
    new_value: { occurrence_id: completionResult.data.id, transaction_id: transactionResult.data.id, reimbursement_group_id: groupId },
    metadata: { reference_month: referenceMonth, reimbursement_count: members.length },
  });

  return { data: { occurrence: completionResult.data, reimbursementCount: members.length }, error: null };
}

async function replaceSubscriptionMembers(
  client: AppSupabaseClient,
  userId: string,
  subscriptionId: string,
  members: SubscriptionFormValues["members"],
) {
  const deleteResult = await client.from("subscription_members").delete().eq("user_id", userId).eq("subscription_id", subscriptionId);
  if (deleteResult.error) return deleteResult;
  if (members.length === 0) return { error: null };

  return client.from("subscription_members").insert(
    members.map((member) => ({
      user_id: userId,
      subscription_id: subscriptionId,
      person_id: member.person_id,
      share_amount: Number(member.share_amount),
      is_active: true,
    })),
  );
}

function validateSubscriptionValues(values: SubscriptionFormValues) {
  const amount = Number(values.amount || 0);
  const billingDay = Number(values.billing_day || 0);
  const memberIds = new Set(values.members.map((member) => member.person_id));
  const sharesTotal = values.members.reduce((sum, member) => sum + Number(member.share_amount || 0), 0);

  if (!values.credit_card_id || !values.name.trim() || !values.start_date || amount <= 0 || billingDay < 1 || billingDay > 31) {
    return "Informe nome, cartão, valor, dia de cobrança e início da assinatura.";
  }
  if (values.end_date && values.end_date < values.start_date) return "O fim da assinatura deve ser posterior ao início.";
  if (memberIds.size !== values.members.length || values.members.some((member) => !member.person_id || Number(member.share_amount) <= 0)) {
    return "Cada pessoa deve aparecer uma vez e ter um valor de reembolso válido.";
  }
  if (sharesTotal > amount + 0.001) return "A soma dos reembolsos não pode ser maior que o valor da assinatura.";
  return null;
}

function toSubscriptionPayload(userId: string | undefined, values: SubscriptionFormValues) {
  return {
    ...(userId ? { user_id: userId } : {}),
    credit_card_id: values.credit_card_id,
    category_id: values.category_id || null,
    name: values.name.trim(),
    description: values.description.trim() || null,
    amount: Number(values.amount),
    billing_day: Number(values.billing_day),
    start_date: values.start_date,
    end_date: values.end_date || null,
    status: values.status,
    notes: values.notes.trim() || null,
  };
}

function getBillingDate(referenceMonth: string, billingDay: number) {
  const [year, month] = referenceMonth.split("-").map(Number);
  const finalDay = Math.min(billingDay, new Date(year, month, 0).getDate());
  return `${referenceMonth}-${String(finalDay).padStart(2, "0")}`;
}

async function markOccurrenceFailed(
  client: AppSupabaseClient,
  userId: string,
  occurrenceId: string,
  message: string,
  transactionId?: string | null,
  groupId?: string | null,
) {
  await client
    .from("subscription_occurrences")
    .update({ status: "failed", error_message: message, credit_card_transaction_id: transactionId ?? null, reimbursement_group_id: groupId ?? null })
    .eq("user_id", userId)
    .eq("id", occurrenceId);
  return { data: null, error: { message } };
}
