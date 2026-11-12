import "server-only";

import type { PageResult, Task } from "./types";

const BASE = "https://api.organizze.com.br/rest/v2";
const READ_PATH =
  /^\/(accounts|categories|credit_cards|transactions|transfers)$|^\/(transactions|transfers)\/[1-9]\d*$|^\/credit_cards\/[1-9]\d*\/invoices(?:\/[1-9]\d*(?:\/payments)?)?$/;

export class OrganizzeError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 502,
  ) {
    super(code);
  }
}

export function validateTask(task: Task) {
  if (!task || typeof task.path !== "string" || !READ_PATH.test(task.path))
    throw new OrganizzeError("invalid_path", 400);
  if (
    task.page !== undefined &&
    (!Number.isSafeInteger(task.page) || task.page < 1 || task.page > 10000)
  ) {
    throw new OrganizzeError("invalid_page", 400);
  }
  const dated =
    ["/transactions", "/transfers"].includes(task.path) ||
    /^\/credit_cards\/\d+\/invoices$/.test(task.path);
  if (dated && !task.period) throw new OrganizzeError("period_required", 400);
  if (task.period) {
    const { start, end } = task.period;
    if (
      ![start, end].every(validDate) ||
      start > end ||
      start.slice(0, 7) !== end.slice(0, 7)
    ) {
      throw new OrganizzeError("invalid_period", 400);
    }
  }
}

function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

export function createOrganizzeReader(
  config: { email: string; apiKey: string; userAgent: string },
  transport: typeof fetch = fetch,
) {
  if (
    !config.email ||
    !config.apiKey ||
    !config.userAgent ||
    /[\r\n]/.test(config.userAgent)
  ) {
    throw new OrganizzeError("not_configured", 503);
  }
  const authorization = `Basic ${Buffer.from(`${config.email}:${config.apiKey}`).toString("base64")}`;

  // No caller-controlled URL, HTTP method, headers, redirects or request body.
  return async function read(task: Task): Promise<PageResult> {
    validateTask(task);
    const url = new URL(`${BASE}${task.path}`);
    if (task.period) {
      url.searchParams.set("start_date", task.period.start);
      url.searchParams.set("end_date", task.period.end);
    }
    url.searchParams.set("page", String(task.page ?? 1));
    let response: Response;
    try {
      response = await transport(url, {
        method: "GET",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
        headers: {
          Authorization: authorization,
          "User-Agent": config.userAgent,
          Accept: "application/json",
        },
      });
    } catch {
      throw new OrganizzeError("upstream_unavailable");
    }
    if (!response.ok) {
      // Never return upstream bodies, request headers or credential-bearing errors.
      throw new OrganizzeError(
        response.status === 401
          ? "credentials_rejected"
          : response.status === 429
            ? "rate_limited"
            : `upstream_${response.status}`,
      );
    }
    let body: unknown;
    try {
      const reader = response.body?.getReader();
      if (!reader) throw new Error("empty_body");
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 8 * 1024 * 1024) {
          await reader.cancel();
          throw new Error("response_too_large");
        }
        chunks.push(chunk.value);
      }
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new OrganizzeError("invalid_response");
    }
    const data = Array.isArray(body) ? body : [body];
    if (data.some((row) => !row || typeof row !== "object" || Array.isArray(row)))
      throw new OrganizzeError("invalid_response");
    const links = response.headers.get("link") ?? "";
    const next = links.split(/,(?=\s*<)/).filter((part) => {
      const rel = part.match(/;\s*rel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;\s]+))/i);
      return (rel?.[1] ?? rel?.[2] ?? rel?.[3] ?? "").split(/\s+/).includes("next");
    });
    if (next.length > 1) throw new OrganizzeError("invalid_pagination");
    let nextPage: number | null = null;
    if (next.length) {
      const match = next[0].match(/<([^>]+)>/);
      if (!match) throw new OrganizzeError("invalid_pagination");
      const target = new URL(match[1], url);
      // Some Organizze links append a second page parameter to an invalid
      // existing value. Never follow that URL: recover only the unambiguous
      // next integer, then rebuild the request from our pinned task/period.
      const pages = target.searchParams.getAll("page");
      const numericPages = pages.filter((value) => /^[1-9]\d*$/.test(value)).map(Number);
      nextPage = numericPages.length ? numericPages[0] : NaN;
      const allowed = new Set([...url.searchParams.keys()]);
      if (
        target.origin !== url.origin ||
        target.pathname !== url.pathname ||
        target.username ||
        target.password ||
        target.hash ||
        numericPages.some((page) => page !== nextPage) ||
        !Number.isSafeInteger(nextPage) ||
        nextPage !== (task.page ?? 1) + 1 ||
        nextPage > 10000 ||
        [...target.searchParams.keys()].some((key) => !allowed.has(key)) ||
        [...url.searchParams].some(
          ([key, value]) => key !== "page" &&
            (target.searchParams.getAll(key).length === 0 ||
              target.searchParams.getAll(key).some((actual) => actual !== value)),
        )
      ) {
        throw new OrganizzeError("invalid_pagination");
      }
    }
    // A list's empty page is its EOF. The live transfers endpoint keeps
    // advertising next even after multiple empty pages; following that forever
    // would never finish a backup. Retain the explicit protocol warning.
    const emptyNext = data.length === 0 && nextPage !== null;
    return { data, nextPage: emptyNext ? null : nextPage, fetchedAt: new Date().toISOString(),
      ...(emptyNext ? { warnings: [`${task.path} (${task.period?.start ?? "cadastro"}, página ${task.page ?? 1}): resposta vazia encerrou a paginação, apesar do next anunciado pela API.`] } : {}),
    };
  };
}
