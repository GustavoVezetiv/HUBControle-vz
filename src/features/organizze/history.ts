import type { Snapshot } from "./types";
import { buildOrganizzePreview } from "./preview";

// An archive projection: it neither prepares insert payloads nor contributes to totals.
export function organizzeHistory(snapshot: Snapshot) {
  const preview = buildOrganizzePreview(snapshot, {
    ownerId: snapshot.ownerId,
    categories: [],
    cards: [],
    movements: [],
    invoices: [],
  });
  const categories = snapshot.records
    .filter((row) => row.entity === "category")
    .map((row) => ({
      id: row.sourceId,
      name: String(row.raw.name ?? ""),
      parentId: row.raw.parent_id == null ? null : String(row.raw.parent_id),
      type: String(row.raw.kind ?? row.raw.type ?? ""),
    }));
  const accounts = new Map(
    snapshot.records
      .filter((row) => row.entity === "account" || row.entity === "card")
      .map((row) => [row.key, String(row.raw.name ?? row.key)]),
  );
  const movements = preview.rows
    .filter((row) => row.entity === "transaction")
    .map((row) => ({
      sourceKey: row.key,
      sourceId: row.sourceId,
      description: String(row.raw.description ?? ""),
      date: String(row.raw.date ?? ""),
      amountCents: Number(row.raw.amount_cents),
      kind: row.kind,
      accountType:
        row.raw.credit_card_id || row.raw.account_type === "CreditCard"
          ? "CREDIT"
          : "BANK",
      categoryId: row.raw.category_id == null ? null : String(row.raw.category_id),
      category:
        categories.find((category) => category.id === String(row.raw.category_id))
          ?.name ?? "Sem categoria",
      categoryPath: (() => {
        const path: string[] = [],
          seen = new Set<string>();
        let current = categories.find(
          (category) => category.id === String(row.raw.category_id),
        );
        while (current && !seen.has(current.id)) {
          seen.add(current.id);
          path.unshift(current.name);
          current = categories.find((category) => category.id === current?.parentId);
        }
        return path.join(" / ") || "Sem categoria";
      })(),
      tags: row.tags,
      account:
        accounts.get(
          `${row.raw.credit_card_id || row.raw.account_type === "CreditCard" ? "card" : "account"}:${row.raw.credit_card_id ?? row.raw.account_id}`,
        ) ?? "Sem conta/cartão correspondente",
    }));
  return {
    source: "organizze" as const,
    period: snapshot.period,
    fetchedAt: snapshot.startedAt,
    total: snapshot.records.length,
    categories,
    tags: [...new Set(movements.flatMap((row) => row.tags))].sort(),
    movements,
  };
}
export type OrganizzeHistory = ReturnType<typeof organizzeHistory>;
