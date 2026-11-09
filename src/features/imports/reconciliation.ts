import type { HubMovement } from "../organizze/types";

export const normalizeDescription = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");

// Suggestions only: matching value/date never proves that two entries are the same.
export function findMovementCandidates(
  input: {
    date: string;
    amountCents: number;
    kind: "expense" | "income";
    description: string;
  },
  movements: HubMovement[],
) {
  if (
    !Number.isSafeInteger(input.amountCents) ||
    !Number.isFinite(Date.parse(input.date))
  )
    return [];
  return movements.flatMap((movement) => {
    const compatible =
      input.kind === "income"
        ? movement.table === "income_sources"
        : ["accounts_payable", "credit_card_transactions"].includes(movement.table);
    const dates = [movement.date, movement.receivedDate].filter((date): date is string =>
      Boolean(date && Number.isFinite(Date.parse(date))),
    );
    const distance = Math.min(
      ...dates.map(
        (date) => Math.abs(Date.parse(date) - Date.parse(input.date)) / 86400000,
      ),
    );
    return compatible &&
      Math.abs(movement.amountCents) === Math.abs(input.amountCents) &&
      distance <= 7
      ? [
          {
            id: movement.id,
            table: movement.table,
            reason: `Mesmo valor; ${distance === 0 ? "mesma data" : `data próxima (${distance} dias)`}; ${normalizeDescription(movement.description) === normalizeDescription(input.description) ? "descrição equivalente" : "descrição diferente"}. Confirmar vínculo.`,
          },
        ]
      : [];
  });
}
