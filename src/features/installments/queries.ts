import type { AppSupabaseClient } from "@/features/shared/types";
import type { InstallmentFormValues, InstallmentRow } from "@/features/installments/types";
import { createSafeUuid } from "@/lib/uuid";
import { safeLogAction, safeLogCreate } from "@/features/audit/logger";
import { logFinancialLinkCreated, logFinancialLinkUpdated } from "@/features/linked-entries/queries";

export type GenerateInstallmentAccountsResult = {
  created: number;
  skipped: number;
  error: { message: string } | null;
};

export type InstallmentGeneratedAccountSummary = {
  installment_id: string;
  generatedCount: number;
  paidCount: number;
  pendingCount: number;
  nextDueDate: string | null;
  remainingAmount: number;
};

export type RegisterInstallmentPaymentValues = {
  installmentNumber: number;
  paymentDate: string;
  paymentMethod: string;
  paidAmount: number;
  notes?: string;
};

export async function listInstallments(client: AppSupabaseClient) {
  return client.from("installments").select("*").order("due_month", { ascending: true });
}

export async function listInstallmentSupportData(client: AppSupabaseClient) {
  const [cards, invoices, transactions, categories, people] = await Promise.all([
    client.from("credit_cards").select("id,name").eq("is_active", true).order("name", { ascending: true }),
    client
      .from("credit_card_invoices")
      .select("id,credit_card_id,reference_month,due_date,status")
      .is("archived_at", null)
      .neq("status", "cancelled")
      .order("due_date", { ascending: false }),
    client.from("credit_card_transactions").select("id,credit_card_id,invoice_id,description,amount,transaction_date").order("transaction_date", { ascending: false }),
    client
      .from("categories")
      .select("id,name,type,color,icon,scopes")
      .eq("is_active", true)
      .order("name", { ascending: true }),
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

export async function listGeneratedAccountsSummaryForInstallments(
  client: AppSupabaseClient,
  installmentIds: string[],
): Promise<{ data: InstallmentGeneratedAccountSummary[]; error: { message: string } | null }> {
  if (installmentIds.length === 0) {
    return { data: [], error: null };
  }

  const result = await client
    .from("accounts_payable")
    .select("installment_id,status,due_date,amount")
    .eq("is_generated", true)
    .in("installment_id", installmentIds);

  if (result.error) {
    console.error("Erro técnico ao carregar resumo de contas geradas dos parcelamentos:", result.error);
    return { data: [], error: { message: "Não foi possível carregar o resumo das contas geradas." } };
  }

  const summaryMap = new Map<string, InstallmentGeneratedAccountSummary>();

  for (const row of result.data ?? []) {
    if (!row.installment_id) continue;

    const current = summaryMap.get(row.installment_id) ?? {
      installment_id: row.installment_id,
      generatedCount: 0,
      paidCount: 0,
      pendingCount: 0,
      nextDueDate: null,
      remainingAmount: 0,
    };

    current.generatedCount += 1;
    if (row.status === "paid") current.paidCount += 1;
    else {
      current.pendingCount += 1;
      current.remainingAmount += Number(row.amount || 0);
      if (!current.nextDueDate || row.due_date < current.nextDueDate) {
        current.nextDueDate = row.due_date;
      }
    }

    summaryMap.set(row.installment_id, current);
  }

  return { data: Array.from(summaryMap.values()), error: null };
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
  if (isInstallmentControlledByCard(installment)) {
    return {
      created: 0,
      skipped: 0,
      error: { message: "Este parcelamento é controlado pelas faturas do cartão." },
    };
  }

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
    .select("id,installment_number,amount,due_date")
    .eq("user_id", userId)
    .eq("installment_id", installment.id)
    .eq("is_generated", true)
    .in("installment_number", installmentNumbers);

  if (existingResult.error) {
    console.error("Erro técnico ao verificar parcelas geradas:", existingResult.error);
    return { created: 0, skipped: 0, error: { message: "Não foi possível verificar parcelas já geradas." } };
  }

  const existingNumbers = new Set((existingResult.data ?? []).map((item) => Number(item.installment_number)));
  const existingKeys = new Set(
    (existingResult.data ?? []).map((item) =>
      buildInstallmentAccountDuplicateKey(
        Number(item.installment_number),
        Number(item.amount),
        item.due_date,
      ),
    ),
  );
  const rows = installmentNumbers
    .map((installmentNumber) => {
      const dueDate = addMonths(startDate, installmentNumber - 1);
      const amount = Number(installment.installment_amount);
      const duplicateKey = buildInstallmentAccountDuplicateKey(installmentNumber, amount, dueDate);

      return {
        installmentNumber,
        dueDate,
        amount,
        shouldSkip: existingNumbers.has(installmentNumber) || existingKeys.has(duplicateKey),
      };
    })
    .filter((candidate) => !candidate.shouldSkip)
    .map((candidate) => ({
      user_id: userId,
      category_id: installment.category_id,
      person_id: installment.person_id,
      title: installment.description,
      description: `Parcela ${candidate.installmentNumber}/${total} gerada a partir de Parcelamentos.`,
      amount: candidate.amount,
      due_date: candidate.dueDate,
      status: "pending",
      priority: "medium",
      risk_level: "medium" as const,
      payment_method_planned: installment.credit_card_id ? "credit_card" : "unknown",
      can_delay: false,
      delay_risk: "medium" as const,
      notes: installment.notes,
      source_type: "installment",
      source_id: installment.id,
      linked_module: "installments",
      linked_record_id: installment.id,
      installment_id: installment.id,
      installment_number: candidate.installmentNumber,
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

  for (const row of insertResult.data ?? []) {
    await safeLogAction(client, {
      user_id: userId,
      module: "accounts_payable",
      record_id: row.id,
      action: "account_generated",
      field_name: null,
      old_value: null,
      new_value: {
        source_type: "installment",
        installment_id: installment.id,
      },
      metadata: {
        generated_by: "generate_installment_accounts",
      },
    });

    await logFinancialLinkCreated(client, userId, "accounts_payable", row.id, "installments", installment.id, {
      source_type: "installment",
      installment_id: installment.id,
      generated_by: "generate_installment_accounts",
    });
  }

  return {
    created: insertResult.data?.length ?? rows.length,
    skipped: installmentNumbers.length - rows.length,
    error: null,
  };
}

export async function registerInstallmentPayment(
  client: AppSupabaseClient,
  userId: string,
  installment: InstallmentRow,
  values: RegisterInstallmentPaymentValues,
  linkedIncomeSourceId?: string | null,
) {
  if (isInstallmentControlledByCard(installment)) {
    return { data: null, error: { message: "Este parcelamento é controlado pelas faturas do cartão." } };
  }

  if (values.paidAmount <= 0 || values.installmentNumber <= 0 || !values.paymentDate) {
    return { data: null, error: { message: "Informe parcela, data e valor de pagamento válidos." } };
  }

  const total = Number(installment.installment_total ?? installment.installment_count);
  if (values.installmentNumber > total) {
    return { data: null, error: { message: "A parcela informada não existe neste parcelamento." } };
  }

  const accountResult = await getOrCreateInstallmentAccount(client, userId, installment, values);
  if (accountResult.error || !accountResult.data) {
    return { data: null, error: accountResult.error ?? { message: "Não foi possível localizar a parcela." } };
  }

  if (accountResult.data.status === "paid") {
    return { data: null, error: { message: "Esta parcela já está paga." } };
  }

  const previousAccount = accountResult.data;
  const nextNotes = mergePaymentNotes(previousAccount.notes, values.notes);
  const updateResult = await client
    .from("accounts_payable")
    .update({
      amount: values.paidAmount,
      status: "paid",
      paid_at: `${values.paymentDate}T00:00:00.000Z`,
      payment_method_planned: values.paymentMethod,
      notes: nextNotes,
      linked_module: "installments",
      linked_record_id: installment.id,
    })
    .eq("id", accountResult.data.id)
    .select("*")
    .single();

  if (updateResult.error) {
    console.error("Erro técnico ao registrar pagamento da parcela:", updateResult.error);
    return { data: null, error: { message: "Não foi possível registrar o pagamento da parcela." } };
  }

  await logFinancialLinkUpdated(client, userId, "accounts_payable", updateResult.data.id, "installments", installment.id, {
    source_type: "installment",
    installment_id: installment.id,
    installment_number: updateResult.data.installment_number,
  });

  const paidResult = await client
    .from("accounts_payable")
    .select("installment_number,status")
    .eq("installment_id", installment.id)
    .eq("is_generated", true);

  if (!paidResult.error) {
    const paidNumbers = (paidResult.data ?? [])
      .filter((account) => account.status === "paid" && account.installment_number)
      .map((account) => Number(account.installment_number));
    const highestPaid = paidNumbers.length > 0 ? Math.max(...paidNumbers) : 0;
    await client
      .from("installments")
      .update({
        current_installment: Math.min(Math.max(highestPaid + 1, 1), total),
        installment_number: Math.min(Math.max(highestPaid + 1, 1), total),
        status: highestPaid >= total ? "finished" : installment.status,
      })
      .eq("id", installment.id);
  } else {
    console.error("Erro técnico ao sincronizar progresso do parcelamento:", paidResult.error);
  }

  await safeLogAction(client, {
    user_id: userId,
    module: "installments",
    record_id: installment.id,
    action: "payment_registered",
    field_name: null,
    old_value: {
      amount: previousAccount.amount,
      status: previousAccount.status,
      paid_at: previousAccount.paid_at,
    },
    new_value: {
      amount: updateResult.data.amount,
      payment_date: values.paymentDate,
      payment_method: values.paymentMethod,
      account_payable_id: updateResult.data.id,
    },
    metadata: {
      linked_income_source_id: linkedIncomeSourceId ?? null,
      installment_number: updateResult.data.installment_number,
    },
  });

  return { data: updateResult.data, error: null };
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

function buildInstallmentAccountDuplicateKey(
  installmentNumber: number,
  amount: number,
  dueDate: string,
) {
  return `${installmentNumber}|${amount.toFixed(2)}|${dueDate}`;
}

async function getOrCreateInstallmentAccount(
  client: AppSupabaseClient,
  userId: string,
  installment: InstallmentRow,
  values: RegisterInstallmentPaymentValues,
) {
  const installmentNumber = values.installmentNumber;
  const existingResult = await client
    .from("accounts_payable")
    .select("*")
    .eq("user_id", userId)
    .eq("installment_id", installment.id)
    .eq("is_generated", true)
    .eq("installment_number", installmentNumber)
    .maybeSingle();

  if (existingResult.error) {
    console.error("Erro técnico ao buscar conta gerada do parcelamento:", existingResult.error);
    return { data: null, error: { message: "Não foi possível verificar a conta gerada do parcelamento." } };
  }

  if (existingResult.data) {
    return { data: existingResult.data, error: null };
  }

  const total = Number(installment.installment_total ?? installment.installment_count);
  const startDate = installment.start_date || installment.due_month || values.paymentDate;
  const dueDate = addMonths(startDate, installmentNumber - 1);
  const insertResult = await client
    .from("accounts_payable")
    .insert({
      user_id: userId,
      category_id: installment.category_id,
      person_id: installment.person_id,
      title: installment.description,
      description: `Parcela ${installmentNumber}/${total} gerada no registro de pagamento.`,
      amount: values.paidAmount,
      due_date: dueDate,
      status: "pending",
      priority: "medium",
      risk_level: "medium",
      payment_method_planned: values.paymentMethod,
      can_delay: false,
      delay_risk: "medium",
      notes: installment.notes,
      source_type: "installment",
      source_id: installment.id,
      linked_module: "installments",
      linked_record_id: installment.id,
      installment_id: installment.id,
      installment_number: installmentNumber,
      is_generated: true,
      paid_at: null,
    })
    .select("*")
    .single();

  if (insertResult.error) {
    console.error("Erro técnico ao criar conta da parcela:", insertResult.error);
    return { data: null, error: { message: "Não foi possível criar a conta vinculada ao parcelamento." } };
  }

  await safeLogCreate(client, userId, "accounts_payable", insertResult.data.id, insertResult.data, {
    source_type: "installment",
    installment_id: installment.id,
  });

  await safeLogAction(client, {
    user_id: userId,
    module: "accounts_payable",
    record_id: insertResult.data.id,
    action: "account_generated",
    field_name: null,
    old_value: null,
    new_value: {
      source_type: "installment",
      installment_id: installment.id,
      installment_number: installmentNumber,
    },
    metadata: {
      generated_by: "register_installment_payment",
    },
  });

  await logFinancialLinkCreated(client, userId, "accounts_payable", insertResult.data.id, "installments", installment.id, {
    source_type: "installment",
    installment_id: installment.id,
    installment_number: installmentNumber,
  });

  return { data: insertResult.data, error: null };
}

function isInstallmentControlledByCard(installment: InstallmentRow) {
  return Boolean(installment.credit_card_id || installment.invoice_id || installment.credit_card_transaction_id);
}

function mergePaymentNotes(currentNotes: string | null, paymentNotes: string | undefined) {
  const trimmed = paymentNotes?.trim();
  if (!trimmed) return currentNotes;
  return [currentNotes, `Pagamento registrado pelo módulo Parcelamentos: ${trimmed}`].filter(Boolean).join("\n");
}
