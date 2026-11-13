"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  RefreshCw,
  Landmark,
  Inbox,
  GitCompareArrows,
  Clock3,
  Ban,
  History,
  SlidersHorizontal,
  Search,
  ChevronDown,
  CheckCheck,
  AlertCircle,
} from "lucide-react";
import { ActionButton, inputClassName } from "@/features/shared/crud-ui";
import { inboxSummary, movementDisposition, type InboxSection } from "../inbox";
import type { PluggyDashboard as Dashboard } from "../service";
import type { InboxReview } from "../types";
import { RulesPanel } from "./classification-rules";
import { InboxMovementRow } from "./inbox-movement";
import { BankConnections } from "./bank-connections";
import { OrganizzeHistory } from "@/features/organizze/components/organizze-history";
import { usePaginationScroll } from "@/features/shared/use-pagination-scroll";
import { InboxCompositionChart } from "./inbox-composition-chart";
import styles from "./inbox-visuals.module.css";
import { RestoreSourceBackups } from "@/features/imports/components/restore-source-backups";

const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Cuiaba" }).format(new Date());
const initialStart = () =>
  new Date(Date.parse(`${today()}T12:00:00Z`) - 45 * 86400000).toISOString().slice(0, 10);
const tabs = [
  { id: "inbox", label: "Caixa de entrada", icon: Inbox },
  { id: "reconciliation", label: "Conciliação", icon: GitCompareArrows },
  { id: "pending", label: "Pendentes", icon: Clock3 },
  { id: "ignored", label: "Ignorados", icon: Ban },
  { id: "history", label: "Histórico Organizze", icon: History },
  { id: "rules", label: "Regras", icon: SlidersHorizontal },
] as const;
type Tab = (typeof tabs)[number]["id"];
const copy = {
  inbox: {
    title: "O que chegou",
    empty: "Tudo conferido por aqui",
    detail:
      "Nenhuma compra ou receita neste filtro. Confira também Conciliação e Pendentes.",
  },
  reconciliation: {
    title: "Compare com o que já existe",
    empty: "Nenhuma correspondência neste filtro",
    detail: "Itens com possíveis vínculos aparecerão aqui para sua conferência.",
  },
  pending: {
    title: "O que precisa de atenção",
    empty: "Sem pendências neste filtro",
    detail:
      "Liquidações, transferências e operações que exigem conferência aparecerão aqui.",
  },
  ignored: {
    title: "Fora dos novos lançamentos",
    empty: "Nenhum item ignorado neste filtro",
    detail: "Pagamentos de fatura e referências continuam preservados na origem.",
  },
};
async function call(body?: unknown, signal?: AbortSignal): Promise<Dashboard> {
  const response = await fetch("/api/pluggy/dashboard", {
    cache: "no-store",
    signal,
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Consulta indisponível.");
  return result;
}

export function FinancialInbox({
  initialPeriod,
}: { initialPeriod?: { start: string; end: string } } = {}) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const [bankErrors, setBankErrors] = useState<Record<string, string>>({});
  const [bank, setBank] = useState("");
  const [tab, setTab] = useState<Tab>("inbox");
  const [start, setStart] = useState(() => initialPeriod?.start ?? initialStart());
  const [end, setEnd] = useState(() => initialPeriod?.end ?? today());
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const [filter, setFilter] = useState("");
  const [mobileFilters, setMobileFilters] = useState(false);
  const [page, setPage] = useState(0);
  const { topRef, bottomRef, changePage } = usePaginationScroll(page);
  const [flow, setFlow] = useState("");
  const [allQueues, setAllQueues] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setBusy("Carregando caixa de entrada…");
      try {
        let result = await call({ action: "refresh" }, controller.signal);
        setData(result);
        const due = result.banks.filter(
          (item) =>
            item.configured &&
            (!item.fetchedAt || Date.now() - Date.parse(item.fetchedAt) >= 86400000),
        );
        // Keep the existing daily read, sequentially, once per opening.
        for (const item of due) {
          if (controller.signal.aborted) return;
          setBusy(`Sincronizando ${item.name}…`);
          try {
            result = await call(
              {
                action: "sync",
                institution: item.id,
                period: { start: initialStart(), end: today() },
                onlyIfDue: true,
              },
              controller.signal,
            );
            setData(result);
          } catch (error) {
            if (!controller.signal.aborted)
              setBankErrors((previous) => ({
                ...previous,
                [item.id]:
                  error instanceof Error ? error.message : "Consulta indisponível.",
              }));
          }
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setFeedback({
            error: true,
            text: error instanceof Error ? error.message : "Falha ao carregar.",
          });
      } finally {
        if (!controller.signal.aborted) setBusy("");
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  async function sync(institution?: string) {
    if (!data || busy || inFlight.current || !start || !end || start > end) return;
    const banks = data.banks.filter(
      (item) => item.configured && (!institution || item.id === institution),
    );
    if (!banks.length) {
      setFeedback({
        error: true,
        text: "Nenhum banco disponível para sincronizar. Confira as conexões abaixo.",
      });
      return;
    }
    inFlight.current = true;
    setFeedback(null);
    let failed = 0;
    try {
      for (const item of banks) {
        setBusy(`Sincronizando ${item.name}…`);
        try {
          setData(
            await call({ action: "sync", institution: item.id, period: { start, end } }),
          );
          setBankErrors((previous) => ({ ...previous, [item.id]: "" }));
        } catch (error) {
          failed++;
          setBankErrors((previous) => ({
            ...previous,
            [item.id]: error instanceof Error ? error.message : "Consulta indisponível.",
          }));
        }
      }
      setFeedback({
        error: failed > 0,
        text: failed
          ? `${failed} conexão(ões) precisam de atenção. As demais foram atualizadas.`
          : "Caixa de entrada atualizada. Nenhum lançamento financeiro foi criado.",
      });
    } finally {
      setBusy("");
      inFlight.current = false;
    }
  }
  async function save(body: unknown) {
    if (busy || inFlight.current) return false;
    inFlight.current = true;
    setBusy("Salvando revisão…");
    setFeedback(null);
    try {
      setData(await call(body));
      setFeedback({
        error: false,
        text: "Revisão salva. Os lançamentos financeiros permanecem preservados.",
      });
      return true;
    } catch (error) {
      setFeedback({
        error: true,
        text: error instanceof Error ? error.message : "Não foi possível salvar.",
      });
      return false;
    } finally {
      setBusy("");
      inFlight.current = false;
    }
  }
  function changeTab(next: Tab) {
    setTab(next);
    setPage(0);
    setFilter("");
    setAllQueues(false);
  }
  const scoped = (data?.movements ?? []).filter(
    (row) =>
      (!bank || row.institutionId === bank) &&
      (!row.date || ((!start || row.date >= start) && (!end || row.date <= end))),
  );
  const counts = inboxSummary(scoped);
  const matchesFlow = (row: Dashboard["movements"][number], value: string) =>
    !value ||
    (value === "income"
      ? row.direction === "CREDIT" && row.accountType === "BANK"
      : value === "card_credit"
        ? row.direction === "CREDIT" && row.accountType === "CREDIT"
        : row.direction === "DEBIT");
  const flowRows = allQueues
    ? scoped
    : scoped.filter((row) => movementDisposition(row).section === tab);
  const receivedIncome = scoped.filter((row) => matchesFlow(row, "income")).length;
  const flowCounts = {
    income: flowRows.filter((row) => matchesFlow(row, "income")).length,
    expense: flowRows.filter((row) => matchesFlow(row, "expense")).length,
    card_credit: flowRows.filter((row) => matchesFlow(row, "card_credit")).length,
  };
  const rows = scoped.filter((row) => {
    const disposition = movementDisposition(row);
    return (
      (allQueues || disposition.section === tab) &&
      matchesFlow(row, flow) &&
      (!kind || row.kind === kind) &&
      (!filter ||
        (filter === "unreviewed"
          ? !row.review.reviewed
          : filter === "matches"
            ? !row.review.targetId
            : filter === "reconciled"
              ? Boolean(row.review.targetId)
              : filter === "automatic"
                ? disposition.automatic
                : filter === "manual"
                  ? !disposition.automatic
                  : filter === "bank_pending"
                    ? row.bankStatus !== "POSTED"
                    : !row.selectedCategoryId || !row.selectedOwnership)) &&
      `${row.description} ${row.bank} ${row.account} ${row.category} ${row.historical.flatMap((reference) => [reference.category, ...reference.tags]).join(" ")}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase())
    );
  });
  const activePage = Math.min(page, Math.max(0, Math.ceil(rows.length / 20) - 1));
  const connected = data?.banks.filter((item) => item.fetchedAt).length ?? 0;
  const timestamps =
    data?.banks.flatMap((item) => (item.fetchedAt ? [item.fetchedAt] : [])).sort() ?? [];
  const latestSync = timestamps.at(-1);
  const failures =
    data?.banks.filter((item) => bankErrors[item.id] || item.state === "needs_attention")
      .length ?? 0;
  const current = ["inbox", "reconciliation", "pending", "ignored"].includes(tab)
    ? (tab as InboxSection)
    : null;

  return (
    <div className={`${styles.surface} min-w-0 space-y-6`}>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href="/dashboard/imports/manual"
            className="mb-2 inline-flex items-center gap-1 text-xs text-ink-600 hover:underline"
          >
            <ArrowLeft className="h-3 w-3" />
            Importar planilha CSV/XLSX
          </Link>
          <h1 className="text-2xl font-semibold">Caixa de Entrada Financeira</h1>
          <p className="mt-1 text-sm text-ink-600">
            Revise o que chegou dos seus bancos antes de levar para o Hub.
          </p>
        </div>
        <ActionButton
          disabled={!data || Boolean(busy) || !start || !end || start > end}
          onClick={() => void sync(bank || undefined)}
        >
          <RefreshCw
            aria-hidden
            className={`mr-2 h-4 w-4 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`}
          />
          Sincronizar novamente
        </ActionButton>
      </header>

      <section
        aria-label="Resumo da caixa de entrada"
        className="grid grid-cols-2 gap-3 border-y border-ink-950/10 py-4 sm:grid-cols-3 xl:grid-cols-6"
      >
        {[
          {
            label: "Bancos conectados",
            value: data ? `${connected} / ${data.banks.length}` : "—",
            note: "Com dados recebidos",
          },
          {
            label: "Última sincronização",
            value: latestSync
              ? new Intl.DateTimeFormat("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "America/Cuiaba",
                }).format(new Date(latestSync))
              : "—",
            note: "Última coleta no Hub",
          },
          {
            label: "Novos itens",
            value: data ? counts.new : "—",
            note: "Compras e receitas a revisar",
          },
          {
            label: "A classificar",
            value: data ? counts.classification : "—",
            note: "Categoria ou titularidade",
          },
          {
            label: "Possíveis correspondências",
            value: data ? counts.matches : "—",
            note: "Conferir antes de cadastrar",
          },
          {
            label: "Ignorados automaticamente",
            value: data ? counts.automatic : "—",
            note: "Fora dos novos lançamentos",
          },
        ].map((item) => (
          <div className={`${styles.metric} min-w-0`} key={item.label}>
            <p className="text-xs text-ink-600">{item.label}</p>
            <p className="mt-2 text-lg font-semibold tabular-nums">
              <strong>{item.value}</strong>
            </p>
            <p className="mt-1 hidden text-xs text-ink-600 sm:block">{item.note}</p>
          </div>
        ))}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-600">
        <span className="inline-flex items-center gap-2">
          <CheckCheck aria-hidden className="h-4 w-4 text-mint-600" />
          Pré-importação · sem novos lançamentos ou reembolsos automáticos
        </span>
        {failures ? (
          <a
            href="#pluggy-connections"
            className="inline-flex items-center gap-1 text-amber-700 underline dark:text-amber-300"
          >
            <AlertCircle className="h-4 w-4" />
            {failures} conexão(ões) precisam de atenção
          </a>
        ) : null}
      </div>
      {feedback ? (
        <div
          role={feedback.error ? "alert" : "status"}
          className={`rounded-md border px-4 py-3 text-sm ${feedback.error ? "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200" : "border-mint-500/30 bg-mint-100 text-mint-600"}`}
        >
          {feedback.text}
        </div>
      ) : null}
      {!data && busy ? (
        <p role="status" className="py-8 text-sm text-ink-600">
          {busy}
        </p>
      ) : null}
      {data && !data.ready ? (
        <p className="border-l-2 border-amber-400 pl-3 text-sm text-ink-600">
          Prévia disponível. O salvamento de revisões e regras ainda está indisponível
          neste ambiente.
        </p>
      ) : null}

      <section className="min-w-0" aria-label="Revisão financeira">
        <div
          className="flex overflow-x-auto border-b border-ink-950/15"
          role="tablist"
          aria-label="Caixa de entrada financeira"
        >
          {tabs.map((item) => (
            <button
              key={item.id}
              id={`tab-${item.id}`}
              type="button"
              role="tab"
              data-section={item.id}
              aria-selected={tab === item.id}
              aria-controls={`panel-${item.id}`}
              tabIndex={tab === item.id ? 0 : -1}
              onKeyDown={(event) => {
                const index = tabs.findIndex((value) => value.id === item.id);
                const next =
                  event.key === "ArrowRight"
                    ? (index + 1) % tabs.length
                    : event.key === "ArrowLeft"
                      ? (index + tabs.length - 1) % tabs.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? tabs.length - 1
                          : -1;
                if (next >= 0) {
                  event.preventDefault();
                  changeTab(tabs[next].id);
                  document.getElementById(`tab-${tabs[next].id}`)?.focus();
                }
              }}
              onClick={() => changeTab(item.id)}
              className={`${styles.tab} inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-mint-500 ${tab === item.id ? "border-mint-500 text-mint-600" : "border-transparent text-ink-600 hover:text-ink-950"}`}
            >
              <item.icon aria-hidden className="h-4 w-4" />
              {item.label}
              {item.id in counts ? (
                <span className="rounded bg-ink-950/5 px-1.5 py-0.5 text-xs tabular-nums">
                  {counts[item.id as InboxSection]}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id={`panel-${tab}`}
          aria-labelledby={`tab-${tab}`}
          className="min-w-0 pt-5"
        >
          {current ? (
            <>
              <div
                ref={topRef}
                className="mb-4 scroll-mt-20 flex flex-wrap items-center justify-between gap-2"
              >
                <h2 className="text-base font-semibold">
                  {allQueues
                    ? "Movimentações recebidas · todas as filas"
                    : copy[current].title}
                </h2>
                <span role="status" aria-live="polite" className="text-xs text-ink-600">
                  {busy || `${rows.length} item(ns) no período`}
                </span>
              </div>
              <div
                className="mb-4 flex flex-wrap gap-2"
                aria-label="Entradas e saídas no período"
              >
                {[
                  ["", "Todos", flowRows.length],
                  ["expense", "Saídas", flowCounts.expense],
                  ["income", "Entradas na conta", flowCounts.income],
                  ["card_credit", "Créditos de cartão", flowCounts.card_credit],
                ].map(([value, label, count]) => (
                  <button
                    type="button"
                    key={String(value)}
                    aria-pressed={flow === value}
                    onClick={() => {
                      setFlow(String(value));
                      setKind("");
                      setPage(0);
                    }}
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium ${flow === value ? "border-mint-500 bg-mint-100 text-mint-600" : "border-ink-950/15 text-ink-600"}`}
                  >
                    {label} <span className="ml-1 tabular-nums">{count}</span>
                  </button>
                ))}
              </div>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-600">
                <p>
                  {current === "pending"
                    ? "Aguardando o banco ou sua revisão: PIX/TED, créditos, ajustes e dados incompletos. O motivo aparece em cada item."
                    : current === "ignored"
                      ? "Referências separadas para evitar despesa ou receita duplicada. Nenhum desses itens foi apagado."
                      : `${receivedIncome} entrada(s) em contas no período, considerando todas as filas. PIX/TED exigem revisão; resgates e pagamentos de fatura ficam separados.`}
                </p>
                <label className="flex shrink-0 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={allQueues}
                    onChange={(event) => {
                      setAllQueues(event.target.checked);
                      setFilter("");
                      setPage(0);
                    }}
                  />
                  Ver todas as filas
                </label>
              </div>
              <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,1.5fr)_1fr_1fr_1fr]">
                <label className="relative">
                  <span className="sr-only">Buscar movimentação</span>
                  <Search
                    aria-hidden
                    className="absolute left-3 top-3.5 h-4 w-4 text-ink-600"
                  />
                  <input
                    className={`${inputClassName} pl-9`}
                    value={search}
                    placeholder="Buscar descrição, categoria ou tag"
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setPage(0);
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-ink-950/15 px-3 py-2 text-sm sm:hidden"
                  aria-expanded={mobileFilters}
                  onClick={() => setMobileFilters(!mobileFilters)}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  {mobileFilters
                    ? "Recolher filtros"
                    : "Filtrar por banco, tipo e período"}
                </button>
                <label className={mobileFilters ? "block" : "hidden sm:block"}>
                  <span className="sr-only">Banco ou cartão</span>
                  <select
                    className={inputClassName}
                    value={bank}
                    onChange={(event) => {
                      setBank(event.target.value);
                      setPage(0);
                    }}
                  >
                    <option value="">Todos os bancos</option>
                    {data?.banks.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={mobileFilters ? "block" : "hidden sm:block"}>
                  <span className="sr-only">Tipo de movimentação</span>
                  <select
                    className={inputClassName}
                    value={kind}
                    onChange={(event) => {
                      setKind(event.target.value);
                      setPage(0);
                    }}
                  >
                    <option value="">Todos os tipos</option>
                    <option value="expense">Compras / despesas</option>
                    <option value="income">Receitas / créditos</option>
                    <option value="invoice_payment">Pagamentos de fatura</option>
                    <option value="card_credit">Créditos / estornos de cartão</option>
                    <option value="unknown">Não identificados</option>
                  </select>
                </label>
                <label className={mobileFilters ? "block" : "hidden sm:block"}>
                  <span className="sr-only">Situação</span>
                  <select
                    className={inputClassName}
                    value={filter}
                    onChange={(event) => {
                      setFilter(event.target.value);
                      setPage(0);
                    }}
                  >
                    <option value="">Todas as situações</option>
                    {current === "inbox" ? (
                      <>
                        <option value="unreviewed">Ainda não revisados</option>
                        <option value="classification">
                          Categoria / titularidade pendente
                        </option>
                      </>
                    ) : current === "reconciliation" ? (
                      <>
                        <option value="matches">Correspondências a revisar</option>
                        <option value="reconciled">Já conciliados</option>
                      </>
                    ) : current === "ignored" ? (
                      <>
                        <option value="automatic">Ignorados automaticamente</option>
                        <option value="manual">Ignorados na revisão</option>
                      </>
                    ) : (
                      <option value="bank_pending">Aguardando o banco</option>
                    )}
                  </select>
                </label>
              </div>
              <div
                className={`mb-4 flex-wrap items-end gap-3 ${mobileFilters ? "flex" : "hidden sm:flex"}`}
              >
                <label className="text-xs text-ink-600">
                  De
                  <input
                    className={`${inputClassName} mt-1 max-w-44`}
                    type="date"
                    value={start}
                    max={end}
                    onChange={(event) => {
                      setStart(event.target.value);
                      setPage(0);
                    }}
                  />
                </label>
                <label className="text-xs text-ink-600">
                  Até
                  <input
                    className={`${inputClassName} mt-1 max-w-44`}
                    type="date"
                    value={end}
                    min={start}
                    max={today()}
                    onChange={(event) => {
                      setEnd(event.target.value);
                      setPage(0);
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="px-2 py-3 text-xs text-ink-600 underline"
                  onClick={() => {
                    setBank("");
                    setSearch("");
                    setKind("");
                    setFilter("");
                    setFlow("");
                    setAllQueues(false);
                    setStart(initialStart());
                    setEnd(today());
                    setPage(0);
                  }}
                >
                  Limpar filtros
                </button>
              </div>
              <div className="mb-4">
                <InboxCompositionChart rows={rows} />
              </div>
              <div
                className="rounded-md border border-ink-950/15 bg-[var(--hub-surface)]"
                aria-busy={Boolean(busy)}
              >
                <div className="hidden grid-cols-[6rem_minmax(0,1.6fr)_minmax(0,1fr)_7.5rem_8rem_11rem_6.5rem] gap-x-3 border-b border-ink-950/10 bg-[var(--hub-surface-muted)] px-4 py-2 text-xs font-medium text-ink-600 xl:grid">
                  <span>Data</span>
                  <span>Descrição</span>
                  <span>Banco / cartão</span>
                  <span className="text-right">Valor</span>
                  <span>Tipo</span>
                  <span>Situação</span>
                  <span className="text-center">Ação</span>
                </div>
                {data
                  ? rows.slice(activePage * 20, activePage * 20 + 20).map((row) => (
                      <InboxMovementRow
                        key={`${row.sourceKey}:${row.review.updatedAt ?? "preview"}`}
                        row={row}
                        categories={data.categories}
                        disabled={Boolean(busy) || !data.ready || !row.review.updatedAt}
                        onSave={(review: InboxReview) =>
                          save({
                            action: "review",
                            confirm: true,
                            sourceKey: row.sourceKey,
                            expectedUpdatedAt: row.review.updatedAt,
                            review,
                          })
                        }
                      />
                    ))
                  : null}
                {!rows.length ? (
                  <div className="px-6 py-14 text-center">
                    <Inbox aria-hidden className="mx-auto mb-3 h-7 w-7 text-ink-600" />
                    <p className="text-sm font-medium">
                      {data ? copy[current].empty : "Aguardando os dados"}
                    </p>
                    <p className="mx-auto mt-2 max-w-md text-sm text-ink-600">
                      {data
                        ? copy[current].detail
                        : "Carregue a caixa de entrada para revisar as movimentações."}
                    </p>
                    {feedback?.error && !data ? (
                      <ActionButton
                        className="mt-4"
                        disabled={Boolean(busy)}
                        onClick={() => {
                          setBusy("Carregando…");
                          void call()
                            .then(setData)
                            .catch((error) =>
                              setFeedback({ error: true, text: error.message }),
                            )
                            .finally(() => setBusy(""));
                        }}
                      >
                        Tentar novamente
                      </ActionButton>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {rows.length > 0 ? (
                <div
                  ref={bottomRef}
                  className="mt-4 flex scroll-mb-6 flex-wrap items-center justify-between gap-3 text-xs text-ink-600"
                >
                  <span>
                    {activePage * 20 + 1}–{Math.min((activePage + 1) * 20, rows.length)}{" "}
                    de {rows.length}
                  </span>
                  <div className="flex items-center gap-3">
                    <ActionButton
                      variant="secondary"
                      disabled={activePage === 0}
                      onClick={() => changePage(() => setPage(activePage - 1))}
                    >
                      Anterior
                    </ActionButton>
                    <span>
                      {activePage + 1} / {Math.ceil(rows.length / 20)}
                    </span>
                    <ActionButton
                      variant="secondary"
                      disabled={(activePage + 1) * 20 >= rows.length}
                      onClick={() => changePage(() => setPage(activePage + 1))}
                    >
                      Próxima
                    </ActionButton>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
          {tab === "history" ? <OrganizzeHistory embedded /> : null}
          {tab === "rules" && data ? (
            <RulesPanel
              data={data}
              disabled={Boolean(busy) || !data.ready}
              onSave={(rule) => void save({ action: "rule", confirm: true, rule })}
            />
          ) : null}
        </div>
      </section>
      {data ? (
        <details
          id="pluggy-connections"
          className="group border-t border-ink-950/15 pt-4"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium">
            <span className="inline-flex items-center gap-2">
              <Landmark aria-hidden className="h-4 w-4" />
              Conexões e produtos bancários{" "}
              <span className="font-normal text-ink-600">{connected} com dados</span>
            </span>
            <ChevronDown
              aria-hidden
              className="h-4 w-4 transition-transform group-open:rotate-180"
            />
          </summary>
          <BankConnections
            data={data}
            busy={Boolean(busy)}
            errors={bankErrors}
            onSync={(institution) => void sync(institution)}
            onSelect={(institution) => {
              setBank(institution);
              changeTab("inbox");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        </details>
      ) : null}
      <RestoreSourceBackups />
    </div>
  );
}
