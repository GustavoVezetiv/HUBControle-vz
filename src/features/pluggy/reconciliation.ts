import { normalizeDescription } from "../imports/reconciliation";
import type { HubCategory } from "../organizze/types";
import type { OrganizzeHistory } from "../organizze/history";
import type { ClassificationRule, InboxReview } from "./types";
import type { PluggyPreview } from "./preview";

export function suggestRules(
  history: OrganizzeHistory | null,
  categories: HubCategory[],
) {
  const grouped = new Map<
    string,
    {
      pattern: string;
      category: string;
      categoryId: string | null;
      count: number;
      tags: string[];
      conflicts: boolean;
    }
  >();
  for (const row of history?.movements ?? []) {
    if (!["expense", "income"].includes(row.kind)) continue;
    const pattern = normalizeDescription(row.description);
    const historicalCategory = row.categoryPath ?? row.category;
    if (pattern.length < 3) continue;
    const matches = categories.filter(
      (category) =>
        normalizeDescription(
          (() => {
            const path: string[] = [],
              seen = new Set<string>();
            let current: HubCategory | undefined = category;
            while (current && !seen.has(current.id)) {
              seen.add(current.id);
              path.unshift(current.name);
              current = categories.find(
                (item) => item.id === current?.parent_category_id,
              );
            }
            return path.join(" / ");
          })(),
        ) === normalizeDescription(historicalCategory) && category.type === row.kind,
    );
    const found = grouped.get(pattern);
    if (found) {
      found.count++;
      found.conflicts ||= found.category !== historicalCategory;
      found.tags = [...new Set([...found.tags, ...row.tags])];
    } else
      grouped.set(pattern, {
        pattern,
        category: historicalCategory,
        categoryId: matches.length === 1 ? matches[0].id : null,
        count: 1,
        tags: row.tags,
        conflicts: false,
      });
  }
  return [...grouped.values()].sort((a, b) => b.count - a.count).slice(0, 100);
}

export function matchRules(
  description: string,
  kind: string,
  rules: ClassificationRule[],
  categories: HubCategory[],
) {
  const text = normalizeDescription(description);
  const matched = rules.filter(
    (rule) =>
      rule.active &&
      rule.pattern.length >= 3 &&
      text.includes(normalizeDescription(rule.pattern)) &&
      categories.some(
        (category) => category.id === rule.categoryId && category.type === kind,
      ),
  );
  const ids = new Set(matched.map((rule) => rule.categoryId));
  const ownerships = new Set(matched.map((rule) => rule.ownership));
  return {
    categoryId: ids.size === 1 ? matched[0].categoryId : null,
    ownership: matched.length && ownerships.size === 1 ? matched[0].ownership : null,
    ambiguous: ids.size > 1 || ownerships.size > 1,
    ruleIds: matched.map((rule) => rule.id),
  };
}

export function validateReview(
  row: PluggyPreview["movements"][number],
  input: InboxReview,
  categoryIds: string[],
) {
  if (
    !input ||
    ![
      "new",
      "pending",
      "historical",
      "reconciled",
      "own_transfer",
      "invoice_payment",
    ].includes(input.state)
  )
    throw new Error("Situação inválida.");
  if (
    input.ownership !== null &&
    !["personal", "third_party", "family", "shared"].includes(input.ownership)
  )
    throw new Error("Titularidade inválida.");
  if (input.categoryId !== null && !categoryIds.includes(input.categoryId))
    throw new Error("Categoria não pertence ao usuário.");
  if (input.state === "reconciled") {
    if (
      row.bankStatus !== "POSTED" ||
      row.kind === "invoice_payment" ||
      row.kind === "card_credit"
    )
      throw new Error("Pagamento, estorno ou pendência deve permanecer como referência.");
    if (
      !row.candidates.some(
        (candidate) =>
          candidate.id === input.targetId && candidate.table === input.target,
      )
    )
      throw new Error("Correspondência inválida; atualize a prévia.");
  } else if (input.targetId || input.target)
    throw new Error("Vínculo exige conciliação explícita.");
  return {
    state: input.state,
    categoryId: input.categoryId,
    ownership: input.ownership,
    targetId: input.state === "reconciled" ? input.targetId : null,
    target: input.state === "reconciled" ? input.target : null,
  };
}
