export type Raw = Record<string, unknown>;
export type Entity = "account" | "card" | "category" | "invoice" | "transaction";
export type Period = { start: string; end: string };
export type Task = { path: string; period?: Period; page?: number };
export type PageResult = { data: Raw[]; nextPage: number | null; fetchedAt: string; warnings?: string[] };
export type SourceRecord = { task: Task; raw: Raw; role?: "payment" };
export type StagedRecord = {
  key: string;
  entity: Entity;
  sourceId: string;
  raw: Raw;
  sources: SourceRecord[];
};
export type Snapshot = {
  version: 1;
  source: "organizze";
  ownerId: string;
  period: Period;
  startedAt: string;
  records: StagedRecord[];
  tasks: Task[];
  receipts: {
    task: Task;
    count: number;
    fetchedAt: string;
    nextPage: number | null;
    ids?: string[];
  }[];
  errors: string[];
  rejected: { task: Task; raw: Raw; reason: string }[];
  unavailable?: { task: Task; code: string }[];
  warnings?: string[];
};
export type HubCategory = {
  id: string;
  name: string;
  type: string;
  parent_category_id: string | null;
};
export type HubMovement = {
  id: string;
  table: string;
  description: string;
  date: string | null;
  amountCents: number;
  cardId?: string | null;
  sourceId?: string | null;
  sourceType?: string | null;
  categoryId?: string | null;
  personId?: string | null;
  ownership?: string | null;
  invoiceId?: string | null;
  receivedDate?: string | null;
  inflowKind?: string | null;
  isAutomatic?: boolean;
  isArchived?: boolean;
  origins?: string[];
  createdOrigin?: string | null;
  linkedTo?: string | null;
  institutionId?: string | null;
};
export type References = {
  ownerId: string;
  imported?: { sourceKey: string; target: string; id: string | null; reviewAction?: string | null }[];
  people?: { id: string; name: string }[];
  categories: HubCategory[];
  cards: { id: string; name: string; issuer?: string | null }[];
  movements: HubMovement[];
  invoices: {
    id: string;
    credit_card_id: string;
    due_date: string;
    total_amount: number;
  }[];
};
export type ReviewRow = StagedRecord & {
  kind: "expense" | "income" | "transfer" | "invoice_payment" | Entity | "unknown";
  inPeriod: boolean;
  issues: string[];
  duplicateCandidates: { id: string; table: string; reason: string }[];
  internalCandidates?: string[];
  categoryCandidates: string[];
  tags: string[];
  selectable: boolean;
};
