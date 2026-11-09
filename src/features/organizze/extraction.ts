import type { Entity, PageResult, Period, Raw, Snapshot, Task } from "./types";

export function sourceId(value: unknown): string | null {
  if (typeof value === "number")
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  return typeof value === "string" && /^[1-9]\d*$/.test(value) ? value : null;
}

export function validatePeriod(period: Period) {
  if (
    !period ||
    ![period.start, period.end].every(
      (date) =>
        typeof date === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(date) &&
        !Number.isNaN(Date.parse(date)) &&
        new Date(date).toISOString().slice(0, 10) === date,
    ) ||
    period.start > period.end ||
    period.start < "2000-01-01" ||
    period.end > "2100-12-31"
  ) {
    throw new Error("Período inválido (limites: 2000 a 2100).");
  }
}

export function monthlyWindows(period: Period): Period[] {
  validatePeriod(period);
  const windows: Period[] = [];
  let cursor = `${period.start.slice(0, 7)}-01`;
  while (cursor <= period.end) {
    const date = new Date(`${cursor}T00:00:00Z`);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))
      .toISOString()
      .slice(0, 10);
    // The legacy API expands dates to full months. Preserve the returned rows;
    // preview selection applies the exact requested dates separately.
    windows.push({ start: cursor, end: last });
    cursor = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
      .toISOString()
      .slice(0, 10);
  }
  return windows;
}

export function taskKey(task: Task) {
  return `${task.path}|${task.period?.start ?? ""}|${task.period?.end ?? ""}|${task.page ?? 1}`;
}

const snapshotIndexes = new WeakMap<
  Snapshot,
  {
    records: Map<string, Snapshot["records"][number]>;
    tasks: Set<string>;
    done: Set<string>;
    cursor: number;
  }
>();

function indexes(snapshot: Snapshot) {
  let index = snapshotIndexes.get(snapshot);
  if (!index) {
    index = {
      records: new Map(snapshot.records.map((row) => [row.key, row])),
      tasks: new Set(snapshot.tasks.map(taskKey)),
      done: new Set([
        ...snapshot.receipts.map((receipt) => taskKey(receipt.task)),
        ...(snapshot.unavailable ?? []).map((item) => taskKey(item.task)),
      ]),
      cursor: 0,
    };
    snapshotIndexes.set(snapshot, index);
  }
  return index;
}

export function createSnapshot(ownerId: string, period: Period): Snapshot {
  const windows = monthlyWindows(period);
  return {
    version: 1,
    source: "organizze",
    ownerId,
    period,
    startedAt: new Date().toISOString(),
    records: [],
    receipts: [],
    errors: [],
    rejected: [],
    tasks: ["/accounts", "/categories", "/credit_cards"]
      .map((path) => ({ path }))
      .concat(
        windows.flatMap((window) =>
          ["/transactions", "/transfers"].map((path) => ({ path, period: window })),
        ),
      ),
  };
}

export function pendingTask(snapshot: Snapshot) {
  const index = indexes(snapshot);
  while (
    index.cursor < snapshot.tasks.length &&
    index.done.has(taskKey(snapshot.tasks[index.cursor]))
  )
    index.cursor++;
  return snapshot.tasks[index.cursor];
}

export function acceptPage(snapshot: Snapshot, task: Task, page: PageResult) {
  const index = indexes(snapshot);
  if (index.done.has(taskKey(task))) return;
  if (page.warnings?.length) (snapshot.warnings ??= []).push(...page.warnings);
  const ids = page.data.map((raw) => sourceId(raw.id) ?? "invalid").sort();
  if (
    (task.page ?? 1) > 1 &&
    ids.length &&
    snapshot.receipts.some(
      (receipt) =>
        receipt.task.path === task.path &&
        receipt.task.period?.start === task.period?.start &&
        receipt.task.period?.end === task.period?.end &&
        receipt.ids?.join(",") === ids.join(","),
    )
  ) {
    throw new Error(
      "A API repetiu os mesmos IDs em outra página. Extração parcial; conferir paginação.",
    );
  }
  const enqueue = (next: Task) => {
    if (!index.tasks.has(taskKey(next))) {
      index.tasks.add(taskKey(next));
      snapshot.tasks.push(next);
    }
  };
  const add = (entity: Entity, raw: Raw, scope = "", role?: "payment") => {
    const id = sourceId(raw.id);
    if (!id) {
      const reason = `ID ausente ou inválido em ${task.path}. Original preservado em quarentena.`;
      snapshot.errors.push(reason);
      snapshot.rejected.push({ task, raw, reason });
      return;
    }
    const key = `${entity}:${scope}${id}`;
    const existing = index.records.get(key);
    const origin = { task, raw, ...(role ? { role } : {}) };
    if (existing) {
      existing.sources.push(origin);
      // Enrich only absent fields; retain every version for conflict review.
      for (const [name, value] of Object.entries(raw))
        if (existing.raw[name] === undefined) existing.raw[name] = value;
    } else {
      const record = { key, entity, sourceId: id, raw: { ...raw }, sources: [origin] };
      snapshot.records.push(record);
      index.records.set(key, record);
    }
    if (entity === "transaction") {
      const card = sourceId(raw.credit_card_id) ??
        (raw.account_type === "CreditCard" ? sourceId(raw.account_id) : null);
      const invoice = sourceId(raw.credit_card_invoice_id);
      if (card && invoice) enqueue({ path: `/credit_cards/${card}/invoices/${invoice}` });
      const paidCard = sourceId(raw.paid_credit_card_id);
      const paidInvoice = sourceId(raw.paid_credit_card_invoice_id);
      if (paidCard && paidInvoice) enqueue({ path: `/credit_cards/${paidCard}/invoices/${paidInvoice}` });
    }
    return id;
  };
  const detail = task.path.match(
    /^\/(?:transactions|transfers)\/(\d+)$|^\/credit_cards\/\d+\/invoices\/(\d+)$/,
  );
  if (
    detail &&
    (page.data.length !== 1 || sourceId(page.data[0]?.id) !== (detail[1] ?? detail[2]))
  ) {
    const reason = `Resposta de detalhe não corresponde ao ID solicitado em ${task.path}.`;
    snapshot.errors.push(reason);
    for (const raw of page.data) snapshot.rejected.push({ task, raw, reason });
    snapshot.receipts.push({
      task,
      count: page.data.length,
      fetchedAt: page.fetchedAt,
      nextPage: page.nextPage,
      ids,
    });
    index.done.add(taskKey(task));
    return;
  }
  for (const raw of page.data) {
    if (task.path === "/accounts") add("account", raw);
    else if (task.path === "/categories") add("category", raw);
    else if (task.path === "/credit_cards") {
      const card = add("card", raw);
      if (card)
        for (const period of monthlyWindows(snapshot.period))
          enqueue({ path: `/credit_cards/${card}/invoices`, period });
    } else if (/\/invoices$/.test(task.path)) {
      const id = add("invoice", raw, `${task.path.split("/")[2]}:`);
      if (id) enqueue({ path: `${task.path}/${id}` });
    } else if (/\/invoices\/\d+$/.test(task.path)) {
      const card = task.path.split("/")[2];
      const invoice = task.path.split("/")[4];
      add("invoice", raw, `${card}:`);
      if (!Array.isArray(raw.transactions))
        snapshot.errors.push(
          `Detalhe da fatura ${card}/${invoice} sem lista de transações.`,
        );
      for (const transaction of Array.isArray(raw.transactions) ? raw.transactions : []) {
        if (transaction && typeof transaction === "object") {
          const id = add("transaction", transaction as Raw);
          if (id) enqueue({ path: `/transactions/${id}` });
        }
      }
      for (const payment of Array.isArray(raw.payments) ? raw.payments : []) {
        if (payment && typeof payment === "object") {
          const id = add("transaction", payment as Raw, "", "payment");
          if (id) enqueue({ path: `/transactions/${id}` });
        }
      }
      // Dedicated payments listing is paginated and independently checked.
      enqueue({ path: `${task.path}/payments` });
    } else {
      const id = add("transaction", raw);
      if (id && !/^\/(transactions|transfers)\/\d+$/.test(task.path)) {
        enqueue({
          path: `/${task.path === "/transfers" ? "transfers" : "transactions"}/${id}`,
        });
      }
    }
  }
  if (page.nextPage !== null) enqueue({ ...task, page: page.nextPage });
  snapshot.receipts.push({
    task,
    count: page.data.length,
    fetchedAt: page.fetchedAt,
    nextPage: page.nextPage,
    ids,
  });
  index.done.add(taskKey(task));
}

export async function extract(
  snapshot: Snapshot,
  read: (task: Task) => Promise<PageResult>,
  progress: () => void,
  signal: AbortSignal,
) {
  for (let task = pendingTask(snapshot); task; task = pendingTask(snapshot)) {
    if (signal.aborted)
      throw new Error("Extração interrompida. A prévia parcial pode ser retomada.");
    if (snapshot.receipts.length >= 50000 || snapshot.records.length > 200000) {
      throw new Error(
        "Limite de segurança atingido. Extração parcial; reduza o período.",
      );
    }
    try {
      const page = await read(task);
      acceptPage(snapshot, task, page);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      const optional = task.path === "/transfers" || /\/payments$/.test(task.path) ||
        /^\/(transactions|transfers)\/\d+$/.test(task.path);
      if (!optional || !["upstream_404", "upstream_405", "upstream_410"].includes(code)) throw error;
      (snapshot.unavailable ??= []).push({ task, code });
      indexes(snapshot).done.add(taskKey(task));
    }
    progress();
  }
}
