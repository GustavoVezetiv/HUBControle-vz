import type { Period, Raw } from "../organizze/types";

export const institutions = [
  { id: "nubank", name: "Nubank", env: "PLUGGY_NUBANK_ITEM_ID" },
  { id: "xp", name: "XP Banking", env: "PLUGGY_XP_ITEM_ID" },
  { id: "sicredi", name: "Sicredi", env: "PLUGGY_SICREDI_ITEM_ID" },
  { id: "caixa", name: "Caixa Econômica Federal", env: "PLUGGY_CAIXA_ITEM_ID" },
  { id: "mercado_pago", name: "Mercado Pago", env: "PLUGGY_MERCADO_PAGO_ITEM_ID" },
] as const;
export type Institution = (typeof institutions)[number]["id"];
export type Ownership = "personal" | "third_party" | "family" | "shared";
export type InboxReview = {
  state:
    | "new"
    | "pending"
    | "historical"
    | "reconciled"
    | "own_transfer"
    | "invoice_payment";
  categoryId: string | null;
  ownership: Ownership | null;
  targetId?: string | null;
  target?: string | null;
  updatedAt?: string;
  reviewed?: boolean;
};
export type ClassificationRule = {
  id: string;
  pattern: string;
  categoryId: string;
  ownership: Ownership | null;
  active: boolean;
};
export type LedgerEntry = {
  sourceKey: string;
  review: InboxReview;
  raw: Raw;
  latest: Raw;
  linkedRaw?: Raw;
};

export type PluggySnapshot = {
  version: 1;
  source: "pluggy";
  institution: Institution;
  ownerId: string;
  itemId: string;
  period: Period;
  fetchedAt: string;
  item: Raw;
  accounts: Raw[];
  transactions: Raw[];
  bills: { accountId: string; raw: Raw }[];
  receipts: { resource: string; count: number }[];
  warnings: string[];
  complete: boolean;
  investments?: Raw[];
  investmentTransactions?: { investmentId: string; raw: Raw }[];
  unavailable?: { resource: string; code: string }[];
  previousAccountIds?: string[];
};

export type ConnectionStatus = {
  configured: boolean;
  missing: string[];
  historyAvailable: boolean;
  backupAvailable: boolean;
};
