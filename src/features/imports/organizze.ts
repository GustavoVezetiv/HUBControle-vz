import { buildInsertPayload } from "./import-engine";
import { buildOrganizzePreview } from "../organizze/preview";
import { sourceId } from "../organizze/extraction";
import type { Raw, References, Snapshot, HubMovement } from "../organizze/types";
import type { ImportTarget } from "./types";
import type { Json } from "@/lib/supabase/types";

export type OrganizzeImportRow = {
  sourceKey: string;
  target: string;
  existingId: string | null;
  values: Record<string, Json>;
  links: Record<string, string>;
  source: Snapshot["records"][number];
  tags: string[];
  reason: string | null;
  review?: { action: string; ownership: string | null; personId: string | null; confirmDifferent: boolean };
};
const norm = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const str = (value: unknown) => typeof value === "string" ? value : "";
const day = (value: unknown) => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 31 ? Number(value) : null;

/** Uses the existing import payloads and batch/row ledger. Source-only entries
 * preserve bank accounts, transfer legs and settlements without fabricating a
 * second expense/income or a new bank-account module. */
function buildBase(snapshot: Snapshot, refs: References, cardMappings: Record<string, string> = {}) {
  const preview = buildOrganizzePreview(snapshot, refs);
  if (!preview.complete) throw new Error("Conclua a extração ou retome as páginas pendentes antes de importar.");
  const all = new Map(preview.rows.map(row => [row.key, row]));
  const operations: OrganizzeImportRow[] = [];
  const usedNames = new Set(refs.categories.map(row => `${row.type}|${norm(row.name)}`));
  const depth = (key: string, seen = new Set<string>()): number => {
    if (seen.has(key)) return 10000;
    seen.add(key);
    const parent = sourceId(all.get(key)?.raw.parent_id);
    return parent ? 1 + depth(`category:${parent}`, seen) : 0;
  };
  const rank = { category: 0, account: 1, card: 2, invoice: 3, transaction: 4 };
  const sorted = [...preview.rows].sort((a, b) => rank[a.entity] - rank[b.entity] || (a.entity === "category" ? depth(a.key) - depth(b.key) : 0));
  const byKey = new Map<string, OrganizzeImportRow>();
  for (const row of sorted) {
    const raw: Raw = row.raw;
    const op: OrganizzeImportRow = { sourceKey: row.key, target: "source_only", existingId: null, values: {}, links: {}, source: row, tags: row.tags, reason: null };
    const payload = (target: ImportTarget, values: Record<string, Json>) => {
      op.target = target;
      op.values = Object.fromEntries(Object.entries(buildInsertPayload(target, snapshot.ownerId, values, true)).filter(([, value]) => value !== undefined)) as Record<string, Json>;
    };
    const cardId = sourceId(raw.credit_card_id) ?? (raw.account_type === "CreditCard" ? sourceId(raw.account_id) : null);
    if (row.entity === "category") {
      const type = ["expense", "expenses"].includes(str(raw.kind)) ? "expense" : ["income", "earnings"].includes(str(raw.kind)) ? "income" : "other";
      const parent = sourceId(raw.parent_id);
      if (parent) op.links.parent = `category:${parent}`;
      const matches = row.categoryCandidates;
      let name = str(raw.name).trim();
      if (!matches.length && usedNames.has(`${type}|${norm(name)}`)) {
        name = `${name} (Organizze ${row.sourceId})`;
      }
      if (!name || matches.length > 1 || depth(row.key) >= 10000) op.reason = "Categoria sem nome, ambígua ou circular; original preservado para revisão.";
      else {
        payload("categories", { name, type, color: /^#?[0-9a-f]{6}$/i.test(str(raw.color)) ? (str(raw.color).startsWith("#") ? str(raw.color) : `#${raw.color}`) : null, is_active: raw.archived !== true });
        op.existingId = matches[0] ?? null;
        usedNames.add(`${type}|${norm(name)}`);
      }
    } else if (row.entity === "account") {
      op.reason = "Conta bancária preservada no lote e nos vínculos de origem; não é uma conta a pagar.";
    } else if (row.entity === "card") {
      const chosen = cardMappings[row.sourceId] === "new" ? undefined : cardMappings[row.sourceId];
      if (chosen && !refs.cards.some(card => card.id === chosen)) throw new Error("Cartão escolhido não pertence ao usuário.");
      const matches = cardMappings[row.sourceId] === "new" ? [] : chosen ? refs.cards.filter(card => card.id === chosen) : refs.cards.filter(card => norm(card.name) === norm(raw.name));
      if (matches.length > 1 || !str(raw.name).trim()) op.reason = "Cartão ambíguo ou sem nome; revisar vínculo.";
      else {
        payload("credit_cards", { name: str(raw.name), issuer: str(raw.institution_name) || null, closing_day: day(raw.closing_day), due_day: day(raw.payment_day ?? raw.due_day), limit_amount: Number.isSafeInteger(raw.limit_cents) && Number(raw.limit_cents) >= 0 ? Number(raw.limit_cents) / 100 : null, is_active: raw.archived !== true, notes: `Origem Organizze #${row.sourceId}` });
        op.existingId = matches[0]?.id ?? null;
      }
    } else if (row.entity === "invoice") {
      op.links.card = `card:${row.key.split(":")[1]}`;
      const date = str(raw.date);
      // Organizze debits (including invoice totals) are negative. Hub stores
      // the positive amount owed. A positive source invoice is a credit balance,
      // not another payable; preserve it without reversing its financial meaning.
      const totalCents = -Number(raw.amount_cents);
      const card = byKey.get(op.links.card);
      const existing = refs.invoices.filter(invoice => invoice.credit_card_id === card?.existingId && invoice.due_date.slice(0, 7) === date.slice(0, 7));
      if (Number.isSafeInteger(raw.amount_cents) && Number(raw.amount_cents) > 0) op.reason = "Fatura com saldo credor preservada na origem; não criar dívida a partir de crédito.";
      else if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isSafeInteger(raw.amount_cents) || existing.length > 1 || (existing.length === 1 && (existing[0].due_date !== date))) op.reason = "Fatura sem total/data válidos ou divergente da existente; não sobrescrever.";
      else {
        const total = totalCents / 100;
        const paid = Number.isSafeInteger(raw.payment_amount_cents) ? Math.abs(Number(raw.payment_amount_cents)) / 100 : 0;
        payload("credit_card_invoices", { reference_month: `${date.slice(0, 7)}-01`, due_date: date, closing_date: str(raw.closing_date) || null, total_amount: existing[0]?.total_amount ?? total, paid_amount: paid, status: paid >= total && total > 0 ? "paid" : paid > 0 ? "partial" : "closed", notes: `Origem Organizze #${row.sourceId}` });
        op.existingId = existing[0]?.id ?? null;
      }
    } else {
      const category = sourceId(raw.category_id);
      if (category) op.links.category = `category:${category}`;
      if (sourceId(raw.account_id) && !cardId) op.links.account = `account:${raw.account_id}`;
      if (cardId) op.links.card = `card:${cardId}`;
      if (sourceId(raw.credit_card_invoice_id) && cardId) op.links.invoice = `invoice:${cardId}:${raw.credit_card_invoice_id}`;
      const paidCard = sourceId(raw.paid_credit_card_id);
      const paidInvoice = sourceId(raw.paid_credit_card_invoice_id);
      if (paidCard && paidInvoice) op.links.paidInvoice = `invoice:${paidCard}:${paidInvoice}`;
      if (row.kind === "invoice_payment" && !op.links.paidInvoice) {
        const origin = row.sources.find(source => source.role === "payment" || /\/payments$/.test(source.task.path));
        const parts = origin?.task.path.split("/");
        if (parts?.[2] && parts?.[4]) op.links.paidInvoice = `invoice:${parts[2]}:${parts[4]}`;
      }
      const oppositeAccount = sourceId(raw.oposite_account_id ?? raw.opposite_account_id);
      if (oppositeAccount) op.links.oppositeAccount = `account:${oppositeAccount}`;
      const opposite = sourceId(raw.oposite_transaction_id ?? raw.opposite_transaction_id);
      // Reciprocal transfer IDs are stored as source keys, never ordered write
      // dependencies (both legs are retained in the ledger).
      if (opposite) op.values.oppositeSourceKey = `transaction:${opposite}`;
      if (!row.inPeriod) op.reason = "Fora do período; preservado como contexto da fatura.";
      else if (["transfer", "invoice_payment"].includes(row.kind)) op.reason = row.kind === "transfer" ? "Transferência: preservar as pernas, sem despesa/receita." : "Pagamento já representado no total pago da fatura; não duplicar.";
      else if (!Number.isSafeInteger(raw.amount_cents) || !Number(raw.amount_cents) || row.kind === "unknown") op.reason = "Valor ou natureza sem representação segura; original preservado.";
      else if (cardId && Number(raw.amount_cents) > 0) op.reason = "Crédito/estorno de cartão preservado na origem; o lançamento Hub aceita apenas débitos positivos.";
      else if (row.issues.some(issue => /Versões conflitantes do campo (date|amount_cents|category_id|account_id|credit_card_id)/.test(issue))) op.reason = "Versões financeiras divergentes; original preservado para revisão.";
      else {
        const amount = Math.abs(Number(raw.amount_cents)) / 100;
        const description = str(raw.description).trim() || `Organizze #${row.sourceId}`;
        const notes = [str(raw.notes), `Origem Organizze #${row.sourceId}`].filter(Boolean).join("\n");
        if (cardId) payload("credit_card_transactions", { description, transaction_date: str(raw.date), amount, installment_number: Number.isSafeInteger(raw.installment) && Number(raw.installment) > 0 ? Number(raw.installment) : null, installment_total: Number.isSafeInteger(raw.total_installments) && Number(raw.total_installments) > 0 ? Number(raw.total_installments) : null, notes });
        else if (row.kind === "expense") payload("accounts_payable", { title: description, amount, due_date: str(raw.date), status: raw.paid === true ? "paid" : "pending", notes });
        else payload("income_sources", { name: description, amount, expected_date: str(raw.date), received_date: raw.paid === true ? str(raw.date) : null, status: raw.paid === true ? "received" : "expected", source_type: "organizze", notes });

      }
    }
    // A record missing its financial parent stays in the ledger, never acquires
    // an arbitrary account/card/invoice/category to make an insert succeed.
    if (op.target !== "source_only") for (const [relation, key] of Object.entries(op.links)) {
      const dependency = byKey.get(key);
      if (!dependency || (relation !== "account" && dependency.target === "source_only")) {
        op.target = "source_only";
        op.reason = `Vínculo de ${relation} indisponível; original preservado para revisão.`;
        break;
      }
    }
    operations.push(op);
    byKey.set(op.sourceKey, op);
  }
  return { operations, summary: { total: operations.length, create: operations.filter(row => row.target !== "source_only" && !row.existingId).length, linkExisting: operations.filter(row => row.existingId).length, sourceOnly: operations.filter(row => row.target === "source_only").length, byTarget: Object.fromEntries([...new Set(operations.map(row => row.target))].map(target => [target, operations.filter(row => row.target === target).length])) } };
}


export type Ownership = "personal" | "third_party" | "shared" | "family" | "reimbursable";
export type ReconciliationDecision = {
  action: "historical" | "new" | "link";
  ownership?: Ownership;
  personId?: string;
  inflowKind?: "real_income" | "reimbursement" | "third_party_money";
  targetId?: string;
  target?: string;
  confirmDifferent?: boolean;
};
export type ReconciliationDecisions = Record<string, ReconciliationDecision>;
export const ownershipLabels: Record<Ownership, string> = { personal: "Pessoal", third_party: "De terceiros", shared: "Compartilhada", family: "Familiar", reimbursable: "Reembolsável" };
export function movementOrigin(row: HubMovement) {
  const source = row.createdOrigin ?? (["organizze", "pluggy"].includes(row.sourceType ?? "") ? row.sourceType : null);
  return source === "organizze" ? "Organizze" : source === "pluggy" ? "Pluggy" : source || (row.isAutomatic ? "HubVZ" : "Manual");
}

/** No financial destination is created merely because it was extracted.
 * Decisions name an owned reference, or explicitly approve a new classified row.
 * The import ledger retains originals independently of financial totals. */
export function buildOrganizzeImport(snapshot: Snapshot, refs: References, cardMappings: Record<string, string> = {}, decisions: ReconciliationDecisions = {}) {
  const preview = buildOrganizzePreview(snapshot, refs);
  const base = buildBase(snapshot, refs, cardMappings);
  const drafts = new Map(base.operations.map(op => [op.sourceKey, op]));
  const reviewByKey = new Map(preview.rows.map(row => [row.key, row]));
  for (const [key, value] of Object.entries(decisions)) {
    if (reviewByKey.get(key)?.entity !== "transaction" || !value || !["historical", "new", "link"].includes(value.action)) throw new Error("Decisão de conciliação inválida.");
  }
  const operations = base.operations.map(op => ({ ...op, target: "source_only", existingId: null as string | null, values: {}, reason: op.reason ?? "Histórico Organizze: referência fora dos totais financeiros.", review: { action: "historical", ownership: null as string | null, personId: null as string | null, confirmDifferent: false } } as OrganizzeImportRow));
  const byKey = new Map(operations.map(op => [op.sourceKey, op]));
  const blocked = new Map<string, string>();
  const already = new Set<string>();
  // Already reconciled origins are immutable. Reference-only origins can later
  // be promoted after review; their original ledger ID/raw data remain intact.
  for (const op of operations) {
    const imported = refs.imported?.find(item => item.sourceKey === op.sourceKey && item.target !== "source_only");
    if (imported) { op.target = imported.target; op.existingId = imported.id; op.review!.action = "already_imported"; op.reason = "Origem já conciliada; preservar lançamento e vínculos existentes."; already.add(op.sourceKey); }
  }
  function requireStructure(key: string, seen = new Set<string>()): string | null {
    const draft = drafts.get(key); const op = byKey.get(key);
    if (!draft || !op || seen.has(key)) return "Dependência ausente ou circular.";
    if (already.has(key)) return null;
    if (draft.source.entity === "account") return null;
    if (draft.target === "source_only") return draft.reason;
    if (draft.source.entity === "card" && !draft.existingId && cardMappings[draft.source.sourceId] !== "new") return "Confirme o cartão existente ou a criação de um cartão novo.";
    seen.add(key);
    for (const relation of Object.values(draft.links)) { const error = requireStructure(relation, new Set(seen)); if (error) return error; }
    return null;
  }
  function includeStructure(key: string) {
    if (already.has(key)) return;
    const draft = drafts.get(key)!; const op = byKey.get(key)!;
    if (draft.source.entity === "account") return;
    Object.values(draft.links).forEach(includeStructure);
    Object.assign(op, { target: draft.target, existingId: draft.existingId, values: { ...draft.values }, reason: draft.existingId ? "Cadastro existente preservado; somente vínculo de origem." : null });
    op.review!.action = draft.existingId ? "link" : "dependency";
  }
  for (const row of preview.rows.filter(row => row.entity === "transaction")) {
    if (already.has(row.key)) continue;
    const op = byKey.get(row.key)!; const draft = drafts.get(row.key)!;
    const decision = decisions[row.key];
    const keptHistorical = decision?.action === "historical" || !decision && refs.imported?.some(item => item.sourceKey === row.key && item.target === "source_only" && item.reviewAction === "historical");
    op.review!.action = !keptHistorical && draft.target !== "source_only" ? "pending" : "historical";
    op.reason = keptHistorical ? "Histórico mantido por decisão explícita; fora dos totais financeiros." : draft.target !== "source_only" && ["expense", "income"].includes(row.kind) ? "Pendente de classificação: histórico fora dos totais até decisão explícita." : draft.reason;
    if (!decision || decision.action === "historical") continue;
    if (decision.action === "link") {
      const candidate = row.duplicateCandidates.find(item => item.id === decision.targetId && item.table === decision.target);
      const movement = candidate && refs.movements.find(item => item.id === candidate.id && item.table === candidate.table);
      if (!movement || !["expense", "income"].includes(row.kind) || !row.inPeriod) { blocked.set(row.key, "Correspondência inválida ou indisponível; atualize a prévia."); continue; }
      op.target = movement.table; op.existingId = movement.id;
      op.values = { amount: Math.abs(movement.amountCents) / 100, total_amount: Math.abs(movement.amountCents) / 100, due_date: movement.date, expected_date: movement.date, received_date: movement.receivedDate ?? null, transaction_date: movement.date, credit_card_id: movement.cardId ?? null, invoice_id: movement.invoiceId ?? null, ownership_type: movement.ownership ?? null, person_id: movement.personId ?? null, category_id: movement.categoryId ?? null, inflow_kind: movement.inflowKind ?? null };
      op.review = { action: "link", ownership: movement.ownership ?? null, personId: movement.personId ?? null, confirmDifferent: false };
      op.reason = "Conciliado por escolha explícita; manter ID, categoria, titularidade, fatura e reembolsos do lançamento existente.";
      continue;
    }
    let error: string | null = null;
    if (draft.target === "source_only" || !["expense", "income"].includes(row.kind)) error = draft.reason ?? "Natureza sem representação segura.";
    else if (!decision.ownership || !Object.hasOwn(ownershipLabels, decision.ownership)) error = "Confirme a titularidade deste registro; não há padrão pessoal.";
    else if (decision.personId && !refs.people?.some(person => person.id === decision.personId)) error = "Responsável não pertence ao usuário.";
    else if (decision.ownership === "reimbursable" && !decision.personId) error = "Informe o responsável pelo registro reembolsável; nenhum reembolso será criado.";
    else if (row.kind === "income" && !["real_income", "reimbursement", "third_party_money"].includes(decision.inflowKind ?? "")) error = "Confirme a natureza da entrada; recebimento não é automaticamente receita.";
    else if ((row.duplicateCandidates.length || row.internalCandidates?.length) && decision.confirmDifferent !== true) error = "Há possíveis correspondências. Vincule uma delas ou confirme explicitamente que é um lançamento diferente.";
    if (!error) for (const key of Object.values(draft.links)) { error = requireStructure(key); if (error) break; }
    if (error) { blocked.set(row.key, error); continue; }
    Object.values(draft.links).forEach(includeStructure);
    Object.assign(op, { target: draft.target, values: { ...draft.values, ownership_type: decision.ownership!, is_reimbursable: decision.ownership === "reimbursable", reimbursement_status: decision.ownership === "reimbursable" ? "pending" : "not_applicable", person_id: decision.personId || null, inflow_kind: decision.inflowKind ?? null }, reason: null });
    op.review = { action: "new", ownership: decision.ownership!, personId: decision.personId || null, confirmDifferent: decision.confirmDifferent === true };
  }
  // New invoices contain only the purchases explicitly selected as new. Full
  // historical invoice totals stay in raw_data; existing invoices are untouched.
  for (const op of operations.filter(item => item.target === "credit_card_invoices" && !item.existingId)) {
    const selected = operations.filter(item => item.target === "credit_card_transactions" && !item.existingId && item.links.invoice === op.sourceKey);
    op.values.total_amount = selected.reduce((sum, item) => sum + Math.round(Number(item.values.amount) * 100), 0) / 100;
    op.values.personal_amount = selected.filter(item => item.review?.ownership === "personal").reduce((sum, item) => sum + Math.round(Number(item.values.amount) * 100), 0) / 100;
    op.values.reimbursable_amount = selected.filter(item => item.review?.ownership === "reimbursable").reduce((sum, item) => sum + Math.round(Number(item.values.amount) * 100), 0) / 100;
    op.values.third_party_amount = selected.filter(item => ["third_party", "shared", "family"].includes(item.review?.ownership ?? "")).reduce((sum, item) => sum + Math.round(Number(item.values.amount) * 100), 0) / 100;
    op.values.paid_amount = 0; op.values.status = "open";
  }
  const reviews = preview.rows.filter(row => row.entity === "transaction").map(row => {
    const op = byKey.get(row.key)!;
    return { sourceKey: row.key, state: already.has(row.key) ? "already_imported" : blocked.has(row.key) ? "blocked" : op.existingId ? "reconciled" : op.target !== "source_only" ? "new" : op.review?.action === "historical" || drafts.get(row.key)!.target === "source_only" || !["expense", "income"].includes(row.kind) ? "historical" : "pending", reason: blocked.get(row.key) ?? op.reason, canCreate: drafts.get(row.key)!.target !== "source_only", candidates: row.duplicateCandidates, internalCandidates: row.internalCandidates ?? [] };
  });
  return { operations, reviews, blockers: [...blocked].map(([sourceKey, reason]) => ({ sourceKey, reason })), summary: { total: operations.length, create: operations.filter(row => row.target !== "source_only" && !row.existingId).length, linkExisting: operations.filter(row => row.existingId).length, sourceOnly: operations.filter(row => row.target === "source_only").length, newMovements: reviews.filter(row => row.state === "new").length, pending: reviews.filter(row => row.state === "pending").length, ambiguous: reviews.filter(row => row.candidates.length || row.internalCandidates.length).length, byTarget: Object.fromEntries([...new Set(operations.map(row => row.target))].map(target => [target, operations.filter(row => row.target === target).length])) } };
}

export type ReconciliationReview = ReturnType<typeof buildOrganizzeImport>["reviews"][number];
