import { normalizeDescription } from "../imports/reconciliation";
import type { HubCategory } from "../organizze/types";

export type MerchantAssociation = {
  id: string;
  updatedAt: string;
  active: boolean;
  name: string;
  categoryId: string;
  original: string;
  pattern: string | null;
  cnpj: string | null;
  merchantKey: string | null;
  mcc: string | null;
  source: "web" | "mcp";
};

const intermediaries =
  /^(?:stone|pag\s*seguro|mercado\s*pago|mercadopago|mp|pag\s*bank|sumup|cielo|rede|getnet|infinitepay)(?:\s|$)/;
const generic =
  /^(?:pix|ted|doc|pagamento|transferencia|compra|cartao|estabelecimento|debito|credito|documento)(?:\s+(?:realizado|enviado|recebido|cartao|debito|credito|documento))*$/;
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const digits = (v: unknown) =>
  typeof v === "number" || typeof v === "string" ? String(v).replace(/[.\s/-]/g, "") : "";
const object = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function normalizeMerchant(description: string) {
  const normalized = normalizeDescription(description)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const withoutCard = normalized.replace(
    /^(?:compra (?:com |no )?cartao|cartao (?:de )?(?:credito|debito)|compra (?:credito|debito))\s+/,
    "",
  );
  const storefront = /^(?:lj|loja)\s+/.test(withoutCard);
  const withoutStore = storefront
    ? withoutCard.replace(/^(?:lj|loja)\s+/, "").replace(/\s+\d{2,6}$/, "")
    : withoutCard;
  return withoutStore
    .replace(/\s+(?:lj|loja|filial)\s+\d{1,6}$/, "")
    .replace(/([a-z]{3,})\s+0\d{2,5}$/, "$1")
    .replace(/\s+(?:ltda|eireli)$/, "")
    .trim();
}

export function validCnpj(value: unknown) {
  const candidate = digits(value);
  // Receita's alphanumeric model keeps numeric check digits and ASCII weights.
  if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(candidate) || /^(.)\1+$/.test(candidate))
    return null;
  for (const length of [12, 13]) {
    const sum = Array.from(candidate.slice(0, length)).reduce((total, char, index) => {
      const weight = ((length - 1 - index) % 8) + 2;
      return total + (char.charCodeAt(0) - 48) * weight;
    }, 0);
    const check = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    if (check !== Number(candidate[length])) return null;
  }
  return candidate;
}

function code(value: unknown, size: number) {
  const candidate = digits(value);
  return new RegExp(`^\\d{${size}}$`).test(candidate) && /[1-9]/.test(candidate)
    ? candidate
    : null;
}

export function merchantMetadata(raw: Record<string, unknown>, institution: string) {
  const merchant = object(raw.merchant),
    card = object(raw.creditCardMetadata);
  const id = [merchant.id, raw.merchantId, card.merchantId].find(
    (v) => typeof v === "string" && /^[\w.-]{3,100}$/.test(v),
  );
  const address = object(merchant.address);
  const location = object(merchant.location);
  const pair = Array.isArray(location.coordinates) ? location.coordinates : [];
  const latitude = merchant.latitude ?? location.latitude ?? pair[1];
  const longitude = merchant.longitude ?? location.longitude ?? pair[0];
  return {
    original: (text(raw.descriptionRaw) || text(raw.description))
      .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[documento]")
      .slice(0, 300),
    name: text(merchant.name).slice(0, 140) || null,
    legalName: text(merchant.businessName).slice(0, 140) || null,
    cnpj: validCnpj(merchant.cnpj),
    merchantKey: id ? `${institution}:${id}` : null,
    mcc: code(card.payeeMCC, 4) ?? code(merchant.mcc, 4),
    cnae: code(merchant.cnae, 7),
    sector:
      (
        text(merchant.category) ||
        text(merchant.mccDescription) ||
        text(card.payeeMCCDescription)
      ).slice(0, 150) || null,
    city:
      (text(merchant.city) || text(address.city) || text(location.city)).slice(0, 100) ||
      null,
    address:
      (text(merchant.address) || text(address.street) || text(location.address)).slice(
        0,
        180,
      ) || null,
    coordinates: typeof latitude === "number" && typeof longitude === "number" &&
      Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null,
    hasAcquirerId: [merchant.acquirerId, raw.acquirerId, card.acquirerId].some(value => Boolean(text(value))),
    providerCategory: text(raw.category).slice(0, 150) || null,
    hasCardMetadata: Object.keys(card).length > 0,
    intermediary: [merchant.name, merchant.businessName].some((value) =>
      intermediaries.test(normalizeMerchant(text(value))),
    ),
  };
}

export type MerchantMetadata = ReturnType<typeof merchantMetadata>;
export type MerchantHistory = {
  pattern: string;
  categoryId: string | null;
  conflicts: boolean;
  count: number;
  kind: string;
};
export function indexMerchantHistory(history: MerchantHistory[]) {
  const indexed = new Map<string, MerchantHistory[]>();
  for (const row of history) {
    const key = `${row.kind}:${normalizeMerchant(row.pattern)}`;
    const existing = indexed.get(key);
    if (existing) existing.push(row);
    else indexed.set(key, [row]);
  }
  return indexed;
}
export type MerchantSuggestion = {
  status: "recognized" | "suggested" | "conflict" | "unidentified";
  confidence: "alta" | "revisão";
  name: string | null;
  categoryId: string | null;
  associationId?: string;
  reason: string;
};

const usable = (pattern: string) =>
  pattern.length >= 3 &&
  /[a-z]/.test(pattern) &&
  !generic.test(pattern) &&
  !intermediaries.test(pattern);
const conflict = (reason: string): MerchantSuggestion => ({
  status: "conflict",
  confidence: "revisão",
  name: null,
  categoryId: null,
  reason,
});

const sectors = [
  {
    mcc: ["5651", "5611", "5621", "5691"],
    cnae: ["4781"],
    category: /vestuario|roupas|moda/,
    label: "vestuário",
  },
  {
    mcc: ["5812", "5814"],
    cnae: ["5611"],
    category: /restaurante|alimentacao|lanches/,
    label: "alimentação fora de casa",
  },
  {
    mcc: ["5411"],
    cnae: ["4711"],
    category: /supermercado|mercado|compras de mercado/,
    label: "supermercados",
  },
  { mcc: ["5912"], cnae: ["4771"], category: /farmacia|medicamento/, label: "farmácias" },
];

export function recognizeMerchant(
  meta: MerchantMetadata,
  kind: string,
  associations: MerchantAssociation[],
  history: Map<string, MerchantHistory[]>,
  categories: HubCategory[],
  rule: { categoryId: string | null; ambiguous?: boolean },
): MerchantSuggestion {
  const normalized = normalizeMerchant(meta.original);
  const names = [meta.name, meta.legalName]
    .filter((v): v is string => Boolean(v))
    .map(normalizeMerchant)
    .filter(usable);
  const eligible = (id: string) =>
    categories.some((c) => c.id === id && c.type === kind && c.is_active !== false);
  const active = associations.filter((association) => association.active);
  const confirmed = active.flatMap<{ association: MerchantAssociation; evidence: string; nameOnly?: boolean }>((association) => {
    if (!meta.intermediary && meta.cnpj && association.cnpj === meta.cnpj)
      return [{ association, evidence: "CNPJ confirmado" }];
    if (
      !meta.intermediary &&
      meta.merchantKey &&
      association.merchantKey === meta.merchantKey
    )
      return [{ association, evidence: "identificador confirmado nesta instituição" }];
    if (usable(normalized) && association.pattern === normalized)
      return [{ association, evidence: "descrição normalizada confirmada" }];
    if (
      !meta.intermediary &&
      names.some((name) =>
        [normalizeMerchant(association.name), association.pattern].includes(name),
      )
    )
      return [
        { association, evidence: "nome comercial informado pela fonte", nameOnly: true },
      ];
    return [];
  });
  if (
    rule.ambiguous ||
    new Set(confirmed.map(({ association }) => association.id)).size > 1
  )
    return conflict(
      "Associações ou regras divergem. Confirme o estabelecimento e a categoria.",
    );
  const match = confirmed[0];
  if (match) {
    const { association, evidence } = match;
    if (
      (meta.cnpj && association.cnpj && meta.cnpj !== association.cnpj) ||
      (meta.merchantKey &&
        association.merchantKey?.startsWith(meta.merchantKey.split(":")[0] + ":") &&
        meta.merchantKey !== association.merchantKey) ||
      (rule.categoryId && rule.categoryId !== association.categoryId)
    )
      return conflict(
        "Os identificadores ou a categoria da regra divergem da associação.",
      );
    return {
      status: match.nameOnly ? "suggested" : "recognized",
      confidence: match.nameOnly ? "revisão" : "alta",
      name: association.name,
      categoryId: eligible(association.categoryId) ? association.categoryId : null,
      associationId: association.id,
      reason: match.nameOnly
        ? "O nome informado coincide com uma associação. Confirme a loja."
        : `Associação confirmada por ${evidence}.`,
    };
  }
  if (!usable(normalized) && !names.length)
    return {
      status: "unidentified",
      confidence: "revisão",
      name: null,
      categoryId: null,
      reason: "A descrição é genérica ou identifica um intermediário.",
    };
  const previous = history.get(`${kind}:${normalized}`) ?? [];
  const previousIds = [
    ...new Set(
      previous.map((entry) => entry.categoryId).filter((id): id is string => Boolean(id)),
    ),
  ];
  if (
    previous.some((entry) => entry.conflicts) ||
    previousIds.length > 1 ||
    (rule.categoryId && previousIds.length === 1 && previousIds[0] !== rule.categoryId)
  )
    return conflict(
      "O histórico Organizze e as regras não apontam para uma categoria única.",
    );
  const codes = sectors.filter(
    (s) =>
      (meta.mcc && s.mcc.includes(meta.mcc)) ||
      (meta.cnae && s.cnae.some((prefix) => meta.cnae!.startsWith(prefix))),
  );
  if (codes.length > 1) return conflict("MCC e CNAE apontam para ramos diferentes.");
  const sectorCategories = codes[0]
    ? categories.filter(
        (c) => eligible(c.id) && codes[0].category.test(normalizeDescription(c.name)),
      )
    : [];
  const historical = previousIds[0] && eligible(previousIds[0]) ? previousIds[0] : null;
  const sectorCategory = sectorCategories.length === 1 ? sectorCategories[0].id : null;
  if (historical && sectorCategory && historical !== sectorCategory && !rule.categoryId)
    return conflict("O ramo indicado pelo MCC/CNAE diverge da categoria histórica.");
  const categoryId = rule.categoryId ?? historical ?? sectorCategory;
  const reason = rule.categoryId
    ? "Regra de classificação existente."
    : historical
      ? `Categoria sugerida pelo histórico Organizze (${previous.reduce((count, item) => count + item.count, 0)} registros).`
      : codes[0]
        ? `MCC ou CNAE indica ${codes[0].label}. Confirme o estabelecimento.`
        : names.length
          ? "Nome informado pela fonte, aguardando confirmação."
          : "Nenhuma associação confirmada para esta descrição.";
  return {
    status: categoryId || names.length ? "suggested" : "unidentified",
    confidence: rule.categoryId ? "alta" : "revisão",
    name: names.length ? (meta.name ?? meta.legalName) : null,
    categoryId,
    reason,
  };
}

export function merchantEvidence(meta: MerchantMetadata) {
  const pattern = normalizeMerchant(meta.original);
  const cnpj = meta.intermediary ? null : meta.cnpj;
  const merchantKey = meta.intermediary ? null : meta.merchantKey;
  if (!usable(pattern) && !cnpj && !merchantKey)
    throw new Error(
      "A descrição genérica precisa de um identificador comercial confiável.",
    );
  return {
    original: meta.original,
    pattern: usable(pattern) ? pattern : null,
    cnpj,
    merchantKey,
    mcc: meta.mcc,
  };
}

export function prepareMerchantChange(
  input: Record<string, unknown>,
  data: {
    categories: HubCategory[];
    merchants: MerchantAssociation[];
    stagingPending: boolean;
    movements: {
      sourceKey: string;
      kind: string;
      review: { updatedAt?: string | null };
      merchantMetadata: MerchantMetadata;
    }[];
  },
  channel: "web" | "mcp",
) {
  const name = text(input.name);
  const categoryId = text(input.categoryId);
  const expectedUpdatedAt = text(input.expectedUpdatedAt);
  if (
    name.length < 2 ||
    name.length > 140 ||
    !usable(normalizeMerchant(name)) ||
    !Number.isFinite(Date.parse(expectedUpdatedAt)) ||
    typeof input.active !== "boolean"
  )
    throw new Error("Informe nome comercial e versão da origem.");
  const categoryValid = data.categories.some(
    (c) => c.id === categoryId && c.type === "expense" && c.is_active !== false,
  );
  const common = { name, categoryId, expectedUpdatedAt, active: input.active, channel };
  if (typeof input.id === "string") {
    const association = data.merchants.find((row) => row.id === input.id);
    if (!association || association.updatedAt !== expectedUpdatedAt)
      throw new Error("A associação mudou. Consulte a versão atual.");
    if (!categoryValid && (input.active || categoryId !== association.categoryId))
      throw new Error("Selecione uma categoria de despesa ativa.");
    return { ...common, id: association.id };
  }
  const row = data.movements.find((row) => row.sourceKey === input.sourceKey);
  if (!categoryValid) throw new Error("Selecione uma categoria de despesa ativa.");
  if (
    data.stagingPending ||
    !row ||
    row.kind !== "expense" ||
    row.review.updatedAt !== expectedUpdatedAt ||
    !row.merchantMetadata
  )
    throw new Error("A compra mudou ou aguarda atualização da Caixa de Entrada.");
  return {
    ...common,
    sourceKey: row.sourceKey,
    evidence: merchantEvidence(row.merchantMetadata),
  };
}
