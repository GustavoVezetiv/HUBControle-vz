export const bankBrands = {
  nubank: { name: "Nubank", background: "#7500b2", color: "#ffffff", accent: "#a855f7" },
  xp: { name: "XP", background: "#171717", color: "#ffffff", accent: "#ffffff" },
  sicredi: {
    name: "Sicredi",
    background: "#146e37",
    color: "#ffffff",
    accent: "#8bc34a",
  },
  caixa: { name: "Caixa", background: "#005ca9", color: "#ffffff", accent: "#f7941d" },
  mercado_pago: {
    name: "Mercado Pago",
    background: "#0065a0",
    color: "#ffffff",
    accent: "#ffe600",
  },
  will: { name: "Will Bank", background: "#ffdd00", color: "#171717", accent: "#171717" },
  itau: { name: "Itaú", background: "#c74d00", color: "#ffffff", accent: "#ffffff" },
  bradesco: {
    name: "Bradesco",
    background: "#b71935",
    color: "#ffffff",
    accent: "#ffffff",
  },
  santander: {
    name: "Santander",
    background: "#c90000",
    color: "#ffffff",
    accent: "#ffffff",
  },
  inter: { name: "Inter", background: "#c44900", color: "#ffffff", accent: "#ffffff" },
  bb: {
    name: "Banco do Brasil",
    background: "#ffdf00",
    color: "#003882",
    accent: "#003882",
  },
} as const;
export type BankId = keyof typeof bankBrands;
export function identifyBank(name?: string | null): BankId | null {
  const text = (name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_-]/g, " ");
  const matches: BankId[] = [];
  for (const [id, pattern] of Object.entries({
    nubank: /\b(nubank|nu pagamentos)\b/,
    xp: /\bxp\b|xpinvestimentos/,
    sicredi: /\bsicredi\b/,
    caixa: /\bcaixa\b/,
    mercado_pago: /mercado\s*pago/,
    will: /\bwill\b/,
    itau: /\bitau\b/,
    bradesco: /\bbradesco\b/,
    santander: /\bsantander\b/,
    inter: /\b(?:banco )?inter\b/,
    bb: /\bbanco do brasil\b/,
  })) {
    if (pattern.test(text)) matches.push(id as BankId);
  }
  return matches.length === 1 ? matches[0] : null;
}

export function matchConfidence(
  input: { bank: string; date: string; description: string; accountType?: string },
  target: {
    bank: string | null;
    date: string | null;
    description: string;
    accountType?: string | null;
  },
) {
  const sourceBank = identifyBank(input.bank),
    targetBank = identifyBank(target.bank);
  const bankMatch = sourceBank && targetBank ? sourceBank === targetBank : null;
  const sameDate = input.date === target.date;
  const normalize = (value: string) =>
    (value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ");
  const sameDescription =
    Boolean(input.description.trim()) &&
    normalize(input.description) === normalize(target.description);
  const accountMismatch = Boolean(
    input.accountType && target.accountType && input.accountType !== target.accountType,
  );
  const score =
    bankMatch === false || accountMismatch
      ? 0
      : bankMatch === true
        ? (sameDate ? 90 : 65) + (sameDescription ? 8 : 0)
        : (sameDate ? 40 : 25) + (sameDescription ? 8 : 0);
  return {
    score,
    label: score >= 85 ? "Alta" : score >= 60 ? "Média" : "Baixa",
    bankMatch,
    reason: `${bankMatch === true ? "Mesmo banco" : bankMatch === false ? "Bancos diferentes" : "Banco do registro não identificado"}; mesmo valor; ${sameDate ? "mesma data" : "data próxima"}${sameDescription ? "; descrição equivalente" : ""}${accountMismatch ? "; conta e cartão diferentes" : ""}. Confirmar vínculo.`,
  };
}
