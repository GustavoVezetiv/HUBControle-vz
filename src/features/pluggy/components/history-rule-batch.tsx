"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { CheckCheck, Search } from "lucide-react";
import { ActionButton, inputClassName } from "@/features/shared/crud-ui";
import type { PluggyDashboard } from "../service";
import { historicalRuleOptions } from "../rule-preview";
import { dateLabel, money } from "./inbox-movement";

export function HistoryRuleBatch({
  data,
  disabled,
  onSave,
  onEdit,
}: {
  data: PluggyDashboard;
  disabled: boolean;
  onSave: (rule: unknown) => Promise<boolean>;
  onEdit: (pattern: string, categoryId: string) => void;
}) {
  const options = useMemo(() => historicalRuleOptions(data), [data]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState("");
  const [working, setWorking] = useState(false);
  const running = useRef(false);
  const rows = options.filter((row) =>
    `${row.pattern} ${row.category}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()),
  );
  const chosen = options.filter((row) => row.eligible && selected.includes(row.pattern));
  const activePage = Math.min(page, Math.max(0, Math.ceil(rows.length / 10) - 1));
  async function apply() {
    if (disabled || running.current || !chosen.length) return;
    running.current = true;
    setWorking(true);
    let saved = 0;
    try {
      for (const item of chosen.slice(0, 20)) {
        setStatus(`Salvando regra ${saved + 1} de ${chosen.length}…`);
        if (
          !(await onSave({
            id: null,
            pattern: item.pattern,
            categoryId: item.categoryId,
            ownership: null,
            active: true,
          }))
        )
          break;
        saved++;
        setSelected((previous) => previous.filter((pattern) => pattern !== item.pattern));
      }
      setStatus(
        `${saved} de ${chosen.length} regras salvas. ${saved < chosen.length ? "O restante continua selecionado; confira o aviso e tente novamente." : "Categorias sugeridas na entrada; lançamentos e titularidade preservados."}`,
      );
    } finally {
      running.current = false;
      setWorking(false);
    }
  }
  return (
    <section aria-label="Padrões do Organizze" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Aproveitar o Organizze</h2>
          <p className="mt-1 text-xs text-ink-600">
            {options.length} padrões do histórico ·{" "}
            {options.filter((item) => item.eligible).length} sem conflito · categorias do
            Hub
          </p>
        </div>
        <label className="relative">
          <Search aria-hidden className="absolute left-3 top-3 h-4 w-4 text-ink-600" />
          <input
            className={`${inputClassName} pl-9`}
            aria-label="Buscar padrão do Organizze"
            placeholder="Descrição ou categoria"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-y border-ink-950/15 py-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={disabled || working || !rows.some((row) => row.eligible)}
            checked={
              rows.some((row) => row.eligible) &&
              rows
                .filter((row) => row.eligible)
                .slice(0, 20)
                .every((row) => selected.includes(row.pattern))
            }
            onChange={(event) =>
              setSelected(
                event.target.checked
                  ? rows
                      .filter((row) => row.eligible)
                      .slice(0, 20)
                      .map((row) => row.pattern)
                  : [],
              )
            }
          />
          Selecionar até 20 padrões seguros
        </label>
        <ActionButton
          disabled={disabled || working || !chosen.length}
          onClick={() => void apply()}
        >
          <CheckCheck aria-hidden className="mr-2 h-4 w-4" />
          Salvar {chosen.length} regras
        </ActionButton>
        <span className="text-xs text-ink-600">Sem importar lançamentos</span>
      </div>
      {status ? (
        <p role="status" className="text-sm">
          {status}
        </p>
      ) : null}
      <div className="divide-y divide-ink-950/10">
        {rows.slice(activePage * 10, activePage * 10 + 10).map((item) => (
          <div key={item.pattern} className="flex items-start gap-3 py-4">
            <input
              type="checkbox"
              className="mt-1 shrink-0"
              aria-label={`Selecionar regra ${item.pattern}`}
              checked={item.eligible && selected.includes(item.pattern)}
              disabled={
                disabled ||
                working ||
                !item.eligible ||
                (chosen.length >= 20 && !selected.includes(item.pattern))
              }
              onChange={(event) =>
                setSelected((previous) =>
                  event.target.checked
                    ? [...previous, item.pattern]
                    : previous.filter((value) => value !== item.pattern),
                )
              }
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="break-words text-sm font-semibold">{item.pattern}</h3>
                <span className="text-xs text-ink-600">
                  {item.count} ocorrências · {item.preview.matched} itens atuais
                </span>
              </div>
              <p className="mt-1 break-words text-sm text-sky-700 dark:text-sky-300">
                {item.category}
              </p>
              <p className="mt-1 text-xs text-ink-600">
                {dateLabel(item.firstDate)} a {dateLabel(item.lastDate)}
              </p>
              {!item.eligible ? (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                  {item.preview.existing
                    ? "Já existe uma regra para essa descrição."
                    : item.conflicts || item.combinedConflict || item.preview.conflicts
                      ? "Há categorias ou regras conflitantes."
                      : !item.categoryId
                        ? "Categoria de origem ainda sem equivalente único no Hub."
                        : "Padrão sem repetição suficiente ou descrição muito longa."}
                </p>
              ) : null}
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-ink-600">Exemplos e tags</summary>
                <ul className="mt-2 space-y-1">
                  {item.preview.examples.map((example, index) => (
                    <li key={index}>
                      {dateLabel(example.date)} · {example.description} ·{" "}
                      {money(example.amount)}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-ink-600">
                  {item.tags.map((tag) => `#${tag}`).join(" · ") ||
                    "Sem tags de referência"}
                </p>
              </details>
              {!item.preview.existing ? (
                <button
                  type="button"
                  disabled={disabled || working}
                  className="mt-2 text-xs font-semibold underline"
                  onClick={() =>
                    onEdit(
                      item.pattern.slice(0, 120),
                      item.conflicts ? "" : (item.categoryId ?? ""),
                    )
                  }
                >
                  Ajustar regra
                </button>
              ) : null}
            </div>
          </div>
        ))}
        {!rows.length ? (
          <p className="py-8 text-sm text-ink-600">
            Nenhum padrão encontrado neste histórico.
          </p>
        ) : null}
      </div>
      {rows.length > 10 ? (
        <div className="flex items-center justify-end gap-3 text-sm">
          <ActionButton
            variant="secondary"
            disabled={activePage === 0}
            onClick={() => setPage(activePage - 1)}
          >
            Anterior
          </ActionButton>
          <span>
            {activePage + 1} / {Math.ceil(rows.length / 10)}
          </span>
          <ActionButton
            variant="secondary"
            disabled={(activePage + 1) * 10 >= rows.length}
            onClick={() => setPage(activePage + 1)}
          >
            Próxima
          </ActionButton>
        </div>
      ) : null}
      <Link
        href="/dashboard/categories"
        className="inline-block text-xs font-medium underline"
      >
        Gerenciar categorias do Hub
      </Link>
    </section>
  );
}
