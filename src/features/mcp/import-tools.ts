import { randomUUID } from "node:crypto";
import type { AppSupabaseClient } from "@/features/shared/types";
import type { Json } from "@/lib/supabase/types";
import type { McpTool } from "./tools";
import {
  confirmMcpImportReview,
  createMcpActionRequest,
  getMcpActionRequest,
} from "./admin";
import { signMcpIntent, verifyMcpIntent } from "./security";
import { pluggyConfig } from "../pluggy/config";
import { pluggyDashboard } from "../pluggy/service";
import { validateReview } from "../pluggy/reconciliation";
import { lastSyncReport } from "../pluggy/sync-report";
import { institutions, type InboxReview } from "../pluggy/types";
import { latestOrganizzeBackup } from "../organizze/backup";
import { organizzeHistory } from "../organizze/history";
import { loadOrganizzeReferences } from "../organizze/references";
import { buildOrganizzePreview } from "../organizze/preview";
import { buildOrganizzeImport, type ReconciliationDecision } from "../imports/organizze";
import { identifyBank } from "../imports/bank-identity";
import { prepareMerchantChange } from "../pluggy/merchants";

type Args = Record<string, unknown>;
type Context = { client: AppSupabaseClient; userId: string };
const prepareName = "hub_prepare_import_reviews";
const confirmName = "hub_confirm_import_reviews";
const refreshName = "hub_refresh_import_inbox";
const approval = "CONFIRMO CONCILIAR";
const ownerships = ["personal", "third_party", "shared", "family"] as const;
const inflowKinds = ["real_income", "third_party_money", "reimbursement"];
const states = [
  "new",
  "pending",
  "reconciled",
  "historical",
  "own_transfer",
  "invoice_payment",
  "imported",
];
const actions = [
  "classify",
  "pending",
  "ignore",
  "link",
  "create",
  "own_transfer",
  "invoice_payment",
  "remember_merchant",
  "edit_merchant",
  "disable_merchant",
];
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const string = { type: "string" };
const uuid = { type: "string", format: "uuid" };
const date = { type: "string", format: "date" };
const choices = (values: readonly string[]) => ({ type: "string", enum: values });
const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] });
const paging = {
  limit: { type: "integer", minimum: 1, maximum: 50 },
  offset: { type: "integer", minimum: 0, maximum: 200000 },
};
const itemSchema = object(
  {
    sourceKey: string,
    action: choices(actions),
    expectedUpdatedAt: nullable(string),
    categoryId: nullable(uuid),
    ownership: nullable(choices(ownerships)),
    target: choices(["accounts_payable", "income_sources", "credit_card_transactions"]),
    targetId: uuid,
    creditCardId: uuid,
    invoiceId: uuid,
    merchantName: string,
    merchantActive: { type: "boolean" },
    inflowKind: choices(inflowKinds),
    confirmOrdinaryMovement: {
      type: "boolean",
      description:
        "Confirme a natureza indicada só após verificar que não é transferência própria, liquidação de fatura ou investimento.",
    },
  },
  ["sourceKey", "action", "expectedUpdatedAt"],
);
const tool = (
  name: string,
  description: string,
  inputSchema = object({}),
  read = true,
): McpTool => ({
  name,
  description,
  inputSchema,
  securitySchemes: [
    { type: "oauth2", scopes: read ? ["mcp:read"] : ["mcp:read", "mcp:write"] },
  ],
  annotations: {
    readOnlyHint: read,
    destructiveHint: false,
    idempotentHint: name !== prepareName,
  },
});
export const importTools = [
  tool(
    "hub_get_import_connections",
    "Estado e cobertura das cinco conexões Meu Pluggy e do histórico Organizze. Consulta os backups existentes.",
  ),
  tool(
    "hub_list_import_movements",
    "Lista movimentações de origem na Caixa de Entrada. Use sourceKey e expectedUpdatedAt para preparar revisões.",
    object({
      source: choices(["pluggy", "organizze"]),
      institution: choices(institutions.map((bank) => bank.id)),
      account: string,
      card: string,
      start: date,
      end: date,
      status: choices(states),
      ownership: nullable(choices(ownerships)),
      search: string,
      merchantStatus: choices([
        "recognized",
        "suggested",
        "conflict",
        "unidentified",
        "needs_review",
      ]),
      ...paging,
    }),
  ),
  tool(
    "hub_get_import_movement",
    "Detalha a movimentação, categorias, referências do Organizze e possíveis correspondências com justificativas.",
    object({ sourceKey: string }, ["sourceKey"]),
  ),
  tool(
    "hub_list_import_rules",
    "Consulta regras, sugestões Organizze e estabelecimentos conhecidos. Use sourceKey e updatedAt da associação para editar ou desativar.",
    object({ ...paging, search: string }),
  ),
  tool(
    refreshName,
    "Atualiza a Caixa de Entrada a partir dos backups Pluggy já coletados. Apenas preserva origens, sem acessar o banco nem criar lançamentos financeiros.",
    object({}),
    false,
  ),
  tool(
    prepareName,
    "Prepara revisões selecionadas. Para aprendizado use remember_merchant com a compra, merchantName e categoryId. Para corrigir ou desativar use a chave merchant:ID e sua versão na ação edit_merchant ou disable_merchant. Apresente a proposta antes de pedir aprovação.",
    object(
      {
        items: { type: "array", minItems: 1, maxItems: 20, items: itemSchema },
        cardMappings: {
          type: "object",
          additionalProperties: uuid,
          description:
            "Mapa opcional dos IDs de cartão Organizze para IDs de cartões existentes do Hub.",
        },
      },
      ["items"],
    ),
    false,
  ),
  tool(
    confirmName,
    "Executa a proposta exata somente depois da aprovação explícita do usuário. Repetir o mesmo confirmationId devolve o resultado salvo. Nunca executa pagamentos bancários.",
    object({ confirmationId: uuid, confirmationText: choices([approval]) }, [
      "confirmationId",
      "confirmationText",
    ]),
    false,
  ),
];
export const isImportTool = (name: string) =>
  importTools.some((tool) => tool.name === name);

function valid(value: unknown, schema: Record<string, unknown>): boolean {
  if (Array.isArray(schema.anyOf))
    return schema.anyOf.some((option) => valid(value, option));
  if (Array.isArray(schema.enum)) return schema.enum.includes(value);
  if (schema.type === "null") return value === null;
  if (schema.type === "integer")
    return (
      Number.isInteger(value) &&
      Number(value) >= Number(schema.minimum) &&
      Number(value) <= Number(schema.maximum)
    );
  if (schema.type === "boolean") return typeof value === "boolean";
  if (schema.type === "string") {
    if (typeof value !== "string" || !value.trim() || value.length > 300) return false;
    if (schema.format === "uuid")
      return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
    if (schema.format === "date")
      return (
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(value)) &&
        new Date(value).toISOString().slice(0, 10) === value
      );
    return true;
  }
  if (schema.type === "array")
    return (
      Array.isArray(value) &&
      value.length >= Number(schema.minItems) &&
      value.length <= Number(schema.maxItems) &&
      value.every((item) => valid(item, schema.items as Args))
    );
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const props = (schema.properties ?? {}) as Record<string, Args>;
  const entries = Object.entries(value);
  return (
    entries.length <= 20 &&
    ((schema.required ?? []) as string[]).every((key) => Object.hasOwn(value, key)) &&
    entries.every(([key, item]) => {
      if (Object.hasOwn(props, key)) return valid(item, props[key]);
      return (
        typeof schema.additionalProperties === "object" &&
        schema.additionalProperties !== null &&
        /^[1-9]\d*$/.test(key) &&
        valid(item, schema.additionalProperties as Args)
      );
    })
  );
}

const sourceOf = (key: string) =>
  /^transaction:[1-9]\d*$/.test(key)
    ? "organizze"
    : /^pluggy:(?:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(?::|$)){3}$/i.test(key) &&
        !key.endsWith(":")
      ? "pluggy"
      : /^merchant:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(key)
        ? "merchant"
        : null;
type Selection = {
  sourceKey: string;
  action: (typeof actions)[number];
  expectedUpdatedAt: string | null;
  categoryId?: string | null;
  ownership?: (typeof ownerships)[number] | null;
  target?: string;
  targetId?: string;
  creditCardId?: string;
  invoiceId?: string;
  merchantName?: string;
  merchantActive?: boolean;
  inflowKind?: ReconciliationDecision["inflowKind"];
  confirmOrdinaryMovement?: boolean;
};
export function validateImportTool(name: string, value: unknown) {
  const schema = importTools.find((t) => t.name === name)?.inputSchema;
  if (!schema || !valid(value, schema))
    throw new Error("Argumentos da conciliação inválidos.");
  const args = value as Args;
  if (
    typeof args.start === "string" &&
    typeof args.end === "string" &&
    args.start > args.end
  )
    throw new Error("Período invertido.");
  if (args.sourceKey && !sourceOf(String(args.sourceKey)))
    throw new Error("Origem inválida.");
  if (name === prepareName) {
    const items = args.items as Selection[];
    if (
      new Set(items.map((item) => item.sourceKey)).size !== items.length ||
      items.some(
        (item) =>
          !sourceOf(item.sourceKey) ||
          (item.expectedUpdatedAt !== null &&
            !Number.isFinite(Date.parse(item.expectedUpdatedAt))),
      )
    )
      throw new Error("Selecione origens distintas e suas versões de leitura.");
  }
  return args;
}

async function sources(ctx: Context, opts: { pluggy: boolean; organizze: boolean }) {
  const { client, userId } = ctx;
  const pluggyOwner = pluggyConfig().ownerId === userId;
  const organizzeOwner = process.env.ORGANIZZE_HUB_USER_ID === userId;
  if ((!opts.pluggy || !pluggyOwner) && (!opts.organizze || !organizzeOwner))
    throw new Error("Integração indisponível para este usuário.");
  const [pluggy, backup] = await Promise.all([
    opts.pluggy && pluggyOwner ? pluggyDashboard(client, userId) : null,
    opts.organizze && organizzeOwner ? latestOrganizzeBackup(userId) : null,
  ]);
  const refs = backup
    ? await loadOrganizzeReferences(client, userId, backup.snapshot.period)
    : null;
  return { pluggy, backup, refs };
}

function historyMovements(data: Awaited<ReturnType<typeof sources>>) {
  const { backup, refs } = data;
  if (!backup || !refs) return [];
  const snapshot = backup.snapshot;
  const preview = new Map(
    buildOrganizzePreview(snapshot, refs).rows.map((row) => [row.key, row]),
  );
  const ledger = new Map(refs.imported?.map((row) => [row.sourceKey, row]));
  return organizzeHistory(snapshot).movements.map((row) => {
    const staged = ledger.get(row.sourceKey);
    const detail = preview.get(row.sourceKey);
    const target =
      staged &&
      refs.movements.find((m) => m.id === staged.id && m.table === staged.target);
    const categoryCandidates =
      preview.get(`category:${row.categoryId}`)?.categoryCandidates ?? [];
    return {
      ...row,
      origin: "organizze" as const,
      bank: row.account,
      amount: row.amountCents / 100,
      expectedUpdatedAt: staged?.updatedAt ?? null,
      ownership: target?.ownership ?? staged?.ownership ?? null,
      status:
        staged && staged.target !== "source_only"
          ? "reconciled"
          : staged?.reviewAction === "pending"
            ? "pending"
            : "historical",
      targetId: staged?.target !== "source_only" ? (staged?.id ?? null) : null,
      selectedCategoryId: staged?.categoryId ?? null,
      suggestedCategoryId: categoryCandidates.length === 1 ? categoryCandidates[0] : null,
      categoryCandidates,
      candidates: detail?.duplicateCandidates ?? [],
      internalCandidates: detail?.internalCandidates ?? [],
      alerts: detail?.issues ?? [],
    };
  });
}

export async function runImportRead(name: string, args: Args, ctx: Context) {
  const requested = args.source ?? (args.sourceKey && sourceOf(String(args.sourceKey)));
  const data = await sources(ctx, {
    pluggy: requested !== "organizze",
    organizze: requested !== "pluggy" && requested !== "merchant",
  });
  if (name === "hub_get_import_connections") {
    const history = data.backup && organizzeHistory(data.backup.snapshot);
    const ready = history ? await ctx.client.rpc("organizze_reconciliation_ready") : null;
    const sync = data.pluggy
      ? await lastSyncReport(ctx.userId).catch(() => ({
          error: "Relatório privado indisponível.",
        }))
      : null;
    return {
      banks: data.pluggy?.banks ?? [],
      lastSync: sync,
      stagingPending: data.pluggy?.stagingPending ?? null,
      pluggyReviewReady: data.pluggy?.ready ?? false,
      organizze: history
        ? {
            backupId: data.backup?.backupId,
            records: history.total,
            movements: history.movements.length,
            categories: history.categories.length,
            tags: history.tags.length,
            period: history.period,
            fetchedAt: history.fetchedAt,
            reviewReady: ready?.data === true,
          }
        : null,
    };
  }
  const offset = Number(args.offset ?? 0),
    limit = Number(args.limit ?? 20);
  if (name === "hub_list_import_rules") {
    const rules = data.pluggy?.rules ?? [];
    const proposals = data.pluggy?.proposals ?? [];
    const search = typeof args.search === "string" ? args.search.toLowerCase() : "";
    const merchants = (data.pluggy?.merchants ?? []).filter(
      (row) =>
        !search || `${row.name} ${row.pattern ?? ""}`.toLowerCase().includes(search),
    );
    return {
      rules: rules.slice(offset, offset + limit),
      proposals: proposals.slice(offset, offset + limit),
      merchants: merchants
        .slice(offset, offset + limit)
        .map(({ cnpj, merchantKey, ...row }) => ({
          ...row,
          sourceKey: `merchant:${row.id}`,
          hasVerifiedCnpj: !!cnpj,
          hasMerchantId: !!merchantKey,
        })),
      totals: {
        rules: rules.length,
        proposals: proposals.length,
        merchants: merchants.length,
      },
      offset,
      limit,
    };
  }
  const movements = [
    ...(data.pluggy?.movements ?? []).map((row) => ({
      ...row,
      status: row.review.state,
      ownership: row.review.reviewed ? row.review.ownership : null,
      expectedUpdatedAt: row.review.updatedAt ?? null,
      suggestedCategoryId: row.merchant
        ? row.merchant.categoryId
        : (row.classification.categoryId ?? row.historySuggestion?.categoryId ?? null),
    })),
    ...historyMovements(data),
  ];
  const query = (value: unknown) =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  if (name === "hub_get_import_movement") {
    const row = movements.find((row) => row.sourceKey === args.sourceKey);
    if (!row) throw new Error("Movimentação indisponível.");
    if (row.origin !== "pluggy" || !row.merchantMetadata) return row;
    const { merchantKey, ...metadata } = row.merchantMetadata;
    return {
      ...row,
      merchantMetadata: { ...metadata, hasMerchantId: Boolean(merchantKey) },
    };
  }
  const filtered = movements
    .filter((row) => {
      if (
        args.merchantStatus &&
        (row.origin !== "pluggy" ||
          !row.merchant ||
          (args.merchantStatus === "needs_review"
            ? row.merchant.status === "recognized"
            : row.merchant.status !== args.merchantStatus))
      )
        return false;
      if (
        (args.status && row.status !== args.status) ||
        (Object.hasOwn(args, "ownership") && row.ownership !== args.ownership)
      )
        return false;
      if (
        (args.start && row.date < String(args.start)) ||
        (args.end && row.date > String(args.end))
      )
        return false;
      if (
        args.institution &&
        (row.origin === "pluggy" ? row.institutionId : identifyBank(row.bank)) !==
          args.institution
      )
        return false;
      if (args.account && !query(row.account).includes(query(args.account))) return false;
      if (
        args.card &&
        (row.accountType !== "CREDIT" || !query(row.account).includes(query(args.card)))
      )
        return false;
      return (
        !args.search ||
        query(
          `${row.description} ${row.category} ${row.origin === "pluggy" ? (row.merchant?.name ?? "") : ""}`,
        ).includes(query(args.search))
      );
    })
    .sort(
      (a, b) => b.date.localeCompare(a.date) || a.sourceKey.localeCompare(b.sourceKey),
    );
  return {
    total: filtered.length,
    offset,
    limit,
    items: filtered.slice(offset, offset + limit).map((row) => ({
      sourceKey: row.sourceKey,
      origin: row.origin,
      bank: row.bank,
      account: row.account,
      accountType: row.accountType,
      date: row.date,
      description: row.description,
      amount: row.amount,
      status: row.status,
      ownership: row.ownership,
      expectedUpdatedAt: row.expectedUpdatedAt,
      category: row.category,
      suggestedCategoryId: row.suggestedCategoryId,
      possibleMatches: row.candidates.length,
      merchant: row.origin === "pluggy" ? row.merchant : null,
    })),
  };
}

function secret() {
  const key = process.env.MCP_CONFIRMATION_SECRET?.trim();
  if (!key || key.length < 32)
    throw new Error("Confirmações de conciliação não configuradas no servidor.");
  return key;
}

export async function runImportWrite(name: string, args: Args, ctx: Context) {
  const { userId, client } = ctx;
  if (name === refreshName) {
    if (pluggyConfig().ownerId !== userId)
      throw new Error("Integração indisponível para este usuário.");
    const dashboard = await pluggyDashboard(client, userId, true);
    return {
      ready: dashboard.ready,
      stagingPending: dashboard.stagingPending,
      persisted: dashboard.movements.filter((row) => row.review.updatedAt).length,
      financialWrites: 0,
    };
  }
  const key = secret();
  if (name === confirmName) {
    if (args.confirmationText !== approval)
      throw new Error("A aprovação explícita do usuário é obrigatória.");
    const id = String(args.confirmationId);
    const { data: proposal, error } = await getMcpActionRequest(userId, id);
    if (
      error ||
      !proposal ||
      proposal.tool_name !== prepareName ||
      !verifyMcpIntent(
        {
          id,
          userId,
          toolName: prepareName,
          arguments: proposal.arguments as Args,
          expiresAt: proposal.expires_at,
        },
        proposal.intent_signature,
        key,
      )
    )
      throw new Error("Proposta inválida ou de outro proprietário.");
    const { items, organizzeBackupId } = proposal.arguments as {
      items: { source: string }[];
      organizzeBackupId?: string;
    };
    if (
      items.some((item) =>
        item.source === "pluggy" || item.source === "merchant"
          ? pluggyConfig().ownerId !== userId
          : process.env.ORGANIZZE_HUB_USER_ID !== userId,
      )
    )
      throw new Error("Proprietário da integração alterado.");
    if (
      proposal.status === "pending" &&
      items.some((item) => item.source === "pluggy" || item.source === "merchant")
    ) {
      const dashboard = await pluggyDashboard(client, userId);
      if (dashboard.stagingPending)
        throw new Error(
          "Há dados novos aguardando atualização da Caixa de Entrada. Atualize a entrada e prepare outra proposta.",
        );
    }
    if (
      proposal.status === "pending" &&
      organizzeBackupId &&
      (await latestOrganizzeBackup(userId))?.backupId !== organizzeBackupId
    ) {
      throw new Error(
        "O backup Organizze mudou. Consulte novamente e prepare outra proposta.",
      );
    }
    const result = await confirmMcpImportReview(userId, id, proposal.intent_signature);
    if (result.error)
      throw new Error(
        "Não foi possível confirmar. Consulte a proposta ou repita o mesmo ID. Confira a migration e a validade.",
      );
    return result.data;
  }
  const selections = args.items as Selection[];
  const data = await sources(ctx, {
    pluggy: selections.some((item) => sourceOf(item.sourceKey) !== "organizze"),
    organizze: selections.some((item) => sourceOf(item.sourceKey) === "organizze"),
  });
  const history = new Map(historyMovements(data).map((row) => [row.sourceKey, row]));
  const operations = [];
  const review = [];
  for (const item of selections) {
    try {
      const source = sourceOf(item.sourceKey);
      if (
        source === "merchant" ||
        ["remember_merchant", "edit_merchant", "disable_merchant"].includes(item.action)
      ) {
        if (
          !data.pluggy?.ready ||
          (item.action === "remember_merchant"
            ? source !== "pluggy"
            : source !== "merchant" ||
              !["edit_merchant", "disable_merchant"].includes(item.action))
        )
          throw new Error(
            "Use uma compra Pluggy para reconhecer ou uma associação para editar.",
          );
        const existing = data.pluggy.merchants.find(
          (row) => `merchant:${row.id}` === item.sourceKey,
        );
        const change = prepareMerchantChange(
          {
            id: existing?.id,
            sourceKey: item.sourceKey,
            expectedUpdatedAt: item.expectedUpdatedAt,
            name: item.merchantName ?? existing?.name,
            categoryId: item.categoryId ?? existing?.categoryId,
            active:
              item.action === "disable_merchant"
                ? false
                : (item.merchantActive ?? existing?.active ?? true),
          },
          data.pluggy,
          "mcp",
        );
        operations.push({
          source: "merchant",
          sourceKey: item.sourceKey,
          merchant: change,
        });
        review.push({
          sourceKey: item.sourceKey,
          action: item.action,
          name: change.name,
          categoryId: change.categoryId,
          active: change.active,
          original: "evidence" in change ? change.evidence.original : existing?.original,
          financialWrites: 0,
        });
        continue;
      }
      const prepared =
        source === "pluggy"
          ? await preparePluggy(item, data, ctx)
          : await prepareOrganizze(
              item,
              data,
              history,
              (args.cardMappings ?? {}) as Record<string, string>,
              ctx,
            );
      operations.push(prepared.operation);
      review.push(prepared.review);
    } catch (error) {
      review.push({
        sourceKey: item.sourceKey,
        error: error instanceof Error ? error.message : "Falha na preparação.",
      });
    }
  }
  if (operations.length !== selections.length)
    return {
      items: review,
      confirmationId: null,
      message:
        "Corrija os itens com erro ou selecione somente os itens desejados para preparar outra proposta.",
    };
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const payload = JSON.parse(
    JSON.stringify({
      items: operations,
      organizzeBackupId: data.backup?.backupId ?? null,
    }),
  ) as Args;
  const signature = signMcpIntent(
    { id, userId, toolName: prepareName, arguments: payload, expiresAt },
    key,
  );
  await createMcpActionRequest({
    id,
    user_id: userId,
    tool_name: prepareName,
    arguments: payload as Json,
    expires_at: expiresAt,
    intent_signature: signature,
  });
  return { confirmationId: id, expiresAt, confirmationText: approval, items: review };
}

async function preparePluggy(
  item: Selection,
  data: Awaited<ReturnType<typeof sources>>,
  { client, userId }: Context,
) {
  const dashboard = data.pluggy;
  const row = dashboard?.movements.find((row) => row.sourceKey === item.sourceKey);
  if (
    !row ||
    !dashboard?.ready ||
    dashboard.stagingPending ||
    !row.review.updatedAt ||
    row.review.updatedAt !== item.expectedUpdatedAt
  )
    throw new Error(
      "Origem Pluggy indisponível ou versão desatualizada. Atualize a Caixa de Entrada.",
    );
  if (row.review.targetId)
    throw new Error("Origem já vinculada a um lançamento financeiro.");
  const categoryId =
    item.categoryId === undefined
      ? row.review.reviewed
        ? row.review.categoryId
        : null
      : item.categoryId;
  const ownership =
    item.ownership === undefined
      ? row.review.reviewed
        ? row.review.ownership
        : null
      : item.ownership;
  const categoryIds = dashboard.categories
    .filter((category) => category.type === row.kind)
    .map((category) => category.id);
  const state = {
    classify: "pending",
    pending: "pending",
    ignore: "historical",
    link: "reconciled",
    create: "pending",
    own_transfer: "own_transfer",
    invoice_payment: "invoice_payment",
  }[item.action] as InboxReview["state"];
  if (
    state === "reconciled" &&
    !row.candidates.some(
      (candidate) =>
        candidate.id === item.targetId &&
        candidate.table === item.target &&
        (row.accountType === "CREDIT"
          ? candidate.table === "credit_card_transactions"
          : candidate.table !== "credit_card_transactions"),
    )
  )
    throw new Error("Selecione uma correspondência compatível com a conta ou cartão.");
  const classification = validateReview(
    row,
    { state, ownership, categoryId, target: item.target, targetId: item.targetId },
    categoryIds,
  );
  const link =
    state === "reconciled"
      ? await readLinkVersion({ client, userId }, item.target, item.targetId)
      : null;
  let create = null;
  if (item.action === "create") {
    if (
      !item.ownership ||
      item.confirmOrdinaryMovement !== true ||
      row.bankStatus !== "POSTED" ||
      row.currency !== "BRL" ||
      !["expense", "income"].includes(row.kind) ||
      !row.amount ||
      row.candidates.length ||
      (row.review.state !== "new" && row.review.state !== "pending")
    )
      throw new Error(
        "Criação exige titularidade explícita, natureza confirmada, movimento liquidado e nenhuma correspondência existente.",
      );
    const amount = Math.abs(row.amount);
    const description = row.description.trim().slice(0, 300);
    const common = {
      amount,
      categoryId,
      notes: "Origem Meu Pluggy conciliada pelo HubVZ",
    };
    if (row.accountType === "CREDIT") {
      if (
        !item.creditCardId ||
        !item.invoiceId ||
        row.kind !== "expense" ||
        Number(row.installments ?? 1) > 1
      )
        throw new Error(
          "Compra nova exige cartão e fatura do Hub. Revise parcelas no fluxo próprio.",
        );
      const invoice = await client
        .from("credit_card_invoices")
        .select("id,status,due_date,updated_at")
        .eq("user_id", userId)
        .eq("id", item.invoiceId)
        .eq("credit_card_id", item.creditCardId)
        .is("archived_at", null)
        .maybeSingle();
      if (invoice.error || !invoice.data || invoice.data.status !== "open")
        throw new Error("Escolha uma fatura aberta do cartão informado.");
      const dueDate = invoice.data.due_date;
      if (
        row.invoiceId &&
        !dashboard.bills.some(
          (bill) =>
            bill.institutionId === row.institutionId &&
            bill.accountId === row.accountId &&
            bill.id === row.invoiceId &&
            bill.dueDate === dueDate,
        )
      )
        throw new Error("Vencimento da fatura Pluggy divergente ou indisponível.");
      create = {
        tool: "hub_create_transaction",
        target: "credit_card_transactions",
        invoiceVersion: invoice.data.updated_at,
        args: {
          ...common,
          description,
          creditCardId: item.creditCardId,
          invoiceId: item.invoiceId,
          transactionDate: row.date,
          ownershipType: item.ownership,
        },
      };
    } else if (row.kind === "income") {
      if (item.inflowKind !== "real_income" && item.inflowKind !== "third_party_money")
        throw new Error(
          "Informe a natureza da entrada. Recebimentos de reembolso devem ser vinculados ao registro existente.",
        );
      if (item.inflowKind === "real_income" && item.ownership !== "personal")
        throw new Error("Renda pessoal exige titularidade pessoal confirmada.");
      create = {
        tool: "hub_create_income",
        target: "income_sources",
        args: {
          ...common,
          name: description,
          expectedDate: row.date,
          receivedDate: row.date,
          status: "received",
          sourceType: item.inflowKind,
        },
      };
    } else
      create = {
        tool: "hub_create_account_detailed",
        target: "accounts_payable",
        args: {
          ...common,
          title: description,
          dueDate: row.date,
          paidDate: row.date,
          status: "paid",
        },
      };
  }
  return {
    operation: {
      source: "pluggy",
      sourceKey: item.sourceKey,
      expectedUpdatedAt: item.expectedUpdatedAt,
      classification,
      create,
      link,
    },
    review: {
      sourceKey: item.sourceKey,
      action: item.action,
      description: row.description,
      amount: row.amount,
      date: row.date,
      bank: row.bank,
      classification,
      create,
      candidate:
        row.candidates.find(
          (candidate) =>
            candidate.id === item.targetId && candidate.table === item.target,
        ) ?? null,
    },
  };
}

async function readLinkVersion(
  { client, userId }: Context,
  target?: string | null,
  id?: string | null,
) {
  if (
    !id ||
    (target !== "accounts_payable" &&
      target !== "income_sources" &&
      target !== "credit_card_transactions")
  )
    throw new Error("Destino de conciliação inválido.");
  const result = await client
    .from(target)
    .select("updated_at")
    .eq("user_id", userId)
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (result.error || !result.data?.updated_at)
    throw new Error("Destino indisponível ou arquivado.");
  return { target, id, version: result.data.updated_at };
}

async function prepareOrganizze(
  item: Selection,
  data: Awaited<ReturnType<typeof sources>>,
  history: Map<string, ReturnType<typeof historyMovements>[number]>,
  cards: Record<string, string>,
  ctx: Context,
) {
  const { backup, refs } = data;
  const row = history.get(item.sourceKey);
  if (
    !backup ||
    !refs ||
    !row ||
    row.expectedUpdatedAt !== item.expectedUpdatedAt ||
    row.targetId
  )
    throw new Error(
      "Origem Organizze indisponível, conciliada ou com versão desatualizada.",
    );
  const snapshot = backup.snapshot;
  if (item.action === "own_transfer" || item.action === "invoice_payment")
    throw new Error(
      "Organizze preserva transferências e pagamentos no histórico. Use ignore para mantê-los como referência.",
    );
  if (
    item.action === "create" &&
    (!item.ownership ||
      item.confirmOrdinaryMovement !== true ||
      row.candidates.length ||
      row.internalCandidates.length ||
      (row.kind === "income" &&
        (item.inflowKind === "reimbursement" ||
          (item.inflowKind === "real_income" && item.ownership !== "personal"))))
  )
    throw new Error(
      "Criação exige titularidade, natureza confirmada e nenhuma possível duplicata. Reembolsos devem ser vinculados a um lançamento existente.",
    );
  const decision: ReconciliationDecision = {
    action:
      item.action === "create" ? "new" : item.action === "link" ? "link" : "historical",
    ownership: item.ownership ?? undefined,
    inflowKind: item.inflowKind,
    targetId: item.targetId,
    target: item.target,
  };
  if (
    item.categoryId &&
    !refs.categories.some(
      (category) => category.id === item.categoryId && category.type === row.kind,
    )
  )
    throw new Error("Categoria incompatível com a movimentação.");
  const plan = buildOrganizzeImport(snapshot, refs, cards, {
    [item.sourceKey]: decision,
  });
  if (plan.blockers.length) throw new Error(plan.blockers[0].reason);
  const byKey = new Map(
    plan.operations.map((operation) => [operation.sourceKey, operation]),
  );
  const selected = byKey.get(item.sourceKey);
  if (!selected || selected.review?.action === "already_imported")
    throw new Error("Origem já conciliada ou sem operação disponível.");
  const link =
    item.action === "link"
      ? await readLinkVersion(ctx, selected.target, selected.existingId)
      : null;
  const retain = new Set<string>();
  function take(key: string) {
    if (retain.has(key)) return;
    const op = byKey.get(key);
    if (!op) throw new Error("Dependência Organizze incompleta.");
    retain.add(key);
    if (
      op.review?.action !== "historical" &&
      !(op.existingId && op.source.entity === "transaction")
    )
      Object.values(op.links).forEach(take);
  }
  take(item.sourceKey);
  if (["classify", "pending"].includes(item.action)) selected.review!.action = "pending";
  const rows = plan.operations.filter((op) => retain.has(op.sourceKey));
  if (item.action === "create" && item.categoryId !== undefined)
    throw new Error(
      "O importador Organizze usa a categoria original na criação. Revise a categoria apresentada na proposta.",
    );
  let invoice = null;
  if (item.action === "create" && selected.target === "credit_card_transactions") {
    const dependency = byKey.get(selected.links.invoice);
    if (!dependency || dependency.target !== "credit_card_invoices")
      throw new Error("A compra exige uma fatura correspondente.");
    if (dependency.existingId) {
      const result = await ctx.client
        .from("credit_card_invoices")
        .select("updated_at,status")
        .eq("user_id", ctx.userId)
        .eq("id", dependency.existingId)
        .is("archived_at", null)
        .maybeSingle();
      if (result.error || !result.data || result.data.status !== "open")
        throw new Error("A compra exige uma fatura aberta correspondente.");
      invoice = {
        sourceKey: dependency.sourceKey,
        id: dependency.existingId,
        version: result.data.updated_at,
      };
    } else {
      invoice = { sourceKey: dependency.sourceKey, id: null, version: null };
    }
  }
  const categoryId =
    item.categoryId === undefined ? row.selectedCategoryId : item.categoryId;
  const ownership = item.ownership === undefined ? row.ownership : item.ownership;
  return {
    operation: {
      source: "organizze",
      sourceKey: item.sourceKey,
      expectedUpdatedAt: item.expectedUpdatedAt,
      rows,
      period: snapshot.period,
      categoryId,
      ownership,
      link,
      invoice,
      classificationOnly: decision.action === "historical",
    },
    review: {
      sourceKey: item.sourceKey,
      action: item.action,
      description: row.description,
      amount: row.amount,
      date: row.date,
      categoryId,
      category: row.categoryPath,
      ownership,
      target: selected.target,
      targetId: selected.existingId,
      recalculatesOpenInvoice: Boolean(invoice?.id),
      dependencies: rows
        .filter((op) => op !== selected)
        .map((op) => ({
          sourceKey: op.sourceKey,
          target: op.target,
          existingId: op.existingId,
          name: op.values.name ?? null,
        })),
    },
  };
}
