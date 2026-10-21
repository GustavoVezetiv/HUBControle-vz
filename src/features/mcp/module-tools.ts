import type { AppSupabaseClient } from "@/features/shared/types";
import type { McpTool } from "@/features/mcp/tools";

type Arguments = Record<string, unknown>;
type Context = { client: AppSupabaseClient; userId: string };

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object", properties, required, additionalProperties: false,
});
const string = { type: "string" };
const boolean = { type: "boolean" };
const uuid = { type: "string", format: "uuid" };
const nullableUuid = { anyOf: [uuid, { type: "null" }] };
const date = { type: "string", format: "date" };
const nullableDate = { anyOf: [date, { type: "null" }] };
const dateTime = { type: "string", format: "date-time" };
const money = { type: "number", minimum: 0, maximum: 1_000_000_000 };
const positiveMoney = { type: "number", exclusiveMinimum: 0, maximum: 1_000_000_000 };
const idempotencyKey = {
  type: "string", minLength: 8, maxLength: 128,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$",
};
const recordIdentity = { idempotencyKey, id: uuid, expectedUpdatedAt: dateTime };
const confirmation = {
  confirmDestructiveChange: boolean,
  confirmationText: { type: "string", description: "Use exatamente CONFIRMO ARQUIVAR, CONFIRMO EXCLUIR ou CONFIRMO ALTERAR FATURA QUITADA, conforme a ferramenta." },
};

const read = (name: string, description: string, inputSchema = objectSchema({
  limit: { type: "integer", minimum: 1, maximum: 100 }, offset: { type: "integer", minimum: 0 }, query: string,
})): McpTool => ({
  name, description, inputSchema,
  securitySchemes: [{ type: "oauth2", scopes: ["mcp:read"] }],
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
});

const write = (name: string, description: string, inputSchema: Record<string, unknown>, destructive = false): McpTool => ({
  name, description: `${description} Executa diretamente no Hub com validação, auditoria e idempotência.`, inputSchema,
  securitySchemes: [{ type: "oauth2", scopes: ["mcp:read", "mcp:write"] }],
  annotations: { readOnlyHint: false, destructiveHint: destructive, idempotentHint: true },
});

const personFields = {
  name: string, relationshipType: string, email: string, phone: string, pixKey: string, notes: string, isActive: boolean,
};
const categoryFields = {
  name: string, type: string, color: string, icon: string, scopes: { type: "array", items: string, maxItems: 12 }, isDefault: boolean, isActive: boolean,
};
const cardFields = {
  name: string, issuer: string, brand: string, lastFourDigits: string, limitAmount: money,
  closingDay: { type: "integer", minimum: 1, maximum: 31 }, dueDay: { type: "integer", minimum: 1, maximum: 31 },
  cashbackRate: money, notes: string, isActive: boolean,
};
const subscriptionFields = {
  creditCardId: uuid, categoryId: nullableUuid, name: string, description: string, amount: positiveMoney,
  billingDay: { type: "integer", minimum: 1, maximum: 31 }, startDate: date, endDate: nullableDate,
  status: { type: "string", enum: ["active", "paused", "cancelled"] }, notes: string,
  members: { type: "array", maxItems: 100, items: objectSchema({ personId: uuid, shareAmount: positiveMoney }, ["personId", "shareAmount"]) },
};
const invoiceFields = {
  creditCardId: uuid, referenceMonth: { type: "string", pattern: "^[0-9]{4}-(0[1-9]|1[0-2])$" }, closingDate: nullableDate,
  dueDate: date, status: { type: "string", enum: ["open", "closed", "paid", "overdue", "canceled"] },
  paidAmount: money, paidDate: nullableDate, notes: string,
};
const installmentFields = {
  description: string, totalAmount: positiveMoney, installmentAmount: positiveMoney,
  installmentTotal: { type: "integer", minimum: 1, maximum: 360 }, currentInstallment: { type: "integer", minimum: 1, maximum: 360 },
  startDate: date, endDate: nullableDate, creditCardId: nullableUuid, invoiceId: nullableUuid,
  creditCardTransactionId: nullableUuid, categoryId: nullableUuid, personId: nullableUuid,
  installmentOrigin: { type: "string", enum: ["card", "invoice", "bank_slip", "financing", "informal_debt", "other"] },
  status: { type: "string", enum: ["pending", "scheduled", "paid", "overdue", "canceled", "active", "finished"] }, notes: string,
};
const placeFields = {
  name: string, description: string, placeType: { type: "string", enum: ["restaurant", "bar", "cafe", "outing", "trip", "event", "cinema", "park", "shopping", "other"] },
  status: { type: "string", enum: ["want_to_go", "planned", "visited", "cancelled"] }, city: string, district: string, address: string,
  googleMapsUrl: string, latitude: { type: "number", minimum: -90, maximum: 90 }, longitude: { type: "number", minimum: -180, maximum: 180 },
  plannedDate: nullableDate, visitedDate: nullableDate, estimatedCost: money, actualCost: money,
  rating: { type: "integer", minimum: 1, maximum: 5 }, wouldRepeat: boolean, companion: string, notes: string, categoryId: nullableUuid,
};
const detailedAccountFields = {
  title: string, description: string, amount: positiveMoney, dueDate: date, categoryId: nullableUuid, categoryName: string,
  personId: nullableUuid, personName: string, status: { type: "string", enum: ["pending", "scheduled", "paid", "overdue", "canceled"] },
  priority: { type: "string", enum: ["low", "normal", "high", "critical"] }, riskLevel: { type: "string", enum: ["low", "medium", "high", "critical"] },
  paidDate: nullableDate, paymentMethod: string, canDelay: boolean, delayRisk: { type: "string", enum: ["low", "medium", "high", "critical"] },
  isRecurring: boolean, recurrenceFrequency: { type: "string", enum: ["weekly", "monthly", "yearly"] }, recurrenceStartDate: nullableDate, recurrenceEndDate: nullableDate,
  lateInterestEnabled: boolean, lateInterestRate: money, lateInterestFrequency: { type: "string", enum: ["daily", "monthly"] }, lateFeeAmount: money, interestStartDate: nullableDate, notes: string,
};

export const extendedHubTools: McpTool[] = [
  read("hub_list_people", "Lista pessoas cadastradas, com busca opcional por nome.", objectSchema({ limit: { type: "integer", minimum: 1, maximum: 100 }, offset: { type: "integer", minimum: 0 }, query: string, includeInactive: boolean })),
  read("hub_search_people", "Pesquisa pessoas pelo nome para usar em cadastros, sem exigir IDs.", objectSchema({ query: string, limit: { type: "integer", minimum: 1, maximum: 25 } }, ["query"])),
  read("hub_list_categories", "Lista categorias com filtro por nome, tipo ou escopo.", objectSchema({ limit: { type: "integer", minimum: 1, maximum: 100 }, offset: { type: "integer", minimum: 0 }, query: string, type: string, scope: string, includeInactive: boolean })),
  read("hub_search_categories", "Pesquisa categorias pelo nome para usar em cadastros, sem exigir IDs.", objectSchema({ query: string, scope: string, limit: { type: "integer", minimum: 1, maximum: 25 } }, ["query"])),
  read("hub_list_payment_plans", "Lista planos financeiros e seus estados."),
  read("hub_get_payment_plan", "Retorna um plano financeiro e seus itens.", objectSchema({ id: uuid }, ["id"])),
  read("hub_list_places", "Lista roles, lugares e viagens não arquivados."),
  read("hub_list_notes", "Lista notas e organização pessoal."),
  read("hub_get_subscription_history", "Retorna participantes e histórico de cobranças de uma assinatura.", objectSchema({ id: uuid, limit: { type: "integer", minimum: 1, maximum: 100 } }, ["id"])),
  read("hub_list_archived_records", "Lista registros arquivados de um módulo suportado.", objectSchema({ module: { type: "string", enum: ["accounts", "income", "invoices", "transactions", "reimbursements", "purchases", "goals", "subscriptions", "places"] }, limit: { type: "integer", minimum: 1, maximum: 100 }, offset: { type: "integer", minimum: 0 } }, ["module"])),
  read("hub_get_profile_settings", "Consulta as configurações persistidas do perfil do Hub."),

  write("hub_create_account_detailed", "Cria uma conta manual com todos os campos do formulário real, incluindo recorrência, juros e risco. Não permite forjar vínculos automáticos.", objectSchema({ idempotencyKey, ...detailedAccountFields }, ["idempotencyKey", "title", "amount", "dueDate"])),
  write("hub_update_account_detailed", "Atualiza uma conta manual. Contas de parcela, fatura ou reembolso vinculado devem ser corrigidas no módulo de origem.", objectSchema({ ...recordIdentity, ...detailedAccountFields }, ["idempotencyKey", "id", "expectedUpdatedAt"])),
  write("hub_generate_account_recurrences", "Gera próximas ocorrências de uma conta recorrente manual sem duplicar títulos.", objectSchema({ ...recordIdentity, occurrences: { type: "integer", minimum: 1, maximum: 24 } }, ["idempotencyKey", "id", "expectedUpdatedAt", "occurrences"])),

  write("hub_create_person", "Cria uma pessoa para vínculos financeiros e reembolsos.", objectSchema({ idempotencyKey, ...personFields }, ["idempotencyKey", "name"])),
  write("hub_update_person", "Atualiza uma pessoa existente.", objectSchema({ ...recordIdentity, ...personFields }, ["idempotencyKey", "id", "expectedUpdatedAt"])),
  write("hub_deactivate_person", "Desativa uma pessoa sem apagar seu histórico.", objectSchema({ ...recordIdentity }, ["idempotencyKey", "id", "expectedUpdatedAt"])),
  write("hub_create_category", "Cria uma categoria com tipo, aparência e escopos.", objectSchema({ idempotencyKey, ...categoryFields }, ["idempotencyKey", "name", "type"])),
  write("hub_update_category", "Atualiza uma categoria existente.", objectSchema({ ...recordIdentity, ...categoryFields }, ["idempotencyKey", "id", "expectedUpdatedAt"])),
  write("hub_deactivate_category", "Desativa uma categoria sem apagar vínculos históricos.", objectSchema({ ...recordIdentity }, ["idempotencyKey", "id", "expectedUpdatedAt"])),
  write("hub_create_card", "Cria um cartão sem guardar dados sensíveis de pagamento.", objectSchema({ idempotencyKey, ...cardFields }, ["idempotencyKey", "name"])),
  write("hub_update_card", "Atualiza os dados de um cartão.", objectSchema({ ...recordIdentity, ...cardFields }, ["idempotencyKey", "id", "expectedUpdatedAt"])),
  write("hub_deactivate_card", "Desativa um cartão, preservando seu histórico.", objectSchema({ ...recordIdentity }, ["idempotencyKey", "id", "expectedUpdatedAt"])),

  write("hub_create_subscription", "Cria assinatura e seus participantes, sem gerar cobrança financeira.", objectSchema({ idempotencyKey, ...subscriptionFields }, ["idempotencyKey", "creditCardId", "name", "amount", "billingDay", "startDate"])),
  write("hub_update_subscription", "Atualiza assinatura e substitui sua lista de participantes de forma atômica.", objectSchema({ ...recordIdentity, ...subscriptionFields }, ["idempotencyKey", "id", "expectedUpdatedAt"])),
  write("hub_archive_subscription", "Arquiva uma assinatura. Exige confirmação explícita porque interrompe seu uso operacional.", objectSchema({ ...recordIdentity, ...confirmation, reason: string }, ["idempotencyKey", "id", "expectedUpdatedAt", "confirmDestructiveChange", "confirmationText"]), true),
  write("hub_restore_subscription", "Restaura uma assinatura arquivada.", objectSchema({ ...recordIdentity }, ["idempotencyKey", "id", "expectedUpdatedAt"])),
  write("hub_import_subscriptions", "Importa assinaturas em lote já extraídas de PDF, CSV ou Excel. Não gera cobranças financeiras.", objectSchema({ idempotencyKey, subscriptions: { type: "array", minItems: 1, maxItems: 100, items: objectSchema(subscriptionFields, ["creditCardId", "name", "amount", "billingDay", "startDate"]) } }, ["idempotencyKey", "subscriptions"])),

  write("hub_create_invoice", "Cria uma fatura vazia para um cartão. Lançamentos são incluídos por suas ferramentas próprias.", objectSchema({ idempotencyKey, ...invoiceFields }, ["idempotencyKey", "creditCardId", "referenceMonth", "dueDate"])),
  write("hub_update_invoice", "Atualiza uma fatura. Alterações em fatura quitada exigem confirmação explícita.", objectSchema({ ...recordIdentity, ...invoiceFields, ...confirmation }, ["idempotencyKey", "id", "expectedUpdatedAt"])),
  write("hub_create_installment", "Cria parcelamento ou financiamento. Parcelamentos no cartão permanecem controlados pela fatura.", objectSchema({ idempotencyKey, ...installmentFields }, ["idempotencyKey", "description", "totalAmount", "installmentAmount", "installmentTotal", "startDate"])),
  write("hub_update_installment", "Atualiza parcelamento não vinculado a cartão ou fatura.", objectSchema({ ...recordIdentity, ...installmentFields }, ["idempotencyKey", "id", "expectedUpdatedAt"])),
  write("hub_generate_installment_accounts", "Gera contas das parcelas fora do cartão, evitando duplicidade.", objectSchema({ ...recordIdentity }, ["idempotencyKey", "id", "expectedUpdatedAt"])),
  write("hub_register_installment_payment", "Registra o pagamento de uma parcela fora do cartão e atualiza o progresso.", objectSchema({ ...recordIdentity, installmentNumber: { type: "integer", minimum: 1, maximum: 360 }, paidAmount: positiveMoney, paymentDate: date, paymentMethod: string, notes: string }, ["idempotencyKey", "id", "expectedUpdatedAt", "installmentNumber", "paidAmount", "paymentDate"])),

  write("hub_create_payment_plan", "Cria um plano financeiro sem movimentar dinheiro.", objectSchema({ idempotencyKey, name: string, referenceMonth: { type: "string", pattern: "^[0-9]{4}-(0[1-9]|1[0-2])$" }, description: string, notes: string }, ["idempotencyKey", "name", "referenceMonth"])),
  write("hub_update_payment_plan", "Atualiza o cabeçalho de um plano financeiro.", objectSchema({ ...recordIdentity, name: string, referenceMonth: { type: "string", pattern: "^[0-9]{4}-(0[1-9]|1[0-2])$" }, description: string, notes: string, status: { type: "string", enum: ["draft", "active", "closed", "archived"] } }, ["idempotencyKey", "id", "expectedUpdatedAt"])),
  write("hub_activate_payment_plan", "Define um plano financeiro como ativo e devolve os demais planos ativos ao estado de rascunho.", objectSchema({ ...recordIdentity }, ["idempotencyKey", "id", "expectedUpdatedAt"])),
  write("hub_create_payment_plan_item", "Adiciona um item manual ou vinculado a um plano financeiro.", objectSchema({ idempotencyKey, paymentPlanId: uuid, itemType: { type: "string", enum: ["manual", "account_payable", "credit_card_invoice", "installment", "reimbursement", "income_source", "planned_purchase", "goal"] }, sourceId: nullableUuid, title: string, description: string, amount: money, dueDate: nullableDate, decision: { type: "string", enum: ["pay_now", "wait", "parcel", "negotiate", "pay_by_card", "monitor", "skip"] }, plannedPaymentDate: nullableDate, riskLevel: { type: "string", enum: ["low", "medium", "high", "critical"] }, status: { type: "string", enum: ["pending", "scheduled", "paid", "overdue", "canceled"] }, notes: string }, ["idempotencyKey", "paymentPlanId", "itemType", "title", "amount"])),
  write("hub_update_payment_plan_item", "Atualiza um item de plano financeiro.", objectSchema({ ...recordIdentity, itemType: string, sourceId: nullableUuid, title: string, description: string, amount: money, dueDate: nullableDate, decision: string, plannedPaymentDate: nullableDate, riskLevel: string, status: string, notes: string }, ["idempotencyKey", "id", "expectedUpdatedAt"])),
  write("hub_remove_payment_plan_item", "Remove um item de plano financeiro. Exige confirmação explícita.", objectSchema({ ...recordIdentity, ...confirmation }, ["idempotencyKey", "id", "expectedUpdatedAt", "confirmDestructiveChange", "confirmationText"]), true),

  write("hub_create_place", "Cria um rolê, lugar ou viagem sem criar despesa financeira.", objectSchema({ idempotencyKey, ...placeFields }, ["idempotencyKey", "name"])),
  write("hub_update_place", "Atualiza um rolê, lugar ou viagem.", objectSchema({ ...recordIdentity, ...placeFields }, ["idempotencyKey", "id", "expectedUpdatedAt"])),
  write("hub_create_note", "Cria uma nota de organização pessoal.", objectSchema({ idempotencyKey, title: string, body: string, entityType: string, entityId: nullableUuid, pinned: boolean }, ["idempotencyKey", "body"])),
  write("hub_update_note", "Atualiza uma nota de organização pessoal.", objectSchema({ ...recordIdentity, title: string, body: string, entityType: string, entityId: nullableUuid, pinned: boolean }, ["idempotencyKey", "id", "expectedUpdatedAt"])),
  write("hub_delete_note", "Exclui uma nota. Exige confirmação explícita.", objectSchema({ ...recordIdentity, ...confirmation }, ["idempotencyKey", "id", "expectedUpdatedAt", "confirmDestructiveChange", "confirmationText"]), true),
  write("hub_archive_record", "Arquiva logicamente um registro de módulo suportado. Exige confirmação explícita.", objectSchema({ idempotencyKey, id: uuid, expectedUpdatedAt: dateTime, module: { type: "string", enum: ["accounts", "income", "invoices", "transactions", "reimbursements", "purchases", "goals", "subscriptions", "places"] }, reason: string, ...confirmation }, ["idempotencyKey", "id", "expectedUpdatedAt", "module", "confirmDestructiveChange", "confirmationText"]), true),
  write("hub_restore_record", "Restaura um registro arquivado de módulo suportado.", objectSchema({ ...recordIdentity, module: { type: "string", enum: ["accounts", "income", "invoices", "transactions", "reimbursements", "purchases", "goals", "subscriptions", "places"] } }, ["idempotencyKey", "id", "expectedUpdatedAt", "module"])),
  write("hub_update_profile_settings", "Atualiza preferências persistidas do perfil, sem alterar autenticação ou segredos.", objectSchema({ idempotencyKey, expectedUpdatedAt: dateTime, displayName: string, currency: string, timezone: string, monthStartDay: { type: "integer", minimum: 1, maximum: 28 } }, ["idempotencyKey", "expectedUpdatedAt"])),
];

const toolsByName = new Map(extendedHubTools.map((tool) => [tool.name, tool]));
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idempotencyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const validDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export function isExtendedHubTool(name: string) {
  return toolsByName.has(name);
}

export function validateExtendedToolArguments(name: string, value: unknown): Arguments {
  const tool = toolsByName.get(name);
  if (!tool) throw new Error("Ferramenta desconhecida.");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Argumentos devem ser um objeto.");
  const args = value as Arguments;
  const schema = tool.inputSchema;
  const properties = schema.properties as Record<string, unknown>;
  const required = (schema.required ?? []) as string[];
  for (const key of Object.keys(args)) if (!(key in properties)) throw new Error(`Campo não permitido: ${key}.`);
  for (const key of required) if (!(key in args)) throw new Error(`Campo obrigatório: ${key}.`);
  if ("idempotencyKey" in properties && (typeof args.idempotencyKey !== "string" || !idempotencyPattern.test(args.idempotencyKey))) throw new Error("idempotencyKey inválida.");
  for (const key of ["id", "creditCardId", "categoryId", "personId", "paymentPlanId", "entityId", "sourceId", "creditCardTransactionId", "invoiceId"]) {
    const item = args[key];
    if (item !== undefined && item !== null && item !== "" && (typeof item !== "string" || !idPattern.test(item))) throw new Error(`${key} inválido.`);
  }
  for (const key of ["startDate", "endDate", "dueDate", "closingDate", "paidDate", "paymentDate", "plannedDate", "visitedDate"]) {
    const item = args[key];
    if (item !== undefined && item !== null && item !== "" && !validDate(item)) throw new Error(`${key} deve ser AAAA-MM-DD.`);
  }
  if ("expectedUpdatedAt" in args && (typeof args.expectedUpdatedAt !== "string" || Number.isNaN(Date.parse(args.expectedUpdatedAt)))) throw new Error("expectedUpdatedAt inválido.");
  for (const [key, item] of Object.entries(args)) {
    if (typeof item === "string" && item.length > 5_000) throw new Error(`${key} excede o tamanho permitido.`);
    if (typeof item === "number" && (!Number.isFinite(item) || Math.abs(item) > 1_000_000_000)) throw new Error(`${key} inválido.`);
  }
  if ("members" in args && (!Array.isArray(args.members) || args.members.some((item) => !item || typeof item !== "object" || Array.isArray(item)))) throw new Error("members inválido.");
  if ("subscriptions" in args && (!Array.isArray(args.subscriptions) || args.subscriptions.length === 0 || args.subscriptions.length > 100)) throw new Error("subscriptions inválido.");
  if (name.includes("archive") || name === "hub_delete_note" || name === "hub_remove_payment_plan_item") {
    if (args.confirmDestructiveChange !== true) throw new Error("Esta ação exige confirmação explícita na conversa.");
  }
  return args;
}

function getLimit(args: Arguments) {
  return Math.min(Math.max(Number(args.limit ?? 50), 1), 100);
}

function getOffset(args: Arguments) {
  return Math.max(Number(args.offset ?? 0), 0);
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

export async function runExtendedReadTool(name: string, args: Arguments, { client, userId }: Context) {
  const limit = getLimit(args);
  const offset = getOffset(args);
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const paged = async (table: "people" | "categories" | "payment_plans" | "places" | "notes") => {
    const pattern = `%${escapeLike(query)}%`;
    const result = await (() => {
      switch (table) {
        case "people": {
          let request = client.from("people").select("*").eq("user_id", userId);
          if (args.includeInactive !== true) request = request.eq("is_active", true);
          if (query) request = request.ilike("name", pattern);
          return request.order("name").range(offset, offset + limit - 1);
        }
        case "categories": {
          let request = client.from("categories").select("*").eq("user_id", userId);
          if (args.includeInactive !== true) request = request.eq("is_active", true);
          if (query) request = request.ilike("name", pattern);
          return request.order("name").range(offset, offset + limit - 1);
        }
        case "payment_plans": {
          let request = client.from("payment_plans").select("*").eq("user_id", userId);
          if (query) request = request.ilike("name", pattern);
          return request.order("reference_month", { ascending: false }).range(offset, offset + limit - 1);
        }
        case "places": {
          let request = client.from("places").select("*").eq("user_id", userId).is("archived_at", null);
          if (query) request = request.ilike("name", pattern);
          return request.order("created_at", { ascending: false }).range(offset, offset + limit - 1);
        }
        case "notes": {
          let request = client.from("notes").select("*").eq("user_id", userId);
          if (query) request = request.ilike("title", pattern);
          return request.order("updated_at", { ascending: false }).range(offset, offset + limit - 1);
        }
      }
    })();
    if (result.error) throw new Error("Não foi possível consultar os dados.");
    return { items: result.data ?? [], limit, offset };
  };
  switch (name) {
    case "hub_list_people": return paged("people");
    case "hub_search_people": {
      const value = typeof args.query === "string" ? args.query.trim() : "";
      if (!value) throw new Error("query é obrigatória.");
      const result = await client.from("people").select("id,name,relationship_type,is_active").eq("user_id", userId).ilike("name", `%${escapeLike(value)}%`).order("name").limit(limit);
      if (result.error) throw new Error("Não foi possível pesquisar pessoas.");
      return { items: result.data ?? [], limit };
    }
    case "hub_list_categories": {
      let request = client.from("categories").select("*").eq("user_id", userId);
      if (args.includeInactive !== true) request = request.eq("is_active", true);
      if (query) request = request.ilike("name", `%${escapeLike(query)}%`);
      if (typeof args.type === "string" && args.type) request = request.eq("type", args.type);
      if (typeof args.scope === "string" && args.scope) request = request.contains("scopes", [args.scope]);
      const result = await request.order("name").range(offset, offset + limit - 1);
      if (result.error) throw new Error("Não foi possível consultar categorias.");
      return { items: result.data ?? [], limit, offset };
    }
    case "hub_search_categories": {
      const value = typeof args.query === "string" ? args.query.trim() : "";
      if (!value) throw new Error("query é obrigatória.");
      let request = client.from("categories").select("id,name,type,scopes,is_active").eq("user_id", userId).eq("is_active", true).ilike("name", `%${escapeLike(value)}%`);
      if (typeof args.scope === "string" && args.scope) request = request.contains("scopes", [args.scope]);
      const result = await request.order("name").limit(limit);
      if (result.error) throw new Error("Não foi possível pesquisar categorias.");
      return { items: result.data ?? [], limit };
    }
    case "hub_list_payment_plans": return paged("payment_plans");
    case "hub_get_payment_plan": {
      const id = String(args.id);
      const [plan, items] = await Promise.all([
        client.from("payment_plans").select("*").eq("user_id", userId).eq("id", id).maybeSingle(),
        client.from("payment_plan_items").select("*").eq("user_id", userId).eq("payment_plan_id", id).order("due_date").limit(200),
      ]);
      if (plan.error || items.error || !plan.data) throw new Error("Plano financeiro não encontrado.");
      return { plan: plan.data, items: items.data ?? [] };
    }
    case "hub_list_places": return paged("places");
    case "hub_list_notes": return paged("notes");
    case "hub_get_subscription_history": {
      const id = String(args.id);
      const [subscription, members, occurrences] = await Promise.all([
        client.from("subscriptions").select("*").eq("user_id", userId).eq("id", id).maybeSingle(),
        client.from("subscription_members").select("*").eq("user_id", userId).eq("subscription_id", id).order("created_at").limit(100),
        client.from("subscription_occurrences").select("*").eq("user_id", userId).eq("subscription_id", id).order("reference_month", { ascending: false }).limit(limit),
      ]);
      if (subscription.error || members.error || occurrences.error || !subscription.data) throw new Error("Assinatura não encontrada.");
      return { subscription: subscription.data, members: members.data ?? [], occurrences: occurrences.data ?? [] };
    }
    case "hub_list_archived_records": {
      const archiveModule = String(args.module);
      const tableByModule = { accounts: "accounts_payable", income: "income_sources", invoices: "credit_card_invoices", transactions: "credit_card_transactions", reimbursements: "reimbursements", purchases: "planned_purchases", goals: "goals", subscriptions: "subscriptions", places: "places" } as const;
      const table = tableByModule[archiveModule as keyof typeof tableByModule];
      if (!table) throw new Error("Módulo arquivável inválido.");
      const result = await client.from(table).select("*").eq("user_id", userId).not("archived_at", "is", null).order("archived_at", { ascending: false }).range(offset, offset + limit - 1);
      if (result.error) throw new Error("Não foi possível consultar os arquivados.");
      return { items: result.data ?? [], limit, offset };
    }
    case "hub_get_profile_settings": {
      const result = await client.from("profiles").select("*").eq("id", userId).maybeSingle();
      if (result.error) throw new Error("Não foi possível consultar o perfil.");
      return result.data;
    }
    default: throw new Error("Ferramenta de consulta desconhecida.");
  }
}
