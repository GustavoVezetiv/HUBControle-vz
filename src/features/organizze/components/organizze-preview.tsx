"use client";

import { useMemo, useRef, useState } from "react";
import { SectionCard } from "@/components/ui/section-card";
import { inputClassName } from "@/features/shared/crud-ui";
import { usePaginationScroll } from "@/features/shared/use-pagination-scroll";
import { createSnapshot, extract, pendingTask } from "../extraction";
import { buildOrganizzePreview, buildSelectionPlan } from "../preview";
import type { PageResult, References, Snapshot, Task } from "../types";

const button =
  "rounded-md border border-ink-950/20 px-3 py-2 text-sm disabled:opacity-50";
const labels: Record<string, string> = {
  account: "Conta",
  card: "Cartão",
  category: "Categoria",
  invoice: "Fatura",
  transaction: "Movimentação",
  expense: "Despesa",
  income: "Receita",
  transfer: "Transferência",
  invoice_payment: "Pagamento de fatura",
  unknown: "Revisar natureza",
};

function today() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Cuiaba" }).format(
    new Date(),
  );
}

async function readJson<T>(params: URLSearchParams, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/organizze/preview?${params}`, {
    cache: "no-store",
    signal,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(typeof data.error === "string" ? data.error : "Falha na consulta.");
  return data;
}

function download(name: string, value: unknown, markdown = false) {
  const url = URL.createObjectURL(
    new Blob([markdown ? String(value) : JSON.stringify(value, null, 2)], {
      type: markdown ? "text/markdown;charset=utf-8" : "application/json",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function OrganizzePreview() {
  const [start, setStart] = useState("2023-01-01");
  const [end, setEnd] = useState(today);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [references, setReferences] = useState<References | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const { topRef, bottomRef, changePage } = usePaginationScroll(page);
  const controller = useRef<AbortController | null>(null);
  const preview = useMemo(
    () => (snapshot && references ? buildOrganizzePreview(snapshot, references) : null),
    [snapshot, references],
  );
  const filtered =
    preview?.rows.filter(
      (row) =>
        (filter === "all" ||
          filter === row.entity ||
          (filter === "issues" && row.issues.length > 0) ||
          (filter === "duplicates" && row.duplicateCandidates.length > 0)) &&
        `${row.sourceId} ${String(row.raw.description ?? row.raw.name ?? "")} ${row.tags.join(" ")}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    ) ?? [];
  const visible = filtered.slice(page * 50, (page + 1) * 50);

  async function run(resume: boolean) {
    setWorking(true);
    setMessage("");
    const abort = new AbortController();
    controller.current = abort;
    let active: Snapshot | null = null;
    try {
      const period = resume && snapshot ? snapshot.period : { start, end };
      // Reference reads are authenticated and complete before exposing a plan.
      const refs = await readJson<References>(
        new URLSearchParams({
          action: "references",
          start: period.start,
          end: period.end,
        }),
        abort.signal,
      );
      active =
        resume && snapshot
          ? structuredClone(snapshot)
          : createSnapshot(refs.ownerId, period);
      if (active.ownerId !== refs.ownerId)
        throw new Error("A sessão mudou. Inicie uma nova prévia.");
      setReferences(refs);
      setSnapshot({ ...active });
      if (!resume) setSelected([]);
      await extract(
        active,
        async (task: Task) => {
          const params = new URLSearchParams({
            action: "extract",
            path: task.path,
            page: String(task.page ?? 1),
          });
          if (task.period) {
            params.set("start", task.period.start);
            params.set("end", task.period.end);
          }
          // Sequential requests reduce rate pressure; 429 leaves a resumable preview.
          await new Promise((resolve) => setTimeout(resolve, 150));
          return readJson<PageResult>(params, abort.signal);
        },
        () => {
          if (active) setSnapshot({ ...active });
        },
        abort.signal,
      );
      setMessage(
        "Extração concluída. Revise a cobertura e as inconsistências antes de selecionar registros.",
      );
    } catch (error) {
      setMessage(
        abort.signal.aborted
          ? "Interrompido. Os dados já recuperados permanecem na prévia parcial."
          : error instanceof Error
            ? error.message
            : "Falha na extração.",
      );
    } finally {
      if (active) setSnapshot({ ...active });
      controller.current = null;
      setWorking(false);
    }
  }

  function exportPlan() {
    if (!snapshot || !references) return;
    download(
      "organizze-plano-selecionado.json",
      buildSelectionPlan(snapshot, references, selected),
    );
  }

  function exportReport() {
    if (!snapshot || !preview) return;
    const lines = [
      "# Organizze — relatório de prévia",
      "",
      `Período solicitado: ${snapshot.period.start} a ${snapshot.period.end}.`,
      `Movimentações efetivamente recuperadas no período: ${preview.actualPeriod.start ?? "sem dados"} a ${preview.actualPeriod.end ?? "sem dados"}.`,
      `Cobertura: ${preview.complete ? "fila concluída sem erros de incorporação" : "PARCIAL"}; ${snapshot.receipts.length}/${snapshot.tasks.length} requisições concluídas.`,
      `Registros únicos: ${preview.total}; no período ou cadastros: ${preview.inPeriod}; selecionados: ${selected.length}.`,
      `Possíveis duplicatas: ${preview.possibleDuplicates}; registros com pendências: ${preview.unmatched}.`,
      "",
      "## Contas e cartões",
      "",
      ...preview.accounts.map(
        (row) => `- Conta ID ${row.id}: ${row.name} — ${row.count} movimentações.`,
      ),
      ...preview.cards.map(
        (row) => `- Cartão ID ${row.id}: ${row.name} — ${row.count} movimentações.`,
      ),
      "",
      "## Categorias",
      "",
      ...preview.rows
        .filter((row) => row.entity === "category")
        .map(
          (row) =>
            `- ID ${row.sourceId}: ${String(row.raw.name)}; pai ${String(row.raw.parent_id ?? "nenhum")}; candidatos Hub: ${row.categoryCandidates.join(", ") || "nenhum"}; revisar antes de criar ou vincular.`,
        ),
      "",
      "## Tags encontradas",
      "",
      ...preview.tags.map((tag) => `- ${tag}`),
      "",
      "## Duplicatas e pendências",
      "",
      ...preview.rows
        .filter((row) => row.issues.length || row.duplicateCandidates.length)
        .map(
          (row) =>
            `- ${row.key}: ${[...row.issues, ...row.duplicateCandidates.map((item) => `${item.table}/${item.id}: ${item.reason}`)].join("; ")}`,
        ),
      "",
      "## Alertas",
      "",
      ...preview.warnings.map((warning) => `- ${warning}`),
      "",
      "## Plano de importação",
      "",
      "1. Resolver vínculos de contas, cartões, categorias e hierarquias; não sobrescrever cadastros.",
      "2. Conferir duplicatas, contrapartidas de transferências e pagamentos vinculados a faturas.",
      "3. Revisar titularidade, recorrências e parcelas preservadas no staging; não gerar reembolsos ou regras automaticamente.",
      "4. Conferir o JSON de seleção, as dependências e totais por origem. Solicitar autorização em uma etapa posterior.",
      "",
      "Nenhum registro financeiro oficial foi gravado por este fluxo. Staging e seleção são preparatórios.",
    ];
    download("organizze-relatorio-previa.md", lines.join("\n"), true);
  }

  return (
    <div ref={topRef} className="scroll-mt-20 space-y-5">
      <SectionCard
        title="Organizze — extração e prévia"
        description="Somente leitura. O staging fica na memória desta página; baixe o JSON para preservar os originais. Nenhum botão importa para os dados oficiais."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            Data inicial
            <input
              aria-label="Data inicial Organizze"
              className={inputClassName}
              type="date"
              value={start}
              disabled={working}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          <label>
            Data final
            <input
              aria-label="Data final Organizze"
              className={inputClassName}
              type="date"
              value={end}
              disabled={working}
              onChange={(event) => setEnd(event.target.value)}
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className={button}
            disabled={working || !start || !end || start > end}
            onClick={() => void run(false)}
          >
            Extrair nova prévia
          </button>
          {snapshot && (
            <button
              className={button}
              disabled={working || !pendingTask(snapshot)}
              onClick={() => void run(true)}
            >
              Retomar extração parcial
            </button>
          )}
          {working && (
            <button className={button} onClick={() => controller.current?.abort()}>
              Interromper
            </button>
          )}
        </div>
        <p className="mt-3 text-sm" role="status" aria-live="polite">
          {message ||
            (working
              ? "Consultando o Organizze…"
              : "A chave da API deve estar configurada somente no servidor, vinculada ao seu usuário Hub.")}
        </p>
        {snapshot && (
          <p className="mt-2 text-sm">
            Período desta prévia: {snapshot.period.start} a {snapshot.period.end}.
            Requisições: {snapshot.receipts.length}/{snapshot.tasks.length} — a fila
            cresce conforme faturas e páginas são descobertas.
          </p>
        )}
      </SectionCard>
      {preview && snapshot && (
        <>
          <SectionCard
            title={working || !preview.complete ? "Prévia parcial" : "Prévia extraída"}
            description="Fila concluída indica que os recursos e páginas anunciados foram percorridos; não comprova dados que a API omitiu. Totais usam IDs únicos e preservam as múltiplas origens."
          >
            <p>
              {preview.total} registros únicos; {snapshot.rejected.length} em quarentena;{" "}
              {preview.inPeriod} no período ou cadastros; {preview.possibleDuplicates}{" "}
              possíveis duplicatas; {preview.unmatched} com pendências.
            </p>
            <p>
              Categorias com candidatos existentes:{" "}
              {
                preview.rows.filter(
                  (row) => row.entity === "category" && row.categoryCandidates.length > 0,
                ).length
              }
              ; novas ou sem vínculo de tipo/hierarquia:{" "}
              {
                preview.rows.filter(
                  (row) =>
                    row.entity === "category" && row.categoryCandidates.length === 0,
                ).length
              }
              .
            </p>
            <p>
              Intervalo de movimentações: {preview.actualPeriod.start ?? "sem dados"} até{" "}
              {preview.actualPeriod.end ?? "sem dados"}.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <h3 className="font-semibold">Por conta</h3>
                {preview.accounts.map((row) => (
                  <p key={row.id}>
                    {row.name} (ID {row.id}): {row.count}
                  </p>
                ))}
              </div>
              <div>
                <h3 className="font-semibold">Por cartão</h3>
                {preview.cards.map((row) => (
                  <p key={row.id}>
                    {row.name} (ID {row.id}): {row.count}
                  </p>
                ))}
              </div>
            </div>
            <p className="mt-3">
              Tags identificadas ({preview.tags.length}):{" "}
              {preview.tags.join(", ") || "nenhuma retornada até aqui"}.
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
              {preview.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </SectionCard>
          <SectionCard
            title="Conferência e seleção"
            description="Selecionar prepara o plano. Pendências, duplicatas e titularidade continuam exigindo revisão; a seleção não autoriza gravação."
          >
            <div className="flex flex-wrap gap-2">
              <select
                aria-label="Filtrar registros Organizze"
                className={inputClassName + " sm:max-w-xs"}
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value);
                  setPage(0);
                }}
              >
                <option value="all">Todos os registros</option>
                {["account", "card", "category", "invoice", "transaction"].map(
                  (value) => (
                    <option key={value} value={value}>
                      {labels[value]}
                    </option>
                  ),
                )}
                <option value="duplicates">Possíveis duplicatas</option>
                <option value="issues">Sem correspondência ou com pendências</option>
              </select>
              <input
                aria-label="Buscar por ID, descrição ou tag"
                placeholder="ID, descrição ou tag"
                className={inputClassName + " sm:max-w-xs"}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
              />
              <button
                className={button}
                disabled={working}
                onClick={() =>
                  setSelected([
                    ...new Set([
                      ...selected,
                      ...filtered.filter((row) => row.selectable).map((row) => row.key),
                    ]),
                  ])
                }
              >
                Selecionar filtrados no período
              </button>
              <button
                className={button}
                disabled={working}
                onClick={() => setSelected([])}
              >
                Limpar seleção
              </button>
            </div>
            <p className="my-3 text-sm">
              {selected.length} selecionados. {filtered.length} registros no filtro.
              Categorias com candidatos existentes são propostas de vínculo; sem
              candidatos exigem revisão para criação.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th>Selecionar</th>
                    <th>Origem / natureza</th>
                    <th>Registro</th>
                    <th>Conferência</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={row.key} className="border-t border-ink-950/10 align-top">
                      <td className="p-2">
                        <input
                          type="checkbox"
                          aria-label={`Selecionar ${row.key}`}
                          disabled={working || !row.selectable}
                          checked={selected.includes(row.key)}
                          onChange={(event) =>
                            setSelected(
                              event.target.checked
                                ? [...selected, row.key]
                                : selected.filter((key) => key !== row.key),
                            )
                          }
                        />
                      </td>
                      <td className="p-2">
                        {row.key}
                        <br />
                        {labels[row.kind]}
                        {!row.inPeriod && <p>Fora do período</p>}
                      </td>
                      <td className="p-2">
                        {String(row.raw.description ?? row.raw.name ?? "Fatura")}
                        <br />
                        {String(row.raw.date ?? "")}
                        {typeof row.raw.amount_cents === "number" && (
                          <p>
                            {(row.raw.amount_cents / 100).toLocaleString("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                            })}
                          </p>
                        )}
                        {row.entity === "category" && (
                          <p>
                            Pai: {String(row.raw.parent_id ?? "nenhum")}; candidatos Hub:{" "}
                            {row.categoryCandidates.join(", ") || "nenhum"}
                          </p>
                        )}
                        <p>{row.tags.join(", ")}</p>
                        <details>
                          <summary>Dados originais e rastreabilidade</summary>
                          <pre className="max-h-72 max-w-lg overflow-auto whitespace-pre-wrap">
                            {JSON.stringify(row.sources, null, 2)}
                          </pre>
                        </details>
                      </td>
                      <td className="p-2">
                        {row.issues.map((issue) => (
                          <p key={issue}>{issue}</p>
                        ))}
                        {row.duplicateCandidates.map((item) => (
                          <p key={`${item.table}:${item.id}`}>
                            {item.table}/{item.id}: {item.reason}
                          </p>
                        ))}
                        {!row.issues.length &&
                          !row.duplicateCandidates.length &&
                          "Sem alerta automático; revisar."}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div ref={bottomRef} className="mt-3 flex scroll-mb-6 items-center gap-3">
              <button
                className={button}
                disabled={page === 0}
                onClick={() => changePage(() => setPage(page - 1))}
              >
                Anterior
              </button>
              <span>
                Página {page + 1} de {Math.max(1, Math.ceil(filtered.length / 50))}
              </span>
              <button
                className={button}
                disabled={(page + 1) * 50 >= filtered.length}
                onClick={() => changePage(() => setPage(page + 1))}
              >
                Próxima
              </button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className={button}
                disabled={working}
                onClick={() =>
                  download("organizze-staging.json", { snapshot, selectedKeys: selected })
                }
              >
                Baixar staging completo (JSON)
              </button>
              <button className={button} disabled={working} onClick={exportPlan}>
                Baixar plano selecionado
              </button>
              <button className={button} disabled={working} onClick={exportReport}>
                Baixar relatório de prévia
              </button>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
