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
import {
  inboxSummary,
  movementDisposition,
  pendingBankSummary,
  type InboxSection,
} from "../inbox";
import { readSyncResponse, type SyncProgress } from "../sync-progress";
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
  { id: "pending", label: "Revisar", icon: Clock3 },
  { id: "ignored", label: "Ignorados", icon: Ban },
  { id: "history", label: "Histórico Organizze", icon: History },
  { id: "rules", label: "Classificar em lote", icon: SlidersHorizontal },
] as const;
type Tab = (typeof tabs)[number]["id"];
const copy = {
  inbox: {
    title: "O que chegou",
    empty: "Tudo conferido por aqui",
    detail: "Nenhuma compra ou receita neste filtro.",
  },
  reconciliation: {
    title: "Compare com o que já existe",
    empty: "Nenhuma correspondência neste filtro",
    detail: "Itens com possíveis vínculos aparecerão aqui para sua conferência.",
  },
  pending: {
    title: "O que precisa de atenção",
    empty: "Sem pendências neste filtro",
    detail: "Transferências, ajustes e itens adiados aparecerão aqui.",
  },
  ignored: {
    title: "Fora dos novos lançamentos",
    empty: "Nenhum item ignorado neste filtro",
    detail: "Pagamentos de fatura e referências continuam preservados na origem.",
  },
};
async function call(
  body?: unknown,
  signal?: AbortSignal,
  onProgress?: (progress: SyncProgress) => void,
): Promise<Dashboard> {
  const response = await fetch("/api/pluggy/dashboard", {
    cache: "no-store",
    signal,
    ...(body
      ? {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(onProgress ? { Accept: "application/x-ndjson" } : {}),
          },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (onProgress) return readSyncResponse<Dashboard>(response, onProgress);
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
  const openingPeriod = useRef(initialPeriod ?? { start: initialStart(), end: today() });
  const [progress, setProgress] = useState<{
    bank: string;
    detail: string;
    percent: number;
    completed: number;
    total: number;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setBusy("Carregando caixa de entrada…");
      try {
        let result = await call(undefined, controller.signal);
        setData(result);
        if (result.stagingPending) {
          setBusy("Atualizando revisões da caixa de entrada…");
          result = await call({ action: "refresh" }, controller.signal);
          setData(result);
        }
        const due = result.banks.filter(
          (item) =>
            item.configured &&
            (!item.fetchedAt ||
              Date.now() - Date.parse(item.fetchedAt) >= 86400000 ||
              (item.collectedPeriod &&
                (item.collectedPeriod.start > openingPeriod.current.start ||
                  item.collectedPeriod.end < openingPeriod.current.end))),
        );
        // Keep the existing daily read, sequentially, once per opening.
        for (const [index, item] of due.entries()) {
          if (controller.signal.aborted) return;
          setBusy(`Sincronizando ${item.name}…`);
          setProgress({
            bank: item.name,
            detail: "Conectando ao Meu Pluggy",
            percent: 0,
            completed: index,
            total: due.length,
          });
          try {
            result = await call(
              {
                action: "sync",
                institution: item.id,
                period: openingPeriod.current,
                onlyIfDue: true,
              },
              controller.signal,
              (value) =>
                setProgress({
                  bank: item.name,
                  detail: value.message,
                  percent: value.percent,
                  completed: index,
                  total: due.length,
                }),
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
          if (!controller.signal.aborted)
            setProgress({
              bank: item.name,
              detail: "Consulta desta conexão finalizada",
              percent: 100,
              completed: index,
              total: due.length,
            });
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
    let result = data;
    const before = new Map(data.movements.map((row) => [row.sourceKey, row]));
    try {
      for (const [index, item] of banks.entries()) {
        setBusy(`Sincronizando ${item.name}…`);
        setProgress({
          bank: item.name,
          detail: "Conectando ao Meu Pluggy",
          percent: 0,
          completed: index,
          total: banks.length,
        });
        try {
          result = await call(
            { action: "sync", institution: item.id, period: { start, end } },
            undefined,
            (value) =>
              setProgress({
                bank: item.name,
                detail: value.message,
                percent: value.percent,
                completed: index,
                total: banks.length,
              }),
          );
          setData(result);
          setBankErrors((previous) => ({ ...previous, [item.id]: "" }));
        } catch (error) {
          failed++;
          setBankErrors((previous) => ({
            ...previous,
            [item.id]: error instanceof Error ? error.message : "Consulta indisponível.",
          }));
        }
        setProgress({
          bank: item.name,
          detail: "Consulta desta conexão finalizada",
          percent: 100,
          completed: index,
          total: banks.length,
        });
      }
      const added = result.movements.filter((row) => !before.has(row.sourceKey)).length;
      const updated = result.movements.filter((row) => {
        const old = before.get(row.sourceKey);
        return (
          old &&
          (old.bankStatus !== row.bankStatus ||
            old.amount !== row.amount ||
            old.date !== row.date)
        );
      }).length;
      const partial = result.banks.filter(
        (item) =>
          banks.some((selected) => selected.id === item.id) && item.state === "partial",
      ).length;
      setFeedback({
        error: failed > 0 || partial > 0,
        text: failed
          ? `${failed} conexão(ões) falharam; os dados anteriores foram mantidos. ${added} novos movimentos recebidos nas demais.`
          : `Consulta concluída: ${added} novos movimentos e ${updated} atualizados.${partial ? ` ${partial} conexão(ões) têm produtos indisponíveis; confira Conexões e produtos bancários.` : ""} Os lançamentos já cadastrados foram preservados; consultar os bancos não importa novos lançamentos financeiros.`,
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
  const pendingBank = pendingBankSummary(scoped);
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
                    : filter === "manual_review"
                      ? disposition.section === "pending"
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
    data?.banks.filter(
      (item) =>
        bankErrors[item.id] || ["needs_attention", "partial"].includes(item.state),
    ).length ?? 0;
  const current = ["inbox", "reconciliation", "pending", "ignored"].includes(tab)
    ? (tab as InboxSection)
    : null;

  return (
    <div className={`${styles.surface} min-w-0 space-y-6`}>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <details className="mb-3 text-xs text-ink-600">
            <summary className="cursor-pointer">Fontes e arquivos</summary>
            <nav
              aria-label="Fontes de importação"
              className="mt-3 flex flex-wrap items-center gap-4 text-sm"
            >
              <button
                type="button"
                className="inline-flex items-center gap-1 font-semibold text-mint-600 underline-offset-4 hover:underline"
                onClick={() => {
                  const connections = document.getElementById("pluggy-connections");
                  if (connections instanceof HTMLDetailsElement) {
                    connections.open = true;
                    connections.scrollIntoView({ behavior: "smooth", block: "start" });
                  }
                }}
                disabled={!data}
              >
                <Landmark className="h-4 w-4" aria-hidden />
                Conexões Pluggy / bancos
              </button>
              <Link
                href="/dashboard/imports/organizze"
                className="font-semibold text-mint-600 underline-offset-4 hover:underline"
              >
                Organizze — extrair e importar
              </Link>
              <Link
                href="/dashboard/imports/manual"
                className="mb-2 inline-flex items-center gap-1 text-xs text-ink-600 hover:underline"
              >
                <ArrowLeft className="h-3 w-3" />
                Importar planilha CSV/XLSX
              </Link>
            </nav>
          </details>
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
        className="grid grid-cols-3 gap-3 border-y border-ink-950/10 py-4"
      >
        {[
          {
            label: "Na entrada",
            value: data ? counts.inbox : "—",
            note: `${counts.new} ainda não revisados`,
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
        <span>
          {connected} bancos com dados · Última consulta no Hub:{" "}
          {latestSync
            ? new Intl.DateTimeFormat("pt-BR", {
                dateStyle: "short",
                timeStyle: "short",
                timeZone: "America/Cuiaba",
              }).format(new Date(latestSync))
            : "ainda não consultado"}
        </span>
        <button
          type="button"
          className="font-semibold text-sky-700 underline dark:text-sky-300"
          onClick={() => changeTab("rules")}
        >
          Aproveitar categorias do Organizze
        </button>
      </div>

      {progress && busy ? (
        <section
          aria-label="Progresso da sincronização"
          className="rounded-md border border-sky-500/30 bg-sky-50 p-4 dark:bg-sky-950/30"
          aria-busy={Boolean(busy)}
        >
          <div className="flex items-center justify-between gap-3 text-sm font-semibold">
            <span>{busy ? progress.bank : "Consulta finalizada"}</span>
            <span className="tabular-nums">
              {Math.floor(
                ((progress.completed + progress.percent / 100) / progress.total) * 100,
              )}
              %
            </span>
          </div>
          <progress
            className="mt-2 h-2 w-full accent-sky-600"
            aria-label="Etapas de consulta concluídas"
            max={100}
            value={((progress.completed + progress.percent / 100) / progress.total) * 100}
          />
          <p role="status" className="mt-2 text-xs text-ink-600">
            {busy
              ? progress.detail
              : "Consulte o resultado abaixo; conexões com erro mantêm a origem anterior."}
          </p>
          <p className="mt-1 text-xs text-ink-600">
            {progress.completed + (progress.percent === 100 ? 1 : 0)} de {progress.total}{" "}
            conexões consultadas · progresso por etapas, não por tempo restante.
          </p>
        </section>
      ) : null}

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
                    ? "Dúvidas sobre transferências, ajustes ou itens que você adiou."
                    : current === "ignored"
                      ? "Referências separadas para evitar despesa ou receita duplicada. Nenhum desses itens foi apagado."
                      : current === "inbox"
                        ? `${pendingBank.cards} movimentos de cartões em fatura aberta ou parcela futura, disponíveis para classificar.`
                        : "Vínculos só são feitos após sua confirmação."}
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
              <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,1.5fr)_1fr_auto]">
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
                  className="order-3 inline-flex items-center justify-center gap-2 rounded-md border border-ink-950/15 px-3 py-2 text-sm"
                  aria-expanded={mobileFilters}
                  onClick={() => setMobileFilters(!mobileFilters)}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  {mobileFilters ? "Recolher filtros" : "Mais filtros"}
                </button>
                <label>
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
                <label className={mobileFilters ? "order-4 block" : "hidden"}>
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
                <label className={mobileFilters ? "order-5 block" : "hidden"}>
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
                        <option value="bank_pending">
                          Fatura aberta / em processamento
                        </option>
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
                      <>
                        <option value="bank_pending">
                          PENDING · fatura aberta / processamento
                        </option>
                        <option value="manual_review">Precisa da minha revisão</option>
                      </>
                    )}
                  </select>
                </label>
              </div>
              <div
                className={`mb-4 flex-wrap items-end gap-3 ${mobileFilters ? "flex" : "hidden"}`}
              >
                <div className="flex flex-wrap gap-2 text-xs">
                  <button
                    type="button"
                    className="rounded border px-3 py-2"
                    onClick={() => {
                      setStart(today().slice(0, 8) + "01");
                      setEnd(today());
                      setPage(0);
                    }}
                  >
                    Este mês
                  </button>
                  <button
                    type="button"
                    className="rounded border px-3 py-2"
                    onClick={() => {
                      setStart(initialStart());
                      setEnd(today());
                      setPage(0);
                    }}
                  >
                    Últimos 45 dias
                  </button>
                </div>
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
              <p className="mb-3 text-xs text-ink-600">
                {start ? start.split("-").reverse().join("/") : "Início do histórico"} a{" "}
                {end ? end.split("-").reverse().join("/") : "hoje"}
              </p>
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
                        disabled={Boolean(busy) || !data.ready || data.stagingPending || !row.review.updatedAt}
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
              disabled={Boolean(busy) || !data.ready || data.stagingPending}
              onSave={(rule) => save({ action: "rule", confirm: true, rule })}
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
