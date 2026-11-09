"use client";

import Link from "next/link";
import { useState } from "react";
import { Landmark, CreditCard, ArrowDownUp, ShieldCheck } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { ActionButton, inputClassName } from "@/features/shared/crud-ui";
import { usePaginationScroll } from "@/features/shared/use-pagination-scroll";
import type { ConnectionStatus } from "../types";
import type { PluggyPreview } from "../preview";

const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Cuiaba" }).format(new Date());
const money = (amount: number | null, currency = "BRL") =>
  amount === null
    ? "Não informado"
    : new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: /^[A-Z]{3}$/.test(currency) ? currency : "BRL",
      }).format(amount);
const statuses: Record<string, string> = {
  possible_match: "Possível correspondência",
  historical_reference: "Referência Organizze",
  pending_classification: "Pendente de classificação",
};
async function read<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Falha na consulta.");
  return body;
}

export function PluggyWorkbench() {
  const [connection, setConnection] = useState<ConnectionStatus | null>(null);
  const [preview, setPreview] = useState<PluggyPreview | null>(null);
  const [start, setStart] = useState(() => `${today().slice(0, 7)}-01`);
  const [end, setEnd] = useState(today);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [account, setAccount] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const { topRef, bottomRef, changePage } = usePaginationScroll(page);
  async function run(action: "status" | "backup" | "preview") {
    setBusy(true);
    setMessage("");
    try {
      if (action === "status") {
        const status = await read<ConnectionStatus>("/api/pluggy");
        setConnection(status);
        setMessage(
          status.configured
            ? "Configuração presente. Carregue uma prévia para validar o acesso ao Nubank."
            : `Falta configurar no servidor: ${status.missing.join(", ")}.`,
        );
      } else {
        const result = await read<{ preview: PluggyPreview }>(
          action === "backup" ? "/api/pluggy?action=backup" : "/api/pluggy",
          action === "preview"
            ? {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action,
                  period: { start, end },
                  nubankConfirmed: confirmed,
                }),
              }
            : undefined,
        );
        setPreview(result.preview);
        setPage(0);
        setAccount("");
        setFilter("");
        setMessage(
          action === "preview"
            ? "Prévia salva em backup local. Zero lançamentos financeiros criados ou alterados."
            : "Backup local carregado; correspondências recalculadas com o Hub atual.",
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha na consulta.");
    } finally {
      setBusy(false);
    }
  }
  const rows = (preview?.movements ?? []).filter(
    (row) =>
      (!account || row.accountId === account) &&
      (!filter || row.status === filter) &&
      `${row.description} ${row.category} ${row.id} ${row.historical.flatMap((item) => [item.category, ...item.tags]).join(" ")}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  return (
    <div ref={topRef} className="scroll-mt-20 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Meu Pluggy · Nubank</h1>
          <p className="mt-1 text-sm text-ink-600 dark:text-slate-300">
            Contas, cartões e movimentações para conferência.
          </p>
        </div>
        <StatusBadge tone="info">
          <ShieldCheck className="mr-1 h-4 w-4" /> Somente leitura e prévia
        </StatusBadge>
      </div>
      <SectionCard
        title="Conectar pelo Meu Pluggy"
        description="Use sua conexão pessoal gratuita e a aplicação demo. O consentimento do Nubank é feito no Meu Pluggy."
      >
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-6">
          <li>
            <a
              className="underline"
              href="https://meu.pluggy.ai/"
              target="_blank"
              rel="noreferrer"
            >
              Abra o Meu Pluggy
            </a>{" "}
            e conecte somente o Nubank, aprovando o acesso no banco.
          </li>
          <li>
            No{" "}
            <a
              className="underline"
              href="https://dashboard.pluggy.ai/"
              target="_blank"
              rel="noreferrer"
            >
              Dashboard Pluggy
            </a>
            , abra a aplicação demo, selecione o conector <strong>Meu Pluggy</strong> e
            escolha sua conexão Nubank.
          </li>
          <li>
            Configure no servidor o Client ID, o Client Secret e o ID desse item proxy. As
            credenciais ficam fora do navegador. Veja{" "}
            <a
              className="underline"
              href="https://meu.pluggy.ai/api-guide"
              target="_blank"
              rel="noreferrer"
            >
              o guia oficial
            </a>
            .
          </li>
        </ol>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <ActionButton onClick={() => void run("status")} disabled={busy}>
            Verificar configuração
          </ActionButton>
          {connection ? (
            <StatusBadge tone={connection.configured ? "success" : "warning"}>
              {connection.configured
                ? "Configuração presente; acesso ainda precisa de prévia"
                : "Configuração pendente"}
            </StatusBadge>
          ) : null}
          <Link className="text-sm underline" href="/dashboard/imports/organizze/history">
            Consultar histórico Organizze
          </Link>
        </div>
      </SectionCard>
      <SectionCard
        title="Carregar dados disponíveis"
        description="O Meu Pluggy atualiza a conexão diariamente. Este botão consulta os dados já disponíveis; não força atualização no banco e não importa para o financeiro."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            De
            <input
              type="date"
              className={`${inputClassName} mt-1`}
              value={start}
              max={end}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          <label className="text-sm">
            Até
            <input
              type="date"
              className={`${inputClassName} mt-1`}
              value={end}
              min={start}
              max={today()}
              onChange={(event) => setEnd(event.target.value)}
            />
          </label>
        </div>
        <label className="mt-4 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          Confirmo que o item proxy configurado é da minha conexão Nubank. O nome genérico
          “Meu Pluggy” não identifica sozinho a instituição de origem.
        </label>
        <div className="mt-4 flex flex-wrap gap-3">
          <ActionButton
            disabled={
              busy || !confirmed || !start || !end || connection?.configured === false
            }
            onClick={() => void run("preview")}
          >
            {busy ? "Consultando…" : "Carregar prévia do Nubank"}
          </ActionButton>
          <ActionButton disabled={busy} onClick={() => void run("backup")}>
            Consultar última prévia local
          </ActionButton>
          {preview ? (
            <a
              className="rounded-md border px-3 py-2 text-sm"
              href="/api/pluggy?action=download"
            >
              Baixar JSON original
            </a>
          ) : null}
        </div>
        <p role="status" aria-live="polite" className="mt-3 text-sm">
          {message}
        </p>
      </SectionCard>
      {preview ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              [Landmark, "Contas", preview.summary.accounts],
              [CreditCard, "Cartões", preview.summary.cards],
              [ArrowDownUp, "Movimentações", preview.summary.transactions],
            ].map(([Icon, label, count]) => {
              const Symbol = Icon as typeof Landmark;
              return (
                <div key={String(label)} className="hub-card rounded-lg border p-4">
                  <Symbol className="mb-2 h-5 w-5" />
                  <p className="text-2xl font-semibold">{String(count)}</p>
                  <p className="text-sm">{String(label)}</p>
                </div>
              );
            })}
          </div>
          <SectionCard
            title="Cobertura e contas"
            description={`Consulta ${preview.period.start} a ${preview.period.end}. Datas retornadas: ${preview.coverage.start ?? "nenhuma"} a ${preview.coverage.end ?? "nenhuma"}. ${preview.complete ? "Todas as páginas disponíveis foram lidas." : "Leitura parcial."}`}
          >
            <p className="mb-3 text-sm">
              {preview.summary.possibleMatches} movimentações com possíveis
              correspondências no Hub · {preview.summary.historicalReferences} com
              referência no Organizze · <strong>zero alterações financeiras</strong>.
            </p>
            <p className="mb-3 text-sm">
              Última atualização informada pelo conector:{" "}
              {String(preview.item.lastUpdatedAt ?? "não informada")}. A cobertura depende
              do que o Nubank disponibiliza; não representa garantia de histórico
              integral.
            </p>
            {preview.warnings.map((warning) => (
              <p
                key={warning}
                className="mb-2 text-sm text-amber-700 dark:text-amber-300"
              >
                {warning}
              </p>
            ))}
            <div className="grid gap-3 sm:grid-cols-2">
              {preview.accounts.map((item) => (
                <div className="rounded-md border p-3 text-sm" key={item.id}>
                  <strong>{item.name}</strong> ·{" "}
                  {item.type === "CREDIT" ? "Cartão" : "Conta"}
                  <p>
                    {item.count} movimentações · Saldo externo{" "}
                    {money(item.balance, item.currency)}
                  </p>
                  <p className="text-xs">Somente referência; fora dos totais do Hub.</p>
                </div>
              ))}
            </div>
          </SectionCard>
          <SectionCard
            title="Movimentações em prévia"
            description="Correspondências são sugestões por valor e proximidade de datas. Nenhum vínculo, classificação ou reembolso é criado automaticamente."
          >
            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-sm">
                Buscar
                <input
                  className={`${inputClassName} mt-1`}
                  value={search}
                  placeholder="Descrição, categoria, tag ou ID"
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(0);
                  }}
                />
              </label>
              <label className="text-sm">
                Conta ou cartão
                <select
                  className={`${inputClassName} mt-1`}
                  value={account}
                  onChange={(event) => {
                    setAccount(event.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">Todos</option>
                  {preview.accounts.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Conciliação
                <select
                  className={`${inputClassName} mt-1`}
                  value={filter}
                  onChange={(event) => {
                    setFilter(event.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">Todas</option>
                  {Object.entries(statuses).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="my-3 text-sm">
              {rows.length} resultados · Titularidade não classificada até sua revisão.
            </p>
            <div className="space-y-3">
              {rows.slice(page * 25, page * 25 + 25).map((row) => (
                <article key={row.sourceKey} className="rounded-md border p-4 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <strong>{row.description || "Sem descrição"}</strong>
                    <span>
                      {money(row.amount, row.currency)} · {row.direction}
                    </span>
                  </div>
                  <p className="mt-1">
                    {row.date} · {row.account} · {row.bankStatus}
                    {row.operationType ? ` · ${row.operationType}` : ""}
                  </p>
                  <div className="my-2 flex flex-wrap gap-2">
                    <StatusBadge>Origem Pluggy</StatusBadge>
                    <StatusBadge tone="warning">{statuses[row.status]}</StatusBadge>
                    <StatusBadge>Titularidade pendente</StatusBadge>
                  </div>
                  <p>Categoria Pluggy: {row.category}</p>
                  {row.invoiceId ? <p>Fatura de origem: {row.invoiceId}</p> : null}
                  {row.installment !== null ? (
                    <p>
                      Parcela: {String(row.installment)} /{" "}
                      {String(row.installments ?? "não informado")}
                    </p>
                  ) : null}
                  <p className="mt-1 break-all text-xs text-ink-600 dark:text-slate-400">
                    ID original: {row.id}
                    {row.providerId ? ` · ID bancário: ${row.providerId}` : ""}
                  </p>
                  {row.alerts.map((alert) => (
                    <p key={alert} className="mt-2 text-amber-700 dark:text-amber-300">
                      {alert}
                    </p>
                  ))}
                  {row.candidates.length || row.historical.length ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer font-medium">
                        Conferir referências (
                        {row.candidates.length + row.historical.length})
                      </summary>
                      <div className="mt-2 space-y-2">
                        {row.candidates.map((candidate) => (
                          <div
                            className="rounded border p-2"
                            key={`${candidate.table}:${candidate.id}`}
                          >
                            <strong>Hub: {candidate.description}</strong>
                            <p>
                              Origem {candidate.origin} ·{" "}
                              {candidate.automatic ? "Automático" : "Manual/avulso"} ·
                              Titularidade {candidate.ownership ?? "pendente"}
                              {candidate.linkedTo ? ` · ${candidate.linkedTo}` : ""}
                            </p>
                            <p>{candidate.reason}</p>
                            <p className="text-xs">ID preservado: {candidate.id}</p>
                          </div>
                        ))}
                        {row.historical.map((item) => (
                          <div className="rounded border p-2" key={item.sourceKey}>
                            <strong>Histórico Organizze: {item.category}</strong>
                            <p>
                              {item.date} · {item.account} · Tags:{" "}
                              {item.tags.join(", ") || "nenhuma"}
                            </p>
                            <p className="text-xs">
                              {item.sourceKey} · Referência, sem inclusão nos totais.
                            </p>
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </article>
              ))}
            </div>
            {!rows.length ? (
              <p className="py-5 text-sm">Nenhuma movimentação neste filtro.</p>
            ) : null}
            <div ref={bottomRef} className="mt-4 flex scroll-mb-6 items-center gap-3">
              <ActionButton
                disabled={page === 0}
                onClick={() => changePage(() => setPage((value) => value - 1))}
              >
                Anterior
              </ActionButton>
              <span className="text-sm">
                Página {page + 1} de {Math.max(1, Math.ceil(rows.length / 25))}
              </span>
              <ActionButton
                disabled={(page + 1) * 25 >= rows.length}
                onClick={() => changePage(() => setPage((value) => value + 1))}
              >
                Próxima
              </ActionButton>
            </div>
          </SectionCard>
          <SectionCard
            title={`Faturas disponíveis (${preview.bills.length})`}
            description="Pagamentos são eventos da fatura; não geram outra compra ou receita no Hub."
          >
            <div className="space-y-2 text-sm">
              {preview.bills.map((bill) => (
                <p key={`${bill.accountId}:${bill.id}`}>
                  {
                    preview.accounts.find((account) => account.id === bill.accountId)
                      ?.name
                  }{" "}
                  · {bill.dueDate} · {money(bill.total, bill.currency)} · {bill.payments}{" "}
                  pagamentos informados
                </p>
              ))}
              {!preview.bills.length ? (
                <p>Nenhuma fatura retornada para esta conexão.</p>
              ) : null}
            </div>
          </SectionCard>
        </>
      ) : null}
    </div>
  );
}
