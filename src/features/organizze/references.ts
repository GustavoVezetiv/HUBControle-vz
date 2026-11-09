import type { AppSupabaseClient } from "@/features/shared/types";
import type { Period, References } from "./types";
import { validatePeriod } from "./extraction";

// Explicit ranges prevent silently accepting the Data API's default row limit.
export async function allReferencePages<T>(
  query: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown; count: number | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  let expected: number | null = null;
  for (let offset = 0; offset < 200000; offset += 500) {
    const result = await query(offset, offset + 499);
    if (
      result.error ||
      !result.data ||
      result.count === null ||
      (expected !== null && expected !== result.count)
    ) {
      throw new Error(
        "Não foi possível conferir todas as referências do Hub (ou os dados mudaram durante a consulta).",
      );
    }
    expected = result.count;
    rows.push(...result.data);
    if (rows.length === expected) return rows;
    if (result.data.length !== 500 || rows.length > expected)
      throw new Error("Referências truncadas; conciliação incompleta.");
  }
  throw new Error("Limite de referências excedido; conciliação incompleta.");
}

export async function loadOrganizzeReferences(
  client: AppSupabaseClient,
  ownerId: string,
  period: Period,
): Promise<References> {
  validatePeriod(period);
  const [categories, cards, accounts, incomes, transactions, invoices, imported, people, occurrences] =
    await Promise.all([
      allReferencePages((from, to) =>
        client
          .from("categories")
          .select("id,name,type,parent_category_id", { count: "exact" })
          .eq("user_id", ownerId)
          .order("id")
          .range(from, to),
      ),
      allReferencePages((from, to) =>
        client
          .from("credit_cards")
          .select("id,name,issuer", { count: "exact" })
          .eq("user_id", ownerId)
          .order("id")
          .range(from, to),
      ),
      allReferencePages((from, to) =>
        client
          .from("accounts_payable")
          .select("id,title,amount,due_date,source_id,source_type,category_id,person_id,is_generated,archived_at,credit_card_transaction_id,credit_card_invoice_id,reimbursement_id", { count: "exact" })
          .eq("user_id", ownerId)
          .order("id")
          .range(from, to),
      ),
      allReferencePages((from, to) =>
        client
          .from("income_sources")
          .select("id,name,amount,expected_date,received_date,source_type,category_id,person_id,inflow_kind,is_generated,archived_at,linked_module,linked_record_id", { count: "exact" })
          .eq("user_id", ownerId)
          .order("id")
          .range(from, to),
      ),
      allReferencePages((from, to) =>
        client
          .from("credit_card_transactions")
          .select("id,description,transaction_date,amount,credit_card_id,invoice_id,category_id,person_id,ownership_type,is_recurring,archived_at,reimbursement_id", {
            count: "exact",
          })
          .eq("user_id", ownerId)
          .order("id")
          .range(from, to),
      ),
      allReferencePages((from, to) =>
        client
          .from("credit_card_invoices")
          .select("id,credit_card_id,due_date,total_amount", { count: "exact" })
          .eq("user_id", ownerId)
          // A purchase in the selected period can belong to a later invoice.
          // Include those existing invoices when reconciling their source IDs.
          .order("id")
          .range(from, to),
      ),
      allReferencePages((from, to) =>
        client.from("import_rows").select("mapped_data,status,target_entity_type,target_entity_id", { count: "exact" })
          .eq("user_id", ownerId).order("id").range(from, to),
      ),
      allReferencePages((from, to) => client.from("people").select("id,name", { count: "exact" }).eq("user_id", ownerId).order("id").range(from, to)),
      allReferencePages((from, to) => client.from("subscription_occurrences").select("credit_card_transaction_id", { count: "exact" }).eq("user_id", ownerId).order("id").range(from, to)),
    ]);
  const origins = (table: string, id: string) => [...new Set(imported.flatMap(row => {
    const mapped = row.mapped_data as { source?: string } | null;
    return row.target_entity_type === table && row.target_entity_id === id && mapped?.source ? [mapped.source] : [];
  }))];
  const reviewedOwnership = (table: string, id: string) => {
    const row = imported.find(item => item.target_entity_type === table && item.target_entity_id === id && item.status === "imported");
    return (row?.mapped_data as { review?: { ownership?: string } } | null)?.review?.ownership ?? null;
  };
  const createdOrigin = (table: string, id: string) => {
    const row = imported.find(item => item.target_entity_type === table && item.target_entity_id === id && item.status === "imported");
    return (row?.mapped_data as { source?: string } | null)?.source ?? null;
  };
  const sourceInstitution = (table: string, id: string) => {
    const banks = new Set(imported.flatMap(row => {
      const meta = row.mapped_data as { source?: string; institution?: string } | null;
      return row.target_entity_type === table && row.target_entity_id === id && meta?.source === "pluggy" && meta.institution ? [meta.institution] : [];
    }));
    return banks.size === 1 ? [...banks][0] : null;
  };
  return {
    ownerId,
    people,
    imported: imported.flatMap(row => {
      const mapped = row.mapped_data as { source_key?: string; source?: string; review?: { action?: string } } | null;
      return mapped?.source === "organizze" && mapped.source_key && row.target_entity_type ? [{ sourceKey: mapped.source_key, target: row.target_entity_type, id: row.target_entity_id, reviewAction: mapped.review?.action ?? null }] : [];
    }),
    categories,
    cards,
    invoices,
    movements: [
      ...accounts.map((row) => ({
        id: row.id,
        table: "accounts_payable",
        institutionId: sourceInstitution("accounts_payable", row.id),
        description: row.title,
        date: row.due_date,
        amountCents: Math.round(Number(row.amount) * 100),
        categoryId: row.category_id, personId: row.person_id, ownership: reviewedOwnership("accounts_payable", row.id), isAutomatic: row.is_generated, isArchived: !!row.archived_at,
        origins: origins("accounts_payable", row.id), createdOrigin: createdOrigin("accounts_payable", row.id), linkedTo: row.reimbursement_id ? "Reembolso" : row.credit_card_transaction_id ? "Compra de cartão" : row.credit_card_invoice_id ? "Fatura" : null,
        sourceId: row.source_id,
        sourceType: row.source_type,
      })),
      ...incomes.map((row) => ({
        id: row.id,
        table: "income_sources",
        institutionId: sourceInstitution("income_sources", row.id),
        description: row.name,
        date: row.expected_date,
        ownership: reviewedOwnership("income_sources", row.id), receivedDate: row.received_date, categoryId: row.category_id, personId: row.person_id, inflowKind: row.inflow_kind, isAutomatic: row.is_generated, isArchived: !!row.archived_at,
        origins: origins("income_sources", row.id), createdOrigin: createdOrigin("income_sources", row.id), linkedTo: row.linked_module ? `${row.linked_module} #${row.linked_record_id}` : null,
        amountCents: Math.round(Number(row.amount) * 100),
        sourceType: row.source_type,
      })),
      ...transactions.map((row) => ({
        id: row.id,
        table: "credit_card_transactions",
        institutionId: sourceInstitution("credit_card_transactions", row.id),
        description: row.description,
        date: row.transaction_date,
        amountCents: Math.round(Number(row.amount) * 100),
        cardId: row.credit_card_id, invoiceId: row.invoice_id, categoryId: row.category_id, personId: row.person_id, ownership: row.ownership_type,
        isAutomatic: row.is_recurring || occurrences.some(item => item.credit_card_transaction_id === row.id), isArchived: !!row.archived_at,
        origins: origins("credit_card_transactions", row.id), createdOrigin: createdOrigin("credit_card_transactions", row.id), linkedTo: row.reimbursement_id ? "Reembolso" : occurrences.some(item => item.credit_card_transaction_id === row.id) ? "Assinatura" : null,
      })),
    ],
  };
}
