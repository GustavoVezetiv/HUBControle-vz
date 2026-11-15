import { normalizeDescription } from "../imports/reconciliation";
import { canClassifyMovement } from "./inbox";
import { matchRules } from "./reconciliation";
import type { PluggyDashboard } from "./service";
import type { Ownership } from "./types";

// A classification rule is not reconciliation: recurring charges remain distinct.
export function previewClassificationRule(
  data: Pick<PluggyDashboard, "rules" | "categories" | "movements">,
  rule: {
    pattern: string;
    categoryId: string;
    ownership: Ownership | null;
    id?: string | null;
  },
) {
  const pattern = normalizeDescription(rule.pattern);
  const category = data.categories.find(
    (item) => item.id === rule.categoryId && ["expense", "income"].includes(item.type),
  );
  const rules = [
    ...data.rules.filter((item) => item.id !== rule.id),
    {
      id: "preview-only",
      pattern,
      categoryId: rule.categoryId,
      ownership: rule.ownership,
      active: true,
    },
  ];
  const rows =
    !category || pattern.length < 3
      ? []
      : data.movements.filter(
          (row) =>
            !row.review.reviewed &&
            canClassifyMovement(row) &&
            row.kind === category.type &&
            normalizeDescription(row.description).includes(pattern),
        );
  const conflicts = rows.filter(
    (row) => matchRules(row.description, row.kind, rules, data.categories).ambiguous,
  );
  return {
    matched: rows.length,
    conflicts: conflicts.length,
    examples: rows
      .slice(0, 3)
      .map((row) => ({
        description: row.description,
        date: row.date,
        amount: row.amount,
      })),
    existing: data.rules.some(
      (item) => item.id !== rule.id && normalizeDescription(item.pattern) === pattern,
    ),
  };
}

export function historicalRuleOptions(data: PluggyDashboard) {
  const preliminary = data.proposals.map((proposal) => {
    const preview = previewClassificationRule(data, {
      ...proposal,
      categoryId: proposal.categoryId ?? "",
      ownership: null,
    });
    return {
      ...proposal,
      preview,
      eligible:
        !proposal.conflicts &&
        proposal.count >= 2 &&
        proposal.pattern.length <= 120 &&
        data.categories.some(
          (category) =>
            category.id === proposal.categoryId && category.type === proposal.kind,
        ) &&
        !preview.existing &&
        !preview.conflicts,
    };
  });
  const combined = [
    ...data.rules,
    ...preliminary
      .filter((item) => item.eligible)
      .map((item) => ({
        id: `suggestion:${item.pattern}`,
        pattern: item.pattern,
        categoryId: item.categoryId!,
        ownership: null,
        active: true,
      })),
  ];
  const conflictingRows = data.movements.filter(
    (row) =>
      !row.review.reviewed &&
      canClassifyMovement(row) &&
      matchRules(row.description, row.kind, combined, data.categories).ambiguous,
  );
  return preliminary.map((item) => {
    const conflict = conflictingRows.some(
      (row) =>
        normalizeDescription(row.description).includes(item.pattern) &&
        row.kind === item.kind,
    );
    return { ...item, eligible: item.eligible && !conflict, combinedConflict: conflict };
  });
}
