import { findMovementCandidates } from "../imports/reconciliation";
import type { References, Raw } from "../organizze/types";
import type { OrganizzeHistory } from "../organizze/history";
import type { PluggySnapshot } from "./types";
import { institutions } from "./types";
import { identifyBank, matchConfidence } from "../imports/bank-identity";

const str = (value: unknown) => (typeof value === "string" ? value : "");
const object = (value: unknown): Raw =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : {};
const cents = (value: unknown) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Number.isSafeInteger(Math.round(value * 100))
    ? Math.round(value * 100)
    : null;

export function buildPluggyPreview(
  snapshot: PluggySnapshot,
  refs: References,
  history: OrganizzeHistory | null,
) {
  if (refs.ownerId !== snapshot.ownerId) throw new Error("Referências de outro usuário.");
  const accounts = snapshot.accounts.map((raw) => ({
    id: str(raw.id),
    name: str(raw.name),
    type: str(raw.type),
    currency: str(raw.currencyCode),
    balance: typeof raw.balance === "number" ? raw.balance : null,
    dueDate: str(object(raw.creditData).balanceDueDate),
    fromPreviousSync: snapshot.previousAccountIds?.includes(str(raw.id)) ?? false,
    count: snapshot.transactions.filter((row) => row.accountId === raw.id).length,
  }));
  const movements = snapshot.transactions.map((raw) => {
    const account = accounts.find((account) => account.id === raw.accountId);
    const credit = object(raw.creditCardMetadata);
    const amountCents = cents(raw.amount);
    const date = str(raw.date).slice(0, 10);
    const direction = str(raw.type);
    const operationType = str(raw.operationType);
    const inPeriod =
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      date >= snapshot.period.start &&
      date <= snapshot.period.end;
    // Card credits include payments/refunds and must never become bank income.
    const kind =
      operationType === "PAGAMENTO_FATURA"
        ? "invoice_payment"
        : account?.type === "CREDIT" &&
            (direction === "CREDIT" || ["ESTORNO", "CASHBACK"].includes(operationType))
          ? "card_credit"
          : direction === "DEBIT"
            ? "expense"
            : direction === "CREDIT"
              ? "income"
              : "unknown";
    const eligible =
      amountCents !== null &&
      inPeriod &&
      raw.currencyCode === "BRL" &&
      raw.status === "POSTED" &&
      (kind === "income" || kind === "expense");
    const candidates = eligible
      ? findMovementCandidates(
          {
            date,
            amountCents,
            kind: kind as "income" | "expense",
            description: str(raw.description),
          },
          refs.movements,
        )
          .flatMap((candidate) => {
            const target = refs.movements.find(
              (row) => row.id === candidate.id && row.table === candidate.table,
            )!;
            if (target.isArchived) return [];
            const card = refs.cards.find((card) => card.id === target.cardId);
            const imported =
              refs.imported?.filter(
                (origin) => origin.target === target.table && origin.id === target.id,
              ) ?? [];
            const historicalBanks = new Set(
              imported.flatMap((origin) => {
                const source = history?.movements.find(
                  (row) => row.sourceKey === origin.sourceKey,
                );
                const bank = identifyBank(source?.account);
                return bank ? [bank] : [];
              }),
            );
            const bank =
              identifyBank(target.institutionId) ??
              identifyBank(card?.issuer) ??
              identifyBank(card?.name) ??
              (historicalBanks.size === 1 ? [...historicalBanks][0] : null);
            const targetDate =
              target.receivedDate === date ? target.receivedDate : target.date;
            const confidence = matchConfidence(
              {
                bank: snapshot.institution,
                date,
                description: str(raw.description),
                accountType: account?.type,
              },
              {
                bank,
                date: targetDate ?? null,
                description: target.description,
                accountType: card ? "CREDIT" : null,
              },
            );
            if (confidence.score === 0) return [];
            return [
              {
                ...candidate,
                bank,
                confidence,
                reason: confidence.reason,
                description: target.description,
                date: target.date,
                receivedDate: target.receivedDate ?? null,
                amount: target.amountCents / 100,
                origin:
                  target.createdOrigin ??
                  (target.sourceType === "organizze" || target.sourceType === "pluggy"
                    ? target.sourceType
                    : "manual"),
                automatic: Boolean(target.isAutomatic),
                ownership: target.ownership ?? null,
                linkedTo: target.linkedTo ?? null,
                invoiceId: target.invoiceId ?? null,
              },
            ];
          })
          .sort((a, b) => b.confidence.score - a.confidence.score)
      : [];
    const historical = eligible
      ? (history?.movements ?? [])
          .filter(
            (row) =>
              row.kind === kind &&
              Math.abs(row.amountCents) === Math.abs(amountCents!) &&
              Number.isFinite(Date.parse(row.date)) &&
              Math.abs(Date.parse(row.date) - Date.parse(date)) <= 7 * 86400000,
          )
          .map((row) => ({
            sourceKey: row.sourceKey,
            category: row.category,
            categoryPath: row.categoryPath ?? row.category,
            categoryId: row.categoryId,
            tags: row.tags,
            date: row.date,
            account: row.account,
            description: row.description ?? "",
            amount: row.amountCents / 100,
            confidence: matchConfidence(
              {
                bank: snapshot.institution,
                date,
                description: str(raw.description),
                accountType: account?.type,
              },
              {
                bank: row.account,
                date: row.date,
                description: row.description,
                accountType: row.accountType,
              },
            ),
          }))
          .filter((row) => row.confidence.score > 0)
          .sort((a, b) => b.confidence.score - a.confidence.score)
      : [];
    const reliableHistory = historical.filter((row) => row.confidence.score >= 85);
    const paths = new Set(reliableHistory.map((row) => row.categoryPath));
    const historicalPath = paths.size === 1 ? [...paths][0] : null;
    const categoryPath = (id: string) => {
      const path: string[] = [],
        seen = new Set<string>();
      let category = refs.categories.find((row) => row.id === id);
      while (category && !seen.has(category.id)) {
        seen.add(category.id);
        path.unshift(category.name);
        category = refs.categories.find((row) => row.id === category?.parent_category_id);
      }
      return path.join(" / ");
    };
    const normalize = (value: string) =>
      value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();
    const matchedCategories = historicalPath
      ? refs.categories.filter(
          (row) =>
            row.type === kind &&
            normalize(categoryPath(row.id)) === normalize(historicalPath),
        )
      : [];
    const historySuggestion = reliableHistory.length
      ? {
          category: historicalPath,
          categoryId: matchedCategories.length === 1 ? matchedCategories[0].id : null,
          tags: [...new Set(reliableHistory.flatMap((row) => row.tags))],
          ambiguous: paths.size > 1,
        }
      : null;
    const alerts: string[] = [];
    if (kind === "invoice_payment")
      alerts.push(
        "Pagamento de fatura identificado pela operação bancária; não é nova compra ou receita.",
      );
    if (["PIX", "TED", "DOC", "TEF"].includes(operationType))
      alerts.push(
        `${operationType} informado pelo banco. Não comprova transferência entre contas próprias; revisar participantes na origem.`,
      );
    if (kind === "card_credit")
      alerts.push(
        "Crédito de cartão: possível pagamento ou estorno; não é nova receita.",
      );
    if (raw.paymentData)
      alerts.push(
        "Dados de pagamento disponíveis na origem. Transferência ou pagamento exige revisão; não gera despesa/receita.",
      );
    if (!inPeriod) alerts.push("Data ausente ou fora do período: somente contexto.");
    if (raw.currencyCode !== "BRL")
      alerts.push("Moeda diferente de BRL: sem comparação automática de valores.");
    if (raw.status !== "POSTED")
      alerts.push("Movimentação não liquidada: somente prévia.");
    if (amountCents === null) alerts.push("Valor inválido: consulte o original.");
    return {
      sourceKey: `pluggy:${snapshot.itemId}:${raw.accountId}:${raw.id}`,
      id: str(raw.id),
      providerId: str(raw.providerId) || null,
      accountId: str(raw.accountId),
      account: account?.name ?? "Conta desconhecida",
      accountType: account?.type,
      date,
      description: str(raw.description),
      amount: typeof raw.amount === "number" ? raw.amount : null,
      direction,
      operationType,
      requiresPaymentReview: Boolean(raw.paymentData),
      currency: str(raw.currencyCode),
      bankStatus: str(raw.status),
      category: str(raw.category) || "Sem categoria",
      categoryId: str(raw.categoryId) || null,
      ownership: null,
      origin: "pluggy" as const,
      kind,
      invoiceId: str(credit.billId) || null,
      installment: credit.installmentNumber ?? null,
      installments: credit.totalInstallments ?? null,
      candidates,
      historical,
      historySuggestion,
      status: candidates.length
        ? "possible_match"
        : historical.length
          ? "historical_reference"
          : "pending_classification",
      alerts,
    };
  });
  const dates = movements
    .map((row) => row.date)
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  return {
    source: "pluggy",
    institution:
      institutions.find((bank) => bank.id === snapshot.institution)?.name ??
      snapshot.institution,
    institutionId: snapshot.institution,
    period: snapshot.period,
    fetchedAt: snapshot.fetchedAt,
    item: snapshot.item,
    complete: snapshot.complete,
    warnings: snapshot.warnings,
    coverage: { start: dates[0] ?? null, end: dates.at(-1) ?? null },
    accounts,
    movements,
    bills: snapshot.bills.map(({ accountId, raw }) => ({
      id: str(raw.id),
      accountId,
      dueDate: str(raw.dueDate).slice(0, 10),
      total: typeof raw.totalAmount === "number" ? raw.totalAmount : null,
      currency: str(raw.totalAmountCurrencyCode),
      payments: Array.isArray(raw.payments) ? raw.payments.length : 0,
    })),
    investments: (snapshot.investments ?? []).map((raw) => ({
      id: str(raw.id),
      name: str(raw.name),
      type: str(raw.type),
      currency: str(raw.currencyCode),
      balance: typeof raw.balance === "number" ? raw.balance : null,
      quantity: typeof raw.quantity === "number" ? raw.quantity : null,
      status: str(raw.status),
    })),
    investmentTransactions: (snapshot.investmentTransactions ?? []).map(
      ({ investmentId, raw }) => ({
        id: str(raw.id),
        investmentId,
        date: str(raw.date ?? raw.tradeDate).slice(0, 10),
        type: str(raw.type),
        amount: typeof raw.amount === "number" ? raw.amount : null,
        description: str(raw.description),
      }),
    ),
    unavailable: snapshot.unavailable ?? [],
    summary: {
      accounts: accounts.filter((row) => row.type === "BANK").length,
      cards: accounts.filter((row) => row.type === "CREDIT").length,
      transactions: movements.length,
      bills: snapshot.bills.length,
      investments: snapshot.investments?.length ?? 0,
      investmentTransactions: snapshot.investmentTransactions?.length ?? 0,
      possibleMatches: movements.filter((row) => row.candidates.length).length,
      historicalReferences: movements.filter((row) => row.historical.length).length,
      financialWrites: 0,
    },
    history: history
      ? {
          total: history.total,
          categories: history.categories.length,
          tags: history.tags,
        }
      : null,
  };
}
export type PluggyPreview = ReturnType<typeof buildPluggyPreview>;
