import "server-only";
import type { Period, Raw } from "../organizze/types";
import type { PluggySnapshot, Institution } from "./types";
import { validatePeriod } from "../organizze/extraction";

const base = "https://api.pluggy.ai";
export const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export class PluggyError extends Error {
  constructor(
    public code: string,
    public status = 502,
  ) {
    super(`Consulta Pluggy interrompida (${code}).`);
  }
}
type Config = {
  clientId: string;
  clientSecret: string;
  itemId: string;
  ownerId: string;
  institution?: Institution;
  includeInvestments?: boolean;
};
type Credentials = {
  apiKey: string;
  expiresAt: number;
  authenticating: Promise<void> | null;
};
const credentials = new Map<string, Credentials>();
const readers = new Map<string, ReturnType<typeof createPluggyReader>>();

// One private reader/key per configured personal connection, not per HTTP call.
export function configuredPluggyReader(config: Config) {
  const key = JSON.stringify(config);
  if (!readers.has(key)) {
    const application = JSON.stringify([
      config.clientId,
      config.clientSecret,
      config.ownerId,
    ]);
    if (!credentials.has(application))
      credentials.set(application, { apiKey: "", expiresAt: 0, authenticating: null });
    if (readers.size > 20) readers.clear();
    readers.set(key, createPluggyReader(config, fetch, credentials.get(application)));
  }
  return readers.get(key)!;
}

export function createPluggyReader(
  config: Config,
  transport: typeof fetch = fetch,
  keys: Credentials = { apiKey: "", expiresAt: 0, authenticating: null },
) {
  if (
    !config.clientId ||
    !config.clientSecret ||
    !isUuid(config.itemId) ||
    !isUuid(config.ownerId)
  )
    throw new PluggyError("not_configured", 503);
  async function request(path: string, authenticate = false, retry = true): Promise<Raw> {
    if (!authenticate && (!keys.apiKey || Date.now() >= keys.expiresAt)) {
      keys.authenticating ??= request("/auth", true)
        .then((result) => {
          if (typeof result.apiKey !== "string" || !result.apiKey)
            throw new PluggyError("invalid_auth_response");
          keys.apiKey = result.apiKey;
          keys.expiresAt = Date.now() + 110 * 60 * 1000;
        })
        .finally(() => {
          keys.authenticating = null;
        });
      await keys.authenticating;
    }
    let response: Response;
    try {
      response = await transport(`${base}${path}`, {
        method: authenticate ? "POST" : "GET",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
        headers: {
          Accept: "application/json",
          ...(authenticate
            ? { "Content-Type": "application/json" }
            : { "X-API-KEY": keys.apiKey }),
        },
        ...(authenticate
          ? {
              body: JSON.stringify({
                clientId: config.clientId,
                clientSecret: config.clientSecret,
              }),
            }
          : {}),
      });
    } catch {
      throw new PluggyError("network_error");
    }
    if (response.status === 401 && !authenticate && retry) {
      keys.expiresAt = 0;
      return request(path, false, false);
    }
    if (!response.ok)
      throw new PluggyError(
        `upstream_${response.status}`,
        response.status === 429 ? 429 : 502,
      );
    try {
      if (Number(response.headers.get("content-length")) > 16 * 1024 * 1024)
        throw new Error();
      const text = await response.text();
      if (text.length > 16 * 1024 * 1024) throw new Error();
      const body: unknown = JSON.parse(text);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
      return body as Raw;
    } catch {
      throw new PluggyError("invalid_response");
    }
  }
  async function sync(period: Period): Promise<PluggySnapshot> {
    validatePeriod(period);
    const snapshot: PluggySnapshot = {
      version: 1,
      source: "pluggy",
      institution: config.institution ?? "nubank",
      ownerId: config.ownerId,
      itemId: config.itemId,
      period,
      fetchedAt: new Date().toISOString(),
      item: {},
      accounts: [],
      transactions: [],
      bills: [],
      receipts: [],
      warnings: [],
      complete: false,
    };
    // Never enumerate items or create/update connections: use the owner-bound proxy ID.
    const item = await request(`/items/${config.itemId}`);
    const connector = item.connector as Raw | undefined;
    if (
      item.id !== config.itemId ||
      !connector ||
      connector.isSandbox !== false ||
      typeof connector.name !== "string" ||
      !/^meu\s*pluggy$/i.test(connector.name.trim())
    )
      throw new PluggyError("not_meu_pluggy_proxy");
    // Nubank is the explicit server binding, not an inference from generic proxy metadata.
    snapshot.item = {
      id: item.id,
      status: item.status,
      executionStatus: item.executionStatus,
      lastUpdatedAt: item.lastUpdatedAt,
      consentExpiresAt: item.consentExpiresAt,
      connector: { id: connector.id, name: connector.name, isSandbox: false },
    };
    if (item.status !== "UPDATED" || item.executionStatus !== "SUCCESS")
      snapshot.warnings.push(
        "A conexão ainda não informa atualização concluída. Confira consentimento e estado no Meu Pluggy.",
      );
    const numbered = async (
      resource: string,
      query: URLSearchParams,
      optional = false,
    ) => {
      const records: Raw[] = [];
      const ids = new Set<string>();
      let total: number | null = null;
      let pages: number | null = null;
      for (let page = 1; page <= 1000; page++) {
        const params = new URLSearchParams(query);
        params.set("page", String(page));
        if (resource !== "accounts") params.set("pageSize", "500");
        let body: Raw;
        try {
          body = await request(`/${resource}?${params}`);
        } catch (error) {
          if (
            optional &&
            page === 1 &&
            error instanceof PluggyError &&
            ["upstream_403", "upstream_404", "upstream_405", "upstream_422"].includes(
              error.code,
            )
          ) {
            snapshot.warnings.push(
              `${resource}: recurso não disponibilizado ou sem permissão (${error.code}); os demais produtos continuam disponíveis.`,
            );
            (snapshot.unavailable ??= []).push({ resource, code: error.code });
            return [];
          }
          throw error;
        }
        if (
          !Array.isArray(body.results) ||
          body.page !== page ||
          !Number.isSafeInteger(body.total) ||
          Number(body.total) < 0 ||
          !Number.isSafeInteger(body.totalPages) ||
          Number(body.totalPages) < 0
        )
          throw new PluggyError("invalid_pagination");
        if (total !== null && (body.total !== total || body.totalPages !== pages))
          throw new PluggyError("pagination_changed");
        total = Number(body.total);
        pages = Number(body.totalPages);
        for (const row of body.results as Raw[]) {
          if (!row || !isUuid(row.id) || ids.has(row.id))
            throw new PluggyError("duplicate_or_invalid_id");
          ids.add(row.id);
          records.push(row);
        }
        snapshot.receipts.push({ resource, count: body.results.length });
        if (page >= pages) {
          if (records.length !== total) throw new PluggyError("incomplete_pagination");
          return records;
        }
        if (!body.results.length) throw new PluggyError("incomplete_pagination");
      }
      throw new PluggyError("page_limit");
    };
    snapshot.accounts = await numbered(
      "accounts",
      new URLSearchParams({ itemId: config.itemId }),
    );
    for (const account of snapshot.accounts) {
      if (
        account.itemId !== config.itemId ||
        !["BANK", "CREDIT"].includes(String(account.type))
      )
        throw new PluggyError("account_scope_mismatch");
      const accountId = String(account.id);
      let query = `?${new URLSearchParams({ accountId, dateFrom: period.start, dateTo: period.end })}`;
      const queries = new Set<string>();
      const ids = new Set<string>();
      for (let page = 1; ; page++) {
        if (page > 1000 || queries.has(query))
          throw new PluggyError("cursor_cycle_or_limit");
        queries.add(query);
        const body = await request(`/v2/transactions${query}`);
        if (
          !Array.isArray(body.results) ||
          !(body.next === null || typeof body.next === "string")
        )
          throw new PluggyError("invalid_pagination");
        for (const row of body.results as Raw[]) {
          if (!row || !isUuid(row.id) || row.accountId !== accountId || ids.has(row.id))
            throw new PluggyError("transaction_scope_or_id");
          ids.add(row.id);
          snapshot.transactions.push(row);
        }
        snapshot.receipts.push({ resource: "transactions", count: body.results.length });
        if (body.next === null) break;
        const next = body.next as string;
        if (!next.startsWith("?") || next.includes("#") || next.length > 12000)
          throw new PluggyError("unsafe_cursor");
        const params = new URLSearchParams(next);
        if (
          params.getAll("accountId").length !== 1 ||
          params.get("accountId") !== accountId ||
          params.getAll("after").length !== 1 ||
          !params.get("after") ||
          [...params.keys()].some(
            (key) => !["accountId", "after", "dateFrom", "dateTo"].includes(key),
          ) ||
          ["dateFrom", "dateTo"].some(
            (key) =>
              params.has(key) &&
              (params.getAll(key).length !== 1 ||
                params.get(key) !== (key === "dateFrom" ? period.start : period.end)),
          )
        )
          throw new PluggyError("unsafe_cursor");
        query = next; // Opaque cursor is forwarded exactly as provided by the official API.
      }
      if (account.type === "CREDIT")
        for (const raw of await numbered(
          "bills",
          new URLSearchParams({ accountId }),
          true,
        )) {
          if (raw.accountId !== undefined && raw.accountId !== accountId)
            throw new PluggyError("bill_scope_mismatch");
          snapshot.bills.push({ accountId, raw });
        }
    }
    if (config.includeInvestments) {
      snapshot.investments = await numbered(
        "investments",
        new URLSearchParams({ itemId: config.itemId }),
        true,
      );
      snapshot.investmentTransactions = [];
      for (const investment of snapshot.investments) {
        if (investment.itemId !== config.itemId)
          throw new PluggyError("investment_scope_mismatch");
        const investmentId = String(investment.id);
        const transactions = await numbered(
          `investments/${investmentId}/transactions`,
          new URLSearchParams(),
          true,
        );
        for (const raw of transactions) {
          if (raw.investmentId !== undefined && raw.investmentId !== investmentId)
            throw new PluggyError("investment_transaction_scope_mismatch");
          snapshot.investmentTransactions.push({ investmentId, raw });
        }
        // Some connectors only expose embedded movements. Preserve those too,
        // deduplicating by ID without turning applications/redemptions into income.
        for (const raw of Array.isArray(investment.transactions)
          ? (investment.transactions as Raw[])
          : []) {
          if (!isUuid(raw.id)) throw new PluggyError("invalid_investment_transaction_id");
          if (
            !snapshot.investmentTransactions.some(
              (row) => row.investmentId === investmentId && row.raw.id === raw.id,
            )
          )
            snapshot.investmentTransactions.push({ investmentId, raw });
        }
      }
    }
    const dates = snapshot.transactions.map((row) =>
      typeof row.date === "string" ? row.date.slice(0, 10) : "",
    );
    if (
      dates.some(
        (date) =>
          !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < period.start || date > period.end,
      )
    )
      snapshot.warnings.push(
        "Há registros sem data válida ou fora do intervalo; preservados como contexto, sem inclusão financeira.",
      );
    snapshot.complete = true;
    return snapshot;
  }
  return { sync };
}
