import type {
  IncomeSourceFormValues,
  IncomeSourceRow,
} from "@/features/income-sources/types";
import { inflowKindFromType } from "@/features/income-sources/types";
import type { AppSupabaseClient } from "@/features/shared/types";
import { archiveRecord, restoreArchivedRecord } from "@/features/shared/archive";

export type GenerateRecurringIncomeSourcesResult = {
  created: number;
  skipped: number;
  error: { message: string } | null;
};

export async function listIncomeSources(client: AppSupabaseClient) {
  return client.from("income_sources").select("*").is("archived_at", null).order("expected_date", { ascending: true });
}

export async function createIncomeSource(
  client: AppSupabaseClient,
  userId: string,
  values: IncomeSourceFormValues,
) {
  return client.from("income_sources").insert(toPayload(userId, values)).select("*").single();
}

export async function updateIncomeSource(
  client: AppSupabaseClient,
  id: string,
  values: IncomeSourceFormValues,
) {
  return client
    .from("income_sources")
    .update(toPayload(undefined, values))
    .eq("id", id)
    .select("*")
    .single();
}

export async function archiveIncomeSource(client: AppSupabaseClient, id: string, userId: string, reason?: string) {
  return archiveRecord(client, "income_sources", id, userId, reason);
}

export async function restoreIncomeSource(client: AppSupabaseClient, id: string, userId: string) {
  return restoreArchivedRecord(client, "income_sources", id, userId);
}

export async function generateRecurringIncomeSources(
  client: AppSupabaseClient,
  userId: string,
  income: IncomeSourceRow,
  requestedOccurrences: number,
): Promise<GenerateRecurringIncomeSourcesResult> {
  const occurrences = Math.min(Math.max(Math.floor(requestedOccurrences), 1), 24);

  if (!income.is_recurring || income.recurrence_frequency !== "monthly") {
    return { created: 0, skipped: 0, error: { message: "Esta receita não está configurada como recorrente mensal." } };
  }

  const parentId = income.recurrence_parent_id ?? income.id;
  const baseDate = income.recurrence_generated_until ?? income.recurrence_start_date ?? income.expected_date;

  if (!baseDate) {
    return { created: 0, skipped: 0, error: { message: "Informe a data inicial da recorrência." } };
  }

  const candidateDates: string[] = [];
  let cursor = baseDate;

  for (let index = 0; index < occurrences; index += 1) {
    cursor = addMonths(cursor, 1);

    if (income.recurrence_end_date && cursor > income.recurrence_end_date) {
      break;
    }

    candidateDates.push(cursor);
  }

  if (candidateDates.length === 0) {
    return { created: 0, skipped: 0, error: { message: "Nenhuma receita futura dentro do período da recorrência." } };
  }

  const existingResult = await client
    .from("income_sources")
    .select("id,expected_date,name")
    .eq("user_id", userId)
    .eq("recurrence_parent_id", parentId)
    .in("expected_date", candidateDates);

  if (existingResult.error) {
    console.error("Erro técnico ao verificar receitas recorrentes existentes:", existingResult.error);
    return { created: 0, skipped: 0, error: { message: "Não foi possível verificar receitas recorrentes existentes." } };
  }

  const normalizedName = income.name.trim().toLowerCase();
  const existingKeys = new Set(
    (existingResult.data ?? []).map((item) => `${item.expected_date}:${item.name.trim().toLowerCase()}`),
  );
  const rows = candidateDates
    .filter((date) => !existingKeys.has(`${date}:${normalizedName}`))
    .map((date) => ({
      user_id: userId,
      category_id: income.category_id,
      person_id: income.person_id,
      name: income.name,
      description: income.description,
      source_type: income.source_type,
      inflow_kind: income.inflow_kind,
      amount: income.amount,
      expected_date: date,
      received_date: null,
      received_at: null,
      is_recurring: true,
      recurrence_frequency: "monthly",
      recurrence_start_date: income.recurrence_start_date ?? income.expected_date,
      recurrence_end_date: income.recurrence_end_date,
      recurrence_parent_id: parentId,
      status: "expected",
      confidence: income.confidence,
      notes: income.notes,
    }));

  let created = 0;

  if (rows.length > 0) {
    const insertResult = await client.from("income_sources").insert(rows).select("id");

    if (insertResult.error) {
      console.error("Erro técnico ao gerar receitas recorrentes:", insertResult.error);
      return { created: 0, skipped: candidateDates.length - rows.length, error: { message: "Não foi possível gerar as próximas receitas." } };
    }

    created = insertResult.data?.length ?? rows.length;
  }

  const updateResult = await client
    .from("income_sources")
    .update({ recurrence_generated_until: candidateDates[candidateDates.length - 1] })
    .eq("id", parentId);

  if (updateResult.error) {
    console.error("Erro técnico ao atualizar controle da recorrência de receita:", updateResult.error);
    return {
      created,
      skipped: candidateDates.length - rows.length,
      error: { message: "As receitas foram geradas, mas o controle da recorrência não foi atualizado." },
    };
  }

  return { created, skipped: candidateDates.length - rows.length, error: null };
}

export async function listIncomeSupportData(client: AppSupabaseClient) {
  const [categories, people] = await Promise.all([
    client
      .from("categories")
      .select("id,name,type,color,icon")
      .in("type", ["income", "reimbursement", "other"])
      .order("name", { ascending: true }),
    client.from("people").select("id,name").order("name", { ascending: true }),
  ]);

  return { categories, people };
}

function toPayload(
  userId: string | undefined,
  values: IncomeSourceFormValues,
): Partial<IncomeSourceRow> {
  const receivedDate = values.received_date || null;

  return {
    ...(userId ? { user_id: userId } : {}),
    name: values.source.trim(),
    description: values.description.trim() || null,
    amount: Number(values.amount || 0),
    expected_date: values.expected_date || null,
    received_date: receivedDate,
    received_at: receivedDate ? `${receivedDate}T00:00:00.000Z` : null,
    category_id: values.category_id || null,
    person_id: values.person_id || null,
    source_type: values.type,
    inflow_kind: inflowKindFromType(values.type),
    confidence: values.confidence,
    status: values.status,
    is_recurring: values.is_recurring,
    recurrence_frequency: values.is_recurring ? "monthly" : null,
    recurrence_start_date: values.is_recurring ? values.recurrence_start_date || values.expected_date || null : null,
    recurrence_end_date: values.is_recurring && values.recurrence_end_date ? values.recurrence_end_date : null,
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
