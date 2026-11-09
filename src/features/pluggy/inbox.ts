import type { PluggyDashboard } from "./service";

export type InboxMovement = PluggyDashboard["movements"][number];
export type InboxSection = "inbox" | "reconciliation" | "pending" | "ignored";
export type InboxDisposition = {
  section: InboxSection;
  label: string;
  reason: string;
  type: string;
  automatic: boolean;
  canPrepare: boolean;
};

export function movementDisposition(row: InboxMovement): InboxDisposition {
  const result = (
    section: InboxSection,
    label: string,
    reason: string,
    type: string,
    automatic = false,
    canPrepare = false,
  ) => ({ section, label, reason, type, automatic, canPrepare });
  if (row.review.state === "reconciled")
    return result(
      "reconciliation",
      row.changedAfterLink ? "Origem alterada" : "Conciliado",
      row.changedAfterLink
        ? "Confira a mudança na origem. O vínculo existente foi preservado."
        : "Vinculado a um registro existente no Hub.",
      "Vinculado",
    );
  if (["historical", "own_transfer", "invoice_payment"].includes(row.review.state))
    return result(
      "ignored",
      "Ignorado na revisão",
      "Mantido como referência, sem novo lançamento financeiro.",
      row.review.state === "own_transfer"
        ? "Transferência própria"
        : row.review.state === "invoice_payment"
          ? "Pagamento de fatura"
          : "Referência",
    );
  if (row.review.reviewed && row.review.state === "pending")
    return result(
      "pending",
      "Revisão adiada",
      "Você manteve este item em revisão para conferir depois.",
      "Revisão manual",
    );
  if (row.bankStatus !== "POSTED")
    return result(
      "pending",
      row.bankStatus === "PENDING" ? "Aguardando liquidação" : "Revisar situação",
      "O banco ainda não confirmou a liquidação. Aguarde antes de classificar como despesa ou receita.",
      "Pendente no banco",
    );
  if (row.kind === "invoice_payment")
    return result(
      "ignored",
      "Ignorado automaticamente",
      "Pagamento de fatura não representa uma nova despesa ou receita.",
      "Pagamento de fatura",
      true,
    );
  const operation = row.operationType.toUpperCase();
  if (
    [
      "OWN_TRANSFER",
      "INTERNAL_TRANSFER",
      "PIX_INTERNO",
      "TRANSFERENCIA_ENTRE_CONTAS_PROPRIAS",
    ].includes(operation)
  )
    return result(
      "ignored",
      "Ignorado automaticamente",
      "A operação bancária identifica uma transferência interna. Confira a origem se necessário.",
      "Transferência interna",
      true,
    );
  if (
    ["ESTORNO_TECNICO", "TECHNICAL_REVERSAL", "INFORMATIONAL", "INFORMATIVO"].includes(
      operation,
    )
  )
    return result(
      "ignored",
      "Ignorado automaticamente",
      "Operação técnica ou informativa, mantida apenas como referência.",
      "Informativo",
      true,
    );
  if (/^(INVESTMENT|INVESTIMENTO|APLICACAO|RESGATE)(_|$)/.test(operation))
    return result(
      "ignored",
      "Ignorado automaticamente",
      "Aplicação ou resgate não será convertido automaticamente em despesa ou renda livre.",
      "Investimento",
      true,
    );
  if (row.kind === "card_credit" || ["ESTORNO", "CASHBACK"].includes(operation))
    return result(
      "pending",
      "Revisar crédito",
      "Pode ser pagamento, devolução ou ajuste. Confira a origem antes de criar qualquer registro.",
      "Crédito / estorno",
    );
  if (
    row.currency !== "BRL" ||
    row.amount === null ||
    !Number.isFinite(row.amount) ||
    !row.amount ||
    !/^\d{4}-\d{2}-\d{2}$/.test(row.date)
  )
    return result(
      "pending",
      "Conferir dados",
      "Confira valor, moeda e data antes de preparar um lançamento.",
      "Revisão de dados",
    );
  if (
    row.candidates.some((item) => item.confidence?.score >= 85) ||
    row.historical.some((item) => item.confidence?.score >= 85)
  )
    return result(
      "reconciliation",
      "Possível correspondência",
      "Mesmo banco, valor e data: compare os registros e confirme a natureza da operação antes de vincular.",
      row.kind === "income" ? "Receita / crédito" : "Compra / despesa",
    );
  if (
    ["PIX", "TED", "DOC", "TEF", "TRANSFER"].includes(operation) ||
    (row.requiresPaymentReview &&
      !(
        row.kind === "income" &&
        ["PORTABILIDADE_SALARIO", "SALARIO", "RECEBIMENTO_SALARIO"].includes(operation)
      )) ||
    /pagamento (?:de )?fatura|transferencia (?:entre contas|interna)|pix interno/i.test(
      row.description.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
    )
  )
    return result(
      "pending",
      "Revisão necessária",
      "Confirme se é despesa, receita ou transferência própria. PIX/TED não comprova titularidade.",
      "Transferência / pagamento",
    );
  if (!["expense", "income"].includes(row.kind))
    return result(
      "pending",
      "Identificar operação",
      "O tipo informado não permite preparar uma despesa ou receita com segurança.",
      "Não identificado",
    );
  const type = row.kind === "income" ? "Receita / crédito" : "Compra / despesa";
  if (
    row.candidates.length ||
    row.historical.some((item) => item.confidence?.score >= 85)
  )
    return result(
      "reconciliation",
      "Possível correspondência",
      "Compare com o registro existente antes de preparar um novo lançamento.",
      type,
    );
  return result(
    "inbox",
    row.classification.ambiguous
      ? "Regras conflitantes"
      : !row.selectedCategoryId || !row.selectedOwnership
        ? "Classificação pendente"
        : "Classificado",
    row.classification.ambiguous
      ? "Revise as regras que atribuem classificações diferentes."
      : "Disponível para revisão. A importação financeira ainda não foi aplicada.",
    type,
    false,
    true,
  );
}

export function inboxSummary(rows: InboxMovement[]) {
  return rows.reduce(
    (counts, row) => {
      const item = movementDisposition(row);
      counts[item.section]++;
      if (item.automatic) counts.automatic++;
      if (item.canPrepare && !row.review.reviewed) counts.new++;
      if (
        (item.canPrepare || item.section === "reconciliation") &&
        row.review.state !== "reconciled" &&
        (!row.selectedCategoryId ||
          !row.selectedOwnership ||
          row.classification.ambiguous)
      )
        counts.classification++;
      if (item.section === "reconciliation" && row.review.state !== "reconciled")
        counts.matches++;
      return counts;
    },
    {
      inbox: 0,
      reconciliation: 0,
      pending: 0,
      ignored: 0,
      automatic: 0,
      new: 0,
      classification: 0,
      matches: 0,
    },
  );
}

export type InboxCompositionKey = "expense" | "income" | "card" | "review";
export function inboxComposition(rows: InboxMovement[]) {
  const counts = {
    expense: 0,
    income: 0,
    card: 0,
    review: 0,
    ignored: 0,
    linked: 0,
    total: 0,
  };
  for (const row of rows) {
    if (row.review.state === "reconciled") {
      counts.linked++;
      continue;
    }
    if (movementDisposition(row).section === "ignored") {
      counts.ignored++;
      continue;
    }
    const group =
      row.accountType === "CREDIT" && row.direction === "DEBIT"
        ? "card"
        : row.accountType === "BANK" && row.direction === "DEBIT"
          ? "expense"
          : row.accountType === "BANK" && row.direction === "CREDIT"
            ? "income"
            : "review";
    counts[group]++;
    counts.total++;
  }
  return counts;
}

export function inboxPeriodFromParams(
  params: Record<string, string | string[] | undefined>,
) {
  if (!("from" in params) || !("to" in params)) return undefined;
  const from = params.from,
    to = params.to;
  const valid = (value: unknown): value is string =>
    typeof value === "string" &&
    (value === "" ||
      (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(value)) &&
        new Date(value).toISOString().slice(0, 10) === value));
  return valid(from) && valid(to) && (!from || !to || from <= to)
    ? { start: from, end: to }
    : undefined;
}

// Confidence is a comparison aid, never permission to link automatically.
export function candidateConfidence(
  row: InboxMovement,
  candidate: InboxMovement["candidates"][number],
) {
  if (candidate.confidence) return candidate.confidence.label;
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ");
  const sameDescription = normalize(row.description) === normalize(candidate.description);
  const sameDate = row.date === candidate.date || row.date === candidate.receivedDate;
  return sameDescription && sameDate
    ? "Alta"
    : sameDescription || sameDate
      ? "Média"
      : "Baixa";
}
