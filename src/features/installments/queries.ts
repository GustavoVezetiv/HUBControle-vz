import type { AppSupabaseClient } from "@/features/shared/types";
import type { InstallmentFormValues, InstallmentRow } from "@/features/installments/types";
import { createSafeUuid } from "@/lib/uuid";

export type GenerateInstallmentAccountsResult = {
  created: number;
  skipped: number;
  error: { message: string } | null;
};

export async function listInstallments(client: AppSupabaseClient) {
  return client.from("installments").select("*").order("due_month", { ascending: true });
}

export async function listInstallmentSupportData(client: AppSupabaseClient) {
  const [cards, invoices, transactions, categories, people] = await Promise.all([
    client.from("credit_cards").select("id,name").order("name", { ascending: true }),
    client.from("credit_card_invoices").select("id,credit_card_id,reference_month,due_date,status").order("due_date", { ascending: false }),
    client.from("credit_card_transactions").select("id,credit_card_id,invoice_id,description,amount,transaction_date").order("transaction_date", { ascending: false }),
    client.from("categories").select("id,name,type,color,icon").order("name", { ascending: true }),
    client.from("people").select("id,name").order("name", { ascending: true }),
  ]);

  return { cards, invoices, transactions, categories, people };
}

export async function createInstallment(client: AppSupabaseClient, userId: string, values: InstallmentFormValues) {
  return client
    .from("installments")
    .insert({
      ...toPayload(userId, values),
      // Kept for compatibility with databases that have not run the default UUID migration yet.
      installment_group_id: createSafeUuid(),
    })
    .select("*")
    .single();
}

export async function updateInstallment(client: AppSupabaseClient, id: string, values: InstallmentFormValues) {
  return client.from("installments").update(toPayload(undefined, values)).eq("id", id).select("*").single();
}

export async function deleteInstallment(client: AppSupabaseClient, id: string) {
  return client.from("installments").delete().eq("id", id);
}

export async function listGeneratedAccountsForInstallment(client: AppSupabaseClient, installmentId: string) {
  return client
    .from("accounts_payable")
    .select("id,title,status,amount,due_date")
    .eq("installment_id", installmentId)
    .eq("is_generated", true);
}

export async function unlinkPaidGeneratedAccountsForInstallment(client: AppSupabaseClient, installmentId: string) {
  return client
    .from("accounts_payable")
    .update({
      installment_id: null,
      source_type: "manual",
      source_id: null,
      is_generated: false,
    })
    .eq("installment_id", installmentId)
    .eq("is_generated", true)
    .eq("status", "paid");
}

export async function unlinkKeptGeneratedAccountsForInstallment(client: AppSupabaseClient, installmentId: string) {
  return client
    .from("accounts_payable")
    .update({
      installment_id: null,
      source_type: "manual",
      source_id: null,
      is_generated: false,
    })
    .eq("installment_id", installmentId)
    .eq("is_generated", true);
}

export async function deletePendingGeneratedAccountsForInstallment(client: AppSupabaseClient, installmentId: string) {
  return client
    .from("accounts_payable")
    .delete()
    .eq("installment_id", installmentId)
    .eq("is_generated", true)
    .neq("status", "paid");
}

export async function generateInstallmentAccounts(
  client: AppSupabaseClient,
  userId: string,
  installment: InstallmentRow,
): Promise<GenerateInstallmentAccountsResult> {
  const total = Number(installment.installment_total ?? installment.installment_count);
  const current = Number(installment.current_installment ?? installment.installment_number);
  const startDate = installment.start_date ?? installment.due_month;

  if (!installment.id || !startDate || total <= 0 || current <= 0 || current > total) {
    return {
      created: 0,
      skipped: 0,
      error: { message: "Parcelamento inválido para gerar contas mensais." },
    };
  }

  const installmentNumbers = Array.from({ length: total - current + 1 }, (_, index) => current + index);
  const existingResult = await client
    .from("accounts_payable")
    .select("id,installment_number")
    .eq("user_id", userId)
    .eq("installment_id", installment.id)
    .eq("is_generated", true)
    .in("installment_number", installmentNumbers);

  if (existingResult.error) {
    console.error("Erro técnico ao verificar parcelas geradas:", existingResult.error);
    return { created: 0, skipped: 0, error: { message: "Não foi possível verificar parcelas já geradas." } };
  }

  const existingNumbers = new Set((existingResult.data ?? []).map((item) => Number(item.installment_number)));
  const rows = installmentNumbers
    .filter((installmentNumber) => !existingNumbers.has(installmentNumber))
    .map((installmentNumber) => ({
      user_id: userId,
      category_id: installment.category_id,
      person_id: installment.person_id,
      title: installment.description,
      description: `Parcela ${installmentNumber}/${total} gerada a partir de Parcelamentos.`,
      amount: Number(installment.installment_amount),
      due_date: addMonths(startDate, installmentNumber - 1),
      status: "pending",
      priority: "medium",
      risk_level: "medium",
      payment_method_planned: installment.credit_card_id ? "credit_card" : "unknown",
      can_delay: false,
      delay_risk: "medium",
      notes: installment.notes,
      source_type: "installment",
      source_id: installment.id,
      installment_id: installment.id,
      installment_number: installmentNumber,
      is_generated: true,
      paid_at: null,
    }));

  if (rows.length === 0) {
    return { created: 0, skipped: installmentNumbers.length, error: null };
  }

  const insertResult = await client.from("accounts_payable").insert(rows).select("id");

  if (insertResult.error) {
    console.error("Erro técnico ao gerar contas do parcelamento:", insertResult.error);
    return {
      created: 0,
      skipped: installmentNumbers.length - rows.length,
      error: { message: "Não foi possível gerar as contas mensais do parcelamento." },
    };
  }

  return {
    created: insertResult.data?.length ?? rows.length,
    skipped: installmentNumbers.length - rows.length,
    error: null,
  };
}

function toPayload(userId: string | undefined, values: InstallmentFormValues): Partial<InstallmentRow> {
  const total = Number(values.installment_total || 1);
  const current = Number(values.current_installment || 1);
  const startDate = values.start_date || values.end_date;

  return {
    ...(userId ? { user_id: userId } : {}),
    description: values.description.trim(),
    total_amount: Number(values.total_amount || 0),
    installment_amount: Number(values.installment_amount || 0),
    installment_total: total,
    current_installment: current,
    installment_count: total,
    installment_number: current,
    due_month: startDate,
    start_date: startDate || null,
    end_date: values.end_date || null,
    credit_card_id: values.credit_card_id || null,
    invoice_id: values.invoice_id || null,
    credit_card_transaction_id: values.credit_card_transaction_id || null,
    category_id: values.category_id || null,
    person_id: values.person_id || null,
    installment_origin: values.installment_origin,
    status: values.status,
    notes: values.notes.trim() || null,
  };
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
