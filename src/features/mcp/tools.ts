import type { AppSupabaseClient } from "@/features/shared/types";
import { buildFinancialSummary } from "@/features/decision/financial-summary";
import { executeMcpDirectWrite, getMcpActionRequestStatus } from "@/features/mcp/admin";
import { getPeriodValue } from "@/features/shared/period";
import type { Json } from "@/lib/supabase/types";
import {
  extendedHubTools,
  isExtendedHubTool,
  runExtendedReadTool,
  validateExtendedToolArguments,
} from "@/features/mcp/module-tools";

type Arguments = Record<string, unknown>;
type Context = { client: AppSupabaseClient; userId: string };
export type McpTool = { name: string; description: string; inputSchema: Record<string, unknown>; securitySchemes: { type: "oauth2"; scopes: string[] }[]; annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean } };
type Tool = McpTool;

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object", properties, required, additionalProperties: false,
});
const string = { type: "string" };
const uuid = { type: "string", format: "uuid" };
const nullableUuid = { anyOf: [uuid, { type: "null" }] };
const date = { type: "string", format: "date" };
const nullableDate = { anyOf: [date, { type: "null" }] };
const dateTime = { type: "string", format: "date-time" };
const money = { type: "number", minimum: 0, maximum: 1_000_000_000 };
const positiveMoney = { type: "number", exclusiveMinimum: 0, maximum: 1_000_000_000 };
const boolean = { type: "boolean" };
const idempotencyKey = {
  type: "string", minLength: 8, maxLength: 128,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$",
  description: "Chave única desta solicitação. Reutilize a mesma chave somente ao repetir exatamente a mesma operação.",
};
const updateIdentity = { idempotencyKey, id: uuid, expectedUpdatedAt: dateTime };
const financialReferences = { categoryId: nullableUuid, personId: nullableUuid };
const lateInterestFields = {
  lateInterestEnabled: boolean, lateInterestRate: money,
  lateInterestFrequency: { type: "string", enum: ["daily", "monthly"] },
  lateFeeAmount: money, interestStartDate: nullableDate,
};
const sensitiveConfirmation = {
  confirmSensitiveChange: boolean,
  confirmationText: { type: "string", description: "Use exatamente 'CONFIRMO ALTERAR FATURA QUITADA' somente após confirmação explícita do usuário na conversa." },
};
const listSchema = objectSchema({ limit: { type: "integer", minimum: 1, maximum: 100 }, offset: { type: "integer", minimum: 0 } });
const periodSchema = objectSchema({ month: { type: "string", pattern: "^[0-9]{4}-(0[1-9]|1[0-2])$" } });

const read = (name: string, description: string, inputSchema = listSchema): Tool => ({
  name, description, inputSchema,
  securitySchemes: [{ type: "oauth2", scopes: ["mcp:read"] }],
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
});
const write = (name: string, description: string, inputSchema: Record<string, unknown>): Tool => ({
  name, description: `${description} Executa diretamente no Hub, com validação, auditoria e idempotência.`, inputSchema,
  securitySchemes: [{ type: "oauth2", scopes: ["mcp:read", "mcp:write"] }],
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
});

const baseHubTools: Tool[] = [
  read("hub_get_financial_summary", "Resumo financeiro calculado pelas mesmas regras do Dashboard e Fluxo de caixa.", periodSchema),
  read("hub_list_accounts", "Contas a pagar não arquivadas."),
  read("hub_list_transactions", "Lançamentos de cartão não arquivados."),
  read("hub_list_pending_charges", "Reembolsos a receber, parciais ou atrasados."),
  read("hub_list_invoices", "Faturas não arquivadas."),
  read("hub_list_cards", "Cartões do usuário, sem credenciais ou dados de pagamento."),
  read("hub_list_subscriptions", "Assinaturas não arquivadas."),
  read("hub_list_reimbursements", "Reembolsos não arquivados."),
  read("hub_list_installments", "Parcelamentos e financiamentos."),
  read("hub_list_income", "Receitas e entradas, com tipo para distinguir renda livre de dinheiro vinculado."),
  read("hub_list_planned_purchases", "Compras planejadas e desejos não arquivados."),
  read("hub_list_goals", "Metas não arquivadas."),
  read("hub_get_weekly_review", "Revisão semanal salva, sem tokens nem dados brutos do Google Tasks.", objectSchema({ weekStart: date }, ["weekStart"])),
  read("hub_get_action_status", "Consulta propostas legadas criadas antes da escrita direta.", objectSchema({ confirmationId: uuid }, ["confirmationId"])),
  write("hub_create_account", "Cria despesa/conta a pagar simples, sem gerar lançamento de cartão nem parcela.", objectSchema({
    idempotencyKey, title: string, description: string, amount: positiveMoney, dueDate: date, ...financialReferences,
    status: { type: "string", enum: ["pending", "paid", "overdue", "canceled"] }, paidDate: nullableDate,
    priority: { type: "string", enum: ["low", "normal", "medium", "high", "critical"] },
    riskLevel: { type: "string", enum: ["low", "medium", "high", "critical"] },
    paymentMethod: { type: "string", enum: ["cash", "pix", "credit_card", "bank_slip", "debit", "transfer", "negotiation", "unknown"] },
    canDelay: boolean, delayRisk: { type: "string", enum: ["low", "medium", "high", "critical"] }, notes: string, ...lateInterestFields,
  }, ["idempotencyKey", "title", "amount", "dueDate"])),
  write("hub_update_account", "Edita uma despesa simples. Campos estruturais de contas geradas ou vinculadas são bloqueados.", objectSchema({
    ...updateIdentity, title: string, description: string, amount: positiveMoney, dueDate: date, ...financialReferences,
    status: { type: "string", enum: ["pending", "paid", "overdue", "canceled"] }, paidDate: nullableDate,
    priority: { type: "string", enum: ["low", "normal", "medium", "high", "critical"] },
    riskLevel: { type: "string", enum: ["low", "medium", "high", "critical"] },
    paymentMethod: { type: "string", enum: ["cash", "pix", "credit_card", "bank_slip", "debit", "transfer", "negotiation", "unknown"] },
    canDelay: boolean, delayRisk: { type: "string", enum: ["low", "medium", "high", "critical"] }, notes: string, ...lateInterestFields,
  }, ["idempotencyKey", "id", "expectedUpdatedAt"])),
  write("hub_create_income", "Cria receita ou entrada simples. Reembolso recebido usa a ferramenta específica de recebimento.", objectSchema({
    idempotencyKey, name: string, description: string, amount: positiveMoney, expectedDate: nullableDate, receivedDate: nullableDate, ...financialReferences,
    sourceType: { type: "string", enum: ["real_income", "freelance", "salary", "scholarship", "other", "personal_contribution", "account_transfer", "available_cash", "loan_received", "third_party_money"] },
    status: { type: "string", enum: ["expected", "received", "partial", "overdue", "canceled"] },
    confidence: { type: "string", enum: ["low", "medium", "high", "uncertain"] }, notes: string,
  }, ["idempotencyKey", "name", "amount"])),
  write("hub_update_income", "Edita receita simples. Entradas geradas ou vinculadas devem ser corrigidas no módulo de origem.", objectSchema({
    ...updateIdentity, name: string, description: string, amount: positiveMoney, expectedDate: nullableDate, receivedDate: nullableDate, ...financialReferences,
    sourceType: { type: "string", enum: ["real_income", "freelance", "salary", "scholarship", "other", "personal_contribution", "account_transfer", "available_cash", "loan_received", "third_party_money"] },
    status: { type: "string", enum: ["expected", "received", "partial", "overdue", "canceled"] },
    confidence: { type: "string", enum: ["low", "medium", "high", "uncertain"] }, notes: string,
  }, ["idempotencyKey", "id", "expectedUpdatedAt"])),
  write("hub_create_transaction", "Cria lançamento em fatura existente e recalcula totais. Pode criar o reembolso vinculado no mesmo commit.", objectSchema({
    idempotencyKey, creditCardId: uuid, invoiceId: uuid, transactionDate: date, description: string, amount: positiveMoney, ...financialReferences,
    ownershipType: { type: "string", enum: ["personal", "reimbursable", "third_party", "shared", "family"] },
    isReimbursable: boolean, createReimbursement: boolean, reimbursementExpectedDate: nullableDate, notes: string, ...sensitiveConfirmation,
  }, ["idempotencyKey", "creditCardId", "invoiceId", "transactionDate", "description", "amount"])),
  write("hub_update_transaction", "Corrige lançamento simples na mesma fatura. Não move cartões/faturas nem altera parcelas ou recorrências.", objectSchema({
    ...updateIdentity, creditCardId: uuid, invoiceId: uuid, transactionDate: date, description: string, amount: positiveMoney, ...financialReferences,
    ownershipType: { type: "string", enum: ["personal", "reimbursable", "third_party", "shared", "family"] },
    isReimbursable: boolean, syncLinkedReimbursement: boolean, notes: string, ...sensitiveConfirmation,
  }, ["idempotencyKey", "id", "expectedUpdatedAt"])),
  write("hub_create_planned_purchase", "Cria compra planejada sem registrar despesa ou pagamento.", objectSchema({
    idempotencyKey, title: string, description: string, estimatedAmount: money, paidAmount: money,
    targetDate: nullableDate, purchaseDate: nullableDate, categoryId: nullableUuid, project: string,
    paymentMethod: { type: "string", enum: ["cash", "credit_card", "installment", "unknown"] },
    installmentCount: { type: "integer", minimum: 1, maximum: 120 },
    decisionStatus: { type: "string", enum: ["considering", "approved", "delayed", "canceled", "purchased"] },
    riskLevel: { type: "string", enum: ["low", "medium", "high", "critical"] }, notes: string,
  }, ["idempotencyKey", "title"])),
  write("hub_update_planned_purchase", "Edita compra planejada sem criar despesa, parcela ou pagamento.", objectSchema({
    ...updateIdentity, title: string, description: string, estimatedAmount: money, paidAmount: money,
    targetDate: nullableDate, purchaseDate: nullableDate, categoryId: nullableUuid, project: string,
    paymentMethod: { type: "string", enum: ["cash", "credit_card", "installment", "unknown"] },
    installmentCount: { type: "integer", minimum: 1, maximum: 120 },
    decisionStatus: { type: "string", enum: ["considering", "approved", "delayed", "canceled", "purchased"] },
    riskLevel: { type: "string", enum: ["low", "medium", "high", "critical"] }, notes: string,
  }, ["idempotencyKey", "id", "expectedUpdatedAt"])),
  write("hub_create_goal", "Cria meta sem movimentar dinheiro.", objectSchema({
    idempotencyKey, name: string, goalType: { type: "string", enum: ["personal", "professional", "course", "education", "project"] },
    goalKind: { type: "string", enum: ["qualitative", "financial", "numeric"] }, categoryId: nullableUuid,
    targetAmount: money, currentAmount: money, startDate: nullableDate, targetDate: nullableDate,
    monthlyContribution: money, status: { type: "string", enum: ["active", "paused", "completed", "canceled"] }, notes: string,
  }, ["idempotencyKey", "name"])),
  write("hub_update_goal", "Atualiza dados e progresso de meta sem movimentar dinheiro.", objectSchema({
    ...updateIdentity, name: string, goalType: { type: "string", enum: ["personal", "professional", "course", "education", "project"] },
    goalKind: { type: "string", enum: ["qualitative", "financial", "numeric"] }, categoryId: nullableUuid,
    targetAmount: money, currentAmount: money, startDate: nullableDate, targetDate: nullableDate,
    monthlyContribution: money, status: { type: "string", enum: ["active", "paused", "completed", "canceled"] }, notes: string,
  }, ["idempotencyKey", "id", "expectedUpdatedAt"])),
  write("hub_create_reimbursement", "Cria reembolso e pode vincular uma conta ou lançamento existente sem duplicar a despesa.", objectSchema({
    idempotencyKey, personId: uuid, categoryId: nullableUuid, description: string, expectedAmount: positiveMoney, expectedDate: date,
    creditCardTransactionId: nullableUuid, accountPayableId: nullableUuid, notes: string, ...lateInterestFields,
  }, ["idempotencyKey", "personId", "description", "expectedAmount", "expectedDate"])),
  write("hub_update_reimbursement", "Edita reembolso preservando a origem. Sincronizar valor vinculado exige solicitação explícita.", objectSchema({
    ...updateIdentity, personId: uuid, categoryId: nullableUuid, description: string, expectedAmount: positiveMoney, expectedDate: date,
    status: { type: "string", enum: ["expected", "late", "overdue"] }, notes: string,
    syncLinkedOrigin: boolean, ...sensitiveConfirmation, ...lateInterestFields,
  }, ["idempotencyKey", "id", "expectedUpdatedAt"])),
  write("hub_register_reimbursement_receipt", "Registra recebimento parcial ou total como entrada vinculada, sem contar como renda livre.", objectSchema({
    ...updateIdentity, amount: positiveMoney, receivedDate: date, method: string, notes: string,
  }, ["idempotencyKey", "id", "expectedUpdatedAt", "amount", "receivedDate"])),
];

export const hubTools: Tool[] = [...baseHubTools, ...extendedHubTools];

const writeNames = new Set(hubTools.filter((tool) => !tool.annotations.readOnlyHint).map((tool) => tool.name));
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idempotencyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const nonempty = (value: unknown, name: string) => {
  if (typeof value !== "string" || !value.trim() || value.length > 300) throw new Error(`${name} deve conter de 1 a 300 caracteres.`);
  return value.trim();
};
const optionalString = (value: unknown, name: string) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length > 2000) throw new Error(`${name} deve ser texto de até 2000 caracteres.`);
  return value.trim();
};
const optionalUuid = (value: unknown, name: string) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !idPattern.test(value)) throw new Error(`${name} inválido.`);
  return value;
};
const requiredUuid = (value: unknown, name: string) => optionalUuid(value, name) ?? (() => { throw new Error(`${name} obrigatório.`); })();
const optionalDate = (value: unknown, name: string) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (!validDate(value)) throw new Error(`${name} deve ser AAAA-MM-DD.`);
  return value;
};
const numeric = (value: unknown, name: string, positive: boolean) => {
  if (typeof value !== "number" || !Number.isFinite(value) || (positive ? value <= 0 : value < 0) || value > 1_000_000_000) throw new Error(`${name} inválido.`);
  return value;
};

export function validateToolArguments(name: string, value: unknown): Arguments {
  if (isExtendedHubTool(name)) return validateExtendedToolArguments(name, value);
  const tool = hubTools.find((item) => item.name === name);
  if (!tool) throw new Error("Ferramenta desconhecida.");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Argumentos devem ser um objeto.");
  const args = value as Arguments;
  const schema = tool.inputSchema;
  const properties = schema.properties as Record<string, unknown>;
  const required = (schema.required ?? []) as string[];
  for (const key of Object.keys(args)) if (!(key in properties)) throw new Error(`Campo não permitido: ${key}.`);
  for (const key of required) if (!(key in args)) throw new Error(`Campo obrigatório: ${key}.`);
  if (writeNames.has(name) && (typeof args.idempotencyKey !== "string" || !idempotencyPattern.test(args.idempotencyKey))) throw new Error("idempotencyKey inválida.");
  if ("id" in args) requiredUuid(args.id, "id");
  if ("confirmationId" in args) requiredUuid(args.confirmationId, "confirmationId");
  for (const key of ["creditCardId", "invoiceId", "categoryId", "personId", "creditCardTransactionId", "accountPayableId"]) optionalUuid(args[key], key);
  for (const key of ["transactionDate", "targetDate", "purchaseDate", "startDate", "expectedDate", "receivedDate", "dueDate", "paidDate", "interestStartDate", "reimbursementExpectedDate", "weekStart"]) optionalDate(args[key], key);
  if ("expectedUpdatedAt" in args && (typeof args.expectedUpdatedAt !== "string" || Number.isNaN(Date.parse(args.expectedUpdatedAt)))) throw new Error("expectedUpdatedAt inválido.");
  for (const key of ["description", "title", "name", "project", "notes", "status", "method", "confirmationText", "sourceType", "goalType", "goalKind"]) optionalString(args[key], key);
  for (const key of ["description", "title", "name"]) if (key in args) nonempty(args[key], key);
  for (const key of ["amount", "expectedAmount"]) if (key in args) numeric(args[key], key, true);
  for (const key of ["estimatedAmount", "paidAmount", "targetAmount", "currentAmount", "monthlyContribution", "lateInterestRate", "lateFeeAmount"]) if (key in args) numeric(args[key], key, false);
  if ("installmentCount" in args && (!Number.isInteger(args.installmentCount) || Number(args.installmentCount) < 1 || Number(args.installmentCount) > 120)) throw new Error("installmentCount inválido.");
  for (const key of ["isReimbursable", "createReimbursement", "syncLinkedReimbursement", "syncLinkedOrigin", "confirmSensitiveChange", "canDelay", "lateInterestEnabled"]) {
    if (key in args && typeof args[key] !== "boolean") throw new Error(`${key} deve ser booleano.`);
  }
  if ("limit" in args && (!Number.isInteger(args.limit) || Number(args.limit) < 1 || Number(args.limit) > 100)) throw new Error("limit deve ser de 1 a 100.");
  if ("offset" in args && (!Number.isInteger(args.offset) || Number(args.offset) < 0 || Number(args.offset) > 10000)) throw new Error("offset inválido.");
  if ("month" in args && (typeof args.month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(args.month))) throw new Error("month deve ser AAAA-MM.");
  return args;
}

export async function runReadTool(name: string, args: Arguments, { client, userId }: Context) {
  if (isExtendedHubTool(name)) return runExtendedReadTool(name, args, { client, userId });
  const limit = Number(args.limit ?? 50);
  const offset = Number(args.offset ?? 0);
  const list = async (table: "accounts_payable" | "credit_cards" | "credit_card_transactions" | "reimbursements" | "credit_card_invoices" | "subscriptions" | "installments" | "income_sources" | "planned_purchases" | "goals", archived = true) => {
    let query = client.from(table).select("*").eq("user_id", userId);
    if (archived) query = query.is("archived_at", null);
    const result = await query.range(offset, offset + limit - 1);
    if (result.error) throw new Error("Não foi possível consultar os dados.");
    return { items: result.data ?? [], limit, offset };
  };
  switch (name) {
    case "hub_get_action_status": {
      const confirmationId = requiredUuid(args.confirmationId, "confirmationId");
      const result = await getMcpActionRequestStatus(userId, confirmationId);
      if (result.error || !result.data) throw new Error("Proposta legada não encontrada para este usuário.");
      return result.data;
    }
    case "hub_list_accounts": return list("accounts_payable");
    case "hub_list_transactions": return list("credit_card_transactions");
    case "hub_list_invoices": return list("credit_card_invoices");
    case "hub_list_cards": return list("credit_cards", false);
    case "hub_list_subscriptions": return list("subscriptions");
    case "hub_list_reimbursements": return list("reimbursements");
    case "hub_list_installments": return list("installments", false);
    case "hub_list_income": return list("income_sources");
    case "hub_list_planned_purchases": return list("planned_purchases");
    case "hub_list_goals": return list("goals");
    case "hub_list_pending_charges": {
      const result = await client.from("reimbursements").select("id,person_id,description,expected_amount,received_amount,expected_date,status,updated_at").eq("user_id", userId).is("archived_at", null).in("status", ["expected", "partial", "late", "overdue"]).range(offset, offset + limit - 1);
      if (result.error) throw new Error("Não foi possível consultar as cobranças.");
      return { items: result.data ?? [], limit, offset };
    }
    case "hub_get_weekly_review": {
      const weekStart = optionalDate(args.weekStart, "weekStart");
      if (!weekStart) throw new Error("weekStart obrigatório.");
      const [report, analysis] = await Promise.all([
        client.from("routine_weekly_reports").select("*").eq("user_id", userId).eq("week_start_date", weekStart).maybeSingle(),
        client.from("routine_ai_summaries").select("week_start,week_end,summary_text,created_at,error_message").eq("user_id", userId).eq("week_start", weekStart).maybeSingle(),
      ]);
      if (report.error || analysis.error) throw new Error("Não foi possível carregar a revisão semanal.");
      return { report: report.data, analysis: analysis.data };
    }
    case "hub_get_financial_summary": {
      const month = args.month as string | undefined;
      const period = month ? { preset: "custom" as const, startDate: `${month}-01`, endDate: `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate()).padStart(2, "0")}` } : getPeriodValue("current_month");
      const results = await Promise.all([
        client.from("accounts_payable").select("*").eq("user_id", userId).is("archived_at", null).limit(1001),
        client.from("income_sources").select("*").eq("user_id", userId).is("archived_at", null).limit(1001),
        client.from("credit_card_invoices").select("*").eq("user_id", userId).is("archived_at", null).limit(1001),
        client.from("credit_card_transactions").select("*").eq("user_id", userId).is("archived_at", null).limit(1001),
        client.from("reimbursements").select("*").eq("user_id", userId).is("archived_at", null).limit(1001),
        client.from("installments").select("*").eq("user_id", userId).limit(1001),
        client.from("payment_plans").select("*").eq("user_id", userId).eq("status", "active").order("reference_month", { ascending: false }).limit(1),
      ] as const);
      if (results.some((result) => result.error || (result.data?.length ?? 0) > 1000)) throw new Error("Resumo indisponível: consulta falhou ou excedeu 1000 registros por módulo.");
      const activePlan = results[6].data?.[0] ?? null;
      const planItems = activePlan ? await client.from("payment_plan_items").select("*").eq("user_id", userId).eq("payment_plan_id", activePlan.id).limit(1001) : null;
      if (planItems?.error || (planItems?.data?.length ?? 0) > 1000) throw new Error("Não foi possível consultar o plano de pagamento.");
      const summary = buildFinancialSummary({
        accounts: results[0].data ?? [], incomeSources: results[1].data ?? [], invoices: results[2].data ?? [],
        transactions: results[3].data ?? [], reimbursements: results[4].data ?? [], installments: results[5].data ?? [],
        activePlan, activePlanItems: planItems?.data ?? [],
      }, period);
      return { ...summary, flowRows: summary.flowRows.slice(0, 100), flowRowsTruncated: summary.flowRows.length > 100 };
    }
    default: throw new Error("Ferramenta de consulta desconhecida.");
  }
}

export async function runWriteTool(name: string, args: Arguments, { userId }: Context) {
  if (!writeNames.has(name)) throw new Error("Operação de escrita desconhecida.");
  const idempotency = String(args.idempotencyKey);
  const operationArguments = Object.fromEntries(
    Object.entries(args).filter(([key]) => key !== "idempotencyKey"),
  );
  const result = await executeMcpDirectWrite({
    userId,
    idempotencyKey: idempotency,
    toolName: name,
    arguments: operationArguments as Json,
  });
  if (result.error) {
    console.error("[hub-mcp] Direct write rejected", { tool: name, code: result.error.code });
    throw new Error(result.error.message || "Não foi possível executar a alteração.");
  }
  return result.data;
}

