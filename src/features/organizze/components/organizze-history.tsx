"use client";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, History, Tags, FolderTree } from "lucide-react";
import { ActionButton, inputClassName } from "@/features/shared/crud-ui";
import { usePaginationScroll } from "@/features/shared/use-pagination-scroll";
import { BankBadge } from "@/features/pluggy/components/bank-badge";
import { dateLabel, money } from "@/features/pluggy/components/inbox-movement";
import type { OrganizzeHistory as HistoryData } from "../history";

export function OrganizzeHistory({ embedded = false }: { embedded?: boolean }) {
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [tag, setTag] = useState("");
  const [view, setView] = useState<"movements" | "categories" | "tags">("movements");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const { topRef, bottomRef, changePage } = usePaginationScroll(page);
  const load = useCallback(async (signal?: AbortSignal) => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/organizze/history", {
        cache: "no-store",
        signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Histórico indisponível.");
      setHistory(body);
      setPage(0);
    } catch (error) {
      if (!signal?.aborted)
        setMessage(
          error instanceof Error
            ? error.message
            : "Não foi possível consultar o histórico.",
        );
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const rows = (history?.movements ?? []).filter(
    (row) =>
      (!category || row.categoryId === category) &&
      (!tag || row.tags.includes(tag)) &&
      `${row.description} ${row.account} ${row.categoryPath} ${row.tags.join(" ")}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  const activePage = Math.min(page, Math.max(0, Math.ceil(rows.length / 25) - 1));
  return (
    <div ref={topRef} className="min-w-0 scroll-mt-20 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {embedded ? (
            <h2 className="text-base font-semibold">Histórico Organizze</h2>
          ) : (
            <h1 className="text-2xl font-semibold">Histórico Organizze</h1>
          )}
          <p className="mt-1 text-sm text-ink-600">
            Categorias, tags e movimentações preservadas como referência.
          </p>
        </div>
        <ActionButton variant="secondary" disabled={busy} onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {busy ? "Carregando…" : "Atualizar leitura do backup"}
        </ActionButton>
      </header>
      {message ? (
        <p role="alert" className="border-l-2 border-amber-400 pl-3 text-sm">
          {message} O histórico não é baixado novamente dos bancos ao abrir esta aba.
        </p>
      ) : null}
      {history ? (
        <>
          <div className="border-y border-ink-950/10 py-3 text-sm">
            <p className="font-medium">
              Histórico já carregado · {history.movements.length} movimentações ·{" "}
              {history.categories.length} categorias · {history.tags.length} tags
            </p>
            <p className="mt-1 text-xs text-ink-600">
              Período do arquivo: {dateLabel(history.period.start)} a{" "}
              {dateLabel(history.period.end)}. Fora dos totais do Hub até sua revisão
              financeira.
            </p>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Conteúdo do Organizze">
            {[
              { id: "movements", label: "Movimentações", icon: History },
              { id: "categories", label: "Categorias", icon: FolderTree },
              { id: "tags", label: "Tags", icon: Tags },
            ].map((item) => (
              <button
                type="button"
                aria-pressed={view === item.id}
                key={item.id}
                onClick={() => setView(item.id as typeof view)}
                className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${view === item.id ? "border-mint-500 bg-mint-100 text-mint-600" : "border-ink-950/15"}`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </button>
            ))}
          </div>
          {view === "categories" ? (
            <ul className="grid gap-x-5 divide-y divide-ink-950/10 sm:grid-cols-2">
              {history.categories.map((item) => (
                <li key={item.id} className="py-3 text-sm">
                  <button
                    type="button"
                    className="text-left hover:underline"
                    onClick={() => {
                      setCategory(item.id);
                      setTag("");
                      setView("movements");
                      setPage(0);
                    }}
                  >
                    {item.parentId ? (
                      <span className="text-xs text-ink-600">
                        {history.categories.find((parent) => parent.id === item.parentId)
                          ?.name ?? "Categoria superior"}{" "}
                        /{" "}
                      </span>
                    ) : null}
                    {item.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {view === "tags" ? (
            <div className="flex flex-wrap gap-2">
              {history.tags.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="rounded border border-ink-950/15 px-3 py-2 text-sm hover:bg-mint-100"
                  onClick={() => {
                    setTag(item);
                    setCategory("");
                    setView("movements");
                    setPage(0);
                  }}
                >
                  #{item}{" "}
                  <span className="text-xs text-ink-600">
                    {history.movements.filter((row) => row.tags.includes(item)).length}
                  </span>
                </button>
              ))}
              {!history.tags.length ? (
                <p className="text-sm text-ink-600">
                  Nenhuma tag informada nos registros de origem.
                </p>
              ) : null}
            </div>
          ) : null}
          {view === "movements" ? (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <label>
                  <span className="sr-only">Buscar no histórico Organizze</span>
                  <input
                    className={inputClassName}
                    placeholder="Descrição, categoria ou tag"
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setPage(0);
                    }}
                  />
                </label>
                <label>
                  <span className="sr-only">Categoria Organizze</span>
                  <select
                    className={inputClassName}
                    value={category}
                    onChange={(event) => {
                      setCategory(event.target.value);
                      setPage(0);
                    }}
                  >
                    <option value="">Todas as categorias</option>
                    {history.categories.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.parentId
                          ? `${history.categories.find((parent) => parent.id === item.parentId)?.name ?? ""} / `
                          : ""}
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="sr-only">Tag Organizze</span>
                  <select
                    className={inputClassName}
                    value={tag}
                    onChange={(event) => {
                      setTag(event.target.value);
                      setPage(0);
                    }}
                  >
                    <option value="">Todas as tags</option>
                    {history.tags.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="text-xs text-ink-600">
                {rows.length} registros de referência · sem atribuição automática de
                titularidade
              </p>
              <div className="divide-y divide-ink-950/10 border-y border-ink-950/10">
                {rows.slice(activePage * 25, activePage * 25 + 25).map((row) => (
                  <article
                    key={row.sourceKey}
                    className="grid min-w-0 gap-2 py-3 text-sm md:grid-cols-[6rem_minmax(0,1fr)_10rem_8rem]"
                  >
                    <p className="text-xs text-ink-600">{dateLabel(row.date)}</p>
                    <div className="min-w-0">
                      <p className="break-words font-medium">{row.description}</p>
                      <p className="mt-1 text-xs text-ink-600">{row.categoryPath}</p>
                      {row.tags.length ? (
                        <p className="mt-1 break-words text-xs text-mint-600">
                          {row.tags.map((value) => `#${value}`).join(" · ")}
                        </p>
                      ) : null}
                    </div>
                    <BankBadge bank={row.account} accountType={row.accountType} />
                    <p className="font-semibold tabular-nums md:text-right">
                      {money(row.amountCents / 100)}
                    </p>
                  </article>
                ))}
              </div>
              {!rows.length ? (
                <p className="py-6 text-sm text-ink-600">
                  Nenhum registro corresponde aos filtros.
                </p>
              ) : null}
              <div
                ref={bottomRef}
                className="flex scroll-mb-6 flex-wrap items-center justify-between gap-3 text-xs text-ink-600"
              >
                <span>
                  {rows.length ? activePage * 25 + 1 : 0}–
                  {Math.min((activePage + 1) * 25, rows.length)} de {rows.length}
                </span>
                <div className="flex items-center gap-3">
                  <ActionButton
                    variant="secondary"
                    disabled={!activePage}
                    onClick={() => changePage(() => setPage(activePage - 1))}
                  >
                    Anterior
                  </ActionButton>
                  <span>
                    {activePage + 1} / {Math.max(1, Math.ceil(rows.length / 25))}
                  </span>
                  <ActionButton
                    variant="secondary"
                    disabled={(activePage + 1) * 25 >= rows.length}
                    onClick={() => changePage(() => setPage(activePage + 1))}
                  >
                    Próxima
                  </ActionButton>
                </div>
              </div>
            </>
          ) : null}
        </>
      ) : busy ? (
        <p role="status" className="py-5 text-sm text-ink-600">
          Lendo histórico, categorias e tags…
        </p>
      ) : null}
    </div>
  );
}
