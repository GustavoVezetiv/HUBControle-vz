import { pendingTask, sourceId } from "./extraction";
import { findMovementCandidates } from "../imports/reconciliation";
import type {
  HubCategory,
  Raw,
  References,
  ReviewRow,
  Snapshot,
  StagedRecord,
} from "./types";

const text = (value: unknown) => (typeof value === "string" ? value : "");
const normalized = (value: unknown) =>
  text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
const dated = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;

function kind(row: StagedRecord): ReviewRow["kind"] {
  if (row.entity !== "transaction") return row.entity;
  if (
    row.sources.some(
      (source) => source.role === "payment" || /\/payments$/.test(source.task.path),
    ) ||
    sourceId(row.raw.paid_credit_card_invoice_id) ||
    sourceId(row.raw.paid_credit_card_id)
  )
    return "invoice_payment";
  if (
    sourceId(row.raw.oposite_transaction_id) ||
    sourceId(row.raw.opposite_transaction_id) ||
    sourceId(row.raw.oposite_account_id) ||
    sourceId(row.raw.opposite_account_id) ||
    row.sources.some((source) => /^\/transfers/.test(source.task.path))
  )
    return "transfer";
  if (!Number.isSafeInteger(row.raw.amount_cents) || row.raw.amount_cents === 0)
    return "unknown";
  return Number(row.raw.amount_cents) < 0 ? "expense" : "income";
}

function tags(raw: Raw) {
  const values = Array.isArray(raw.tags)
    ? raw.tags
    : typeof raw.tags === "string" && raw.tags
      ? [raw.tags]
      : [];
  return values.flatMap((tag) =>
    typeof tag === "string"
      ? [tag]
      : tag && typeof tag === "object" && typeof tag.name === "string"
        ? [tag.name]
        : [],
  );
}

function categoryType(kind: unknown): string | null {
  // Observed Organizze values differ from the Hub enum. Translate only for
  // candidate matching; the original kind remains untouched in staging.
  if (kind === "expense" || kind === "expenses") return "expense";
  if (kind === "income" || kind === "earnings") return "income";
  return null;
}

function categoryPath(
  id: string,
  categories: Map<string, Raw>,
  seen = new Set<string>(),
): string | null {
  if (seen.has(id)) return null;
  const category = categories.get(id);
  if (!category || !text(category.name)) return null;
  seen.add(id);
  const parent = sourceId(category.parent_id);
  const ancestor = parent ? categoryPath(parent, categories, seen) : "";
  return ancestor === null
    ? null
    : [ancestor, normalized(category.name)].filter(Boolean).join(" / ");
}

function hubCategoryPath(
  category: HubCategory,
  categories: HubCategory[],
  seen = new Set<string>(),
): string | null {
  if (seen.has(category.id)) return null;
  seen.add(category.id);
  const parent = category.parent_category_id
    ? categories.find((item) => item.id === category.parent_category_id)
    : null;
  if (category.parent_category_id && !parent) return null;
  const ancestor = parent ? hubCategoryPath(parent, categories, seen) : "";
  return ancestor === null
    ? null
    : [ancestor, normalized(category.name)].filter(Boolean).join(" / ");
}

export function buildOrganizzePreview(snapshot: Snapshot, refs: References) {
  if (snapshot.ownerId !== refs.ownerId)
    throw new Error("A prévia pertence a outro usuário.");
  const categories = new Map(
    snapshot.records
      .filter((row) => row.entity === "category")
      .map((row) => [row.sourceId, row.raw]),
  );
  const transactions = new Map(
    snapshot.records
      .filter((row) => row.entity === "transaction")
      .map((row) => [row.sourceId, row]),
  );
  const cards = new Map(
    snapshot.records
      .filter((row) => row.entity === "card")
      .map((row) => [row.sourceId, row]),
  );
  const accounts = new Set(
    snapshot.records.filter((row) => row.entity === "account").map((row) => row.sourceId),
  );
  const invoices = new Set(
    snapshot.records.filter((row) => row.entity === "invoice").map((row) => row.key),
  );
  const rows: ReviewRow[] = snapshot.records.map((row) => {
    const issues: string[] = [];
    const raw = row.raw;
    const type = kind(row);
    const date = text(raw.date);
    const inPeriod =
      (row.entity !== "transaction" && row.entity !== "invoice") ||
      (dated(date) && date >= snapshot.period.start && date <= snapshot.period.end);
    const path =
      row.entity === "category" ? categoryPath(row.sourceId, categories) : null;
    const categoryCandidates =
      row.entity === "category" && path
        ? refs.categories
            .filter(
              (item) =>
                hubCategoryPath(item, refs.categories) === path &&
                item.type === categoryType(raw.kind),
            )
            .map((item) => item.id)
        : [];
    if (row.entity === "category") {
      if (!path) issues.push("Hierarquia de categoria ausente ou circular.");
      if (!categoryCandidates.length)
        issues.push(
          "Categoria nova ou sem correspondência de tipo e hierarquia; revisar.",
        );
      if (categoryCandidates.length > 1)
        issues.push("Mais de uma categoria Hub corresponde; revisar.");
    }
    if (row.entity === "account")
      issues.push(
        "Conta bancária exige definição de destino no Hub; este importador não possui módulo bancário oficial.",
      );
    if (row.entity === "card") {
      const matches = refs.cards.filter(
        (item) => normalized(item.name) === normalized(raw.name),
      );
      issues.push(
        matches.length
          ? `Revisar vínculo com cartões existentes: ${matches.map((item) => item.id).join(", ")}.`
          : "Cartão novo; revisar antes de criar.",
      );
    }
    if (row.entity === "invoice") {
      if (!dated(date)) issues.push("Data da fatura ausente ou inválida.");
      if (!Number.isSafeInteger(raw.amount_cents))
        issues.push("Total da fatura em centavos inválido.");
      const [, cardId, invoiceId] = row.key.split(":");
      const payments = [...transactions.values()].filter(
        (transaction) =>
          (String(transaction.raw.paid_credit_card_id) === cardId &&
            String(transaction.raw.paid_credit_card_invoice_id) === invoiceId) ||
          transaction.sources.some(
            (source) =>
              source.task.path ===
                `/credit_cards/${cardId}/invoices/${invoiceId}/payments` ||
              (source.role === "payment" &&
                source.task.path === `/credit_cards/${cardId}/invoices/${invoiceId}`),
          ),
      );
      if (
        Number.isSafeInteger(raw.payment_amount_cents) &&
        payments.reduce(
          (sum, payment) => sum + Math.abs(Number(payment.raw.amount_cents)),
          0,
        ) !== Math.abs(Number(raw.payment_amount_cents))
      ) {
        issues.push("Pagamentos recuperados divergem do total pago informado na fatura.");
      }
    }
    if (row.entity === "transaction") {
      if (!dated(date)) issues.push("Data ausente ou inválida.");
      if (!Number.isSafeInteger(raw.amount_cents))
        issues.push("Valor em centavos inválido.");
      if (!sourceId(raw.category_id) || !categories.has(String(raw.category_id)))
        issues.push("Categoria de origem sem correspondência.");
      const card =
        sourceId(raw.credit_card_id) ??
        (raw.account_type === "CreditCard" ? sourceId(raw.account_id) : null);
      if (card && !cards.has(card)) issues.push("Cartão de origem não localizado.");
      if (!card && (!sourceId(raw.account_id) || !accounts.has(String(raw.account_id))))
        issues.push("Conta de origem não localizada.");
      if (
        sourceId(raw.credit_card_invoice_id) &&
        (!card || !invoices.has(`invoice:${card}:${raw.credit_card_invoice_id}`))
      ) {
        issues.push("Fatura referenciada não recuperada no período.");
      }
      if (raw.tags === undefined)
        issues.push("A API não informou tags neste registro; não presumir ausência.");
      if (type === "unknown") issues.push("Natureza da movimentação exige revisão.");
      if (type === "transfer") {
        const opposite = sourceId(
          raw.oposite_transaction_id ?? raw.opposite_transaction_id,
        );
        const counterpart = opposite ? transactions.get(opposite) : null;
        if (!counterpart) issues.push("Contrapartida da transferência não recuperada.");
        else if (
          Number(counterpart.raw.amount_cents) + Number(raw.amount_cents) !== 0 ||
          counterpart.raw.date !== raw.date ||
          String(counterpart.raw.account_id) !==
            String(raw.oposite_account_id ?? raw.opposite_account_id) ||
          sourceId(
            counterpart.raw.oposite_transaction_id ??
              counterpart.raw.opposite_transaction_id,
          ) !== row.sourceId
        ) {
          issues.push("Contrapartidas da transferência inconsistentes.");
        }
      }
      if (type === "invoice_payment") {
        const paymentSource = row.sources
          .find(
            (source) => source.role === "payment" || /\/payments$/.test(source.task.path),
          )
          ?.task.path.split("/");
        const paidCard = sourceId(raw.paid_credit_card_id) ?? paymentSource?.[2];
        const paidInvoice =
          sourceId(raw.paid_credit_card_invoice_id) ?? paymentSource?.[4];
        if (!invoices.has(`invoice:${paidCard}:${paidInvoice}`))
          issues.push("Pagamento sem fatura recuperada correspondente.");
      }
    }
    for (const field of [
      "date",
      "amount_cents",
      "category_id",
      "account_id",
      "credit_card_id",
      "paid",
      "tags",
      "parent_id",
    ]) {
      const values = row.sources
        .map((source) => source.raw[field])
        .filter((value) => value !== undefined);
      if (new Set(values.map((value) => JSON.stringify(value))).size > 1)
        issues.push(`Versões conflitantes do campo ${field}; originais preservados.`);
    }
    const duplicateCandidates: ReviewRow["duplicateCandidates"] = [];
    if (row.entity === "transaction" && ["expense", "income"].includes(type)) {
      duplicateCandidates.push(...findMovementCandidates({ date, amountCents: Number(raw.amount_cents), kind: type === "income" ? "income" : "expense", description: text(raw.description) }, refs.movements));
    }
    if (row.entity === "invoice") {
      const sourceCard = cards.get(row.key.split(":")[1]);
      const matchingCards = refs.cards.filter(
        (item) => normalized(item.name) === normalized(sourceCard?.raw.name),
      );
      for (const invoice of refs.invoices) {
        if (
          matchingCards.some((item) => item.id === invoice.credit_card_id) &&
          invoice.due_date === date &&
          Math.round(invoice.total_amount * 100) === Math.abs(Number(raw.amount_cents))
        ) {
          duplicateCandidates.push({
            id: invoice.id,
            table: "credit_card_invoices",
            reason: "Mesmo cartão por nome, vencimento e total; revisar.",
          });
        }
      }
    }
    return {
      ...row,
      kind: type,
      inPeriod,
      issues,
      duplicateCandidates,
      internalCandidates: row.entity === "transaction" && ["expense", "income"].includes(type) ? [...transactions.values()].filter(other => other.key !== row.key && kind(other) === type && other.raw.amount_cents === raw.amount_cents && dated(other.raw.date) && dated(date) && Math.abs(Date.parse(other.raw.date) - Date.parse(date)) <= 7 * 86400000).map(other => other.key) : [],
      categoryCandidates,
      tags: [...new Set(row.sources.flatMap((source) => tags(source.raw)))],
      selectable: Boolean(inPeriod),
    };
  });
  const movements = rows.filter((row) => row.entity === "transaction" && row.inPeriod);
  const dates = movements
    .map((row) => text(row.raw.date))
    .filter(dated)
    .sort();
  const counts = (entity: "account" | "card") =>
    rows
      .filter((row) => row.entity === entity)
      .map((row) => ({
        id: row.sourceId,
        name: text(row.raw.name),
        count: movements.filter((movement) =>
          entity === "card"
            ? String(
                movement.raw.credit_card_id ??
                  (movement.raw.account_type === "CreditCard"
                    ? movement.raw.account_id
                    : ""),
              ) === row.sourceId
            : movement.raw.account_type !== "CreditCard" &&
              !sourceId(movement.raw.credit_card_id) &&
              String(movement.raw.account_id) === row.sourceId,
        ).length,
      }));
  return {
    rows,
    total: rows.length,
    inPeriod: rows.filter((row) => row.inPeriod).length,
    actualPeriod: { start: dates[0] ?? null, end: dates.at(-1) ?? null },
    accounts: counts("account"),
    cards: counts("card"),
    tags: [...new Set(rows.flatMap((row) => row.tags))].sort(),
    possibleDuplicates: rows.filter((row) => row.duplicateCandidates.length > 0).length,
    unmatched: rows.filter((row) => row.issues.length > 0).length,
    complete: !pendingTask(snapshot) && snapshot.errors.length === 0,
    warnings: [
      ...snapshot.errors,
      ...(snapshot.warnings ?? []),
      ...(snapshot.unavailable ?? []).map(item => `Recurso secundário indisponível (${item.code}): ${item.task.path}. Originais disponíveis preservados.`),
      "Tags refletem apenas os registros retornados, sem garantia de catálogo global.",
      "Regras internas de aprendizado não são exportadas. Titularidade, reembolsos e novas regras exigem decisão humana.",
    ],
  };
}

export function buildSelectionPlan(
  snapshot: Snapshot,
  refs: References,
  selectedKeys: string[],
) {
  const preview = buildOrganizzePreview(snapshot, refs);
  const selected = new Set(selectedKeys);
  const rows = preview.rows.filter((row) => selected.has(row.key));
  return {
    version: 1,
    source: "organizze",
    ownerId: snapshot.ownerId,
    period: snapshot.period,
    generatedAt: new Date().toISOString(),
    extractionComplete: preview.complete,
    selectedKeys: rows.map((row) => row.key),
    officialWritesAllowed: false,
    rows: rows.map((row) => {
      const dependencies = [
        ...(sourceId(row.raw.category_id) ? [`category:${row.raw.category_id}`] : []),
        ...(row.entity === "category" && sourceId(row.raw.parent_id)
          ? [`category:${row.raw.parent_id}`]
          : []),
        ...(sourceId(row.raw.credit_card_id) ? [`card:${row.raw.credit_card_id}`] : []),
        ...(row.entity === "invoice" ? [`card:${row.key.split(":")[1]}`] : []),
        ...(sourceId(row.raw.account_id)
          ? [
              `${row.raw.account_type === "CreditCard" ? "card" : "account"}:${row.raw.account_id}`,
            ]
          : []),
        ...(sourceId(row.raw.oposite_transaction_id ?? row.raw.opposite_transaction_id)
          ? [
              `transaction:${row.raw.oposite_transaction_id ?? row.raw.opposite_transaction_id}`,
            ]
          : []),
        ...(sourceId(row.raw.credit_card_invoice_id)
          ? [
              `invoice:${row.raw.credit_card_id ?? row.raw.account_id}:${row.raw.credit_card_invoice_id}`,
            ]
          : []),
        ...(sourceId(row.raw.paid_credit_card_invoice_id)
          ? [
              `invoice:${row.raw.paid_credit_card_id}:${row.raw.paid_credit_card_invoice_id}`,
            ]
          : []),
      ];
      return {
        sourceKey: row.key,
        sourceId: row.sourceId,
        kind: row.kind,
        ownership: null,
        reimbursement: null,
        dependencies,
        categoryCandidates: row.categoryCandidates,
        duplicateCandidates: row.duplicateCandidates,
        blockers: [
          ...row.issues,
          ...(!row.inPeriod ? ["Fora do período selecionado."] : []),
          ...(row.duplicateCandidates.length ? ["Resolver possível duplicata."] : []),
          ...dependencies
            .filter((key) => !selected.has(key))
            .map(
              (key) =>
                `Dependência não selecionada ou ainda sem vínculo aprovado: ${key}.`,
            ),
          ...(!preview.complete ? ["Extração incompleta."] : []),
          ...(row.entity === "transaction"
            ? ["Revisar titularidade e vínculos antes da importação."]
            : []),
        ],
      };
    }),
  };
}
