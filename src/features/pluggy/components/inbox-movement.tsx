"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ChevronDown, Link2, ArrowUpRight, Ban, Check, Info } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { ActionButton, inputClassName } from "@/features/shared/crud-ui";
import { SearchableSelect } from "@/features/shared/searchable-select";
import { candidateConfidence, movementDisposition, type InboxMovement } from "../inbox";
import type { PluggyDashboard } from "../service";
import type { InboxReview, Ownership } from "../types";
import { BankBadge } from "./bank-badge";

export const money = (value: number | null, currency = "BRL") =>
  value === null || !Number.isFinite(value)
    ? "Não informado"
    : new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: /^[A-Z]{3}$/.test(currency) ? currency : "BRL",
      }).format(value);
export const dateLabel = (value: string | null) =>
  value && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10).split("-").reverse().join("/")
    : "Sem data";
const ownerships = {
  personal: "Pessoal",
  third_party: "Terceiro",
  family: "Familiar",
  shared: "Compartilhada",
};

export function InboxMovementRow({
  row,
  categories,
  disabled,
  onSave,
}: {
  row: InboxMovement;
  categories: PluggyDashboard["categories"];
  disabled: boolean;
  onSave: (review: InboxReview) => Promise<boolean>;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [category, setCategory] = useState(row.selectedCategoryId ?? "");
  const [ownership, setOwnership] = useState<Ownership | "">(row.selectedOwnership ?? "");
  const [state, setState] = useState<InboxReview["state"]>(row.review.state);
  const [selected, setSelected] = useState("");
  const [createNew, setCreateNew] = useState(false);
  const disposition = movementDisposition(row);
  const fixed = row.review.state === "reconciled";
  const eligible =
    row.bankStatus === "POSTED" &&
    ["income", "expense"].includes(row.kind) &&
    !disposition.automatic;
  const linked =
    row.review.target === "income_sources"
      ? "/dashboard/income"
      : row.review.target === "credit_card_transactions"
        ? "/dashboard/cards"
        : "/dashboard/accounts";

  async function save(
    nextState: InboxReview["state"],
    candidate?: InboxMovement["candidates"][number],
  ) {
    const saved = await onSave({
      state: nextState,
      categoryId: category || null,
      ownership: ownership || null,
      target: fixed ? row.review.target : (candidate?.table ?? null),
      targetId: fixed ? row.review.targetId : (candidate?.id ?? null),
    });
    if (saved) setExpanded(false);
  }

  return (
    <article className="min-w-0 border-b border-ink-950/10 last:border-b-0">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 xl:grid-cols-[6rem_minmax(0,1.6fr)_minmax(0,1fr)_7.5rem_8rem_11rem_6.5rem]">
        <span className="col-start-1 row-start-1 text-xs text-ink-600 xl:col-auto xl:row-auto xl:text-sm">
          {dateLabel(row.date)}
        </span>
        <p
          className="col-span-2 line-clamp-2 min-w-0 break-words text-sm font-medium xl:col-span-1"
          title={row.description}
        >
          {row.description || "Sem descrição"}
        </p>
        <BankBadge bank={row.bank} account={row.account} accountType={row.accountType} />
        <span
          className={`col-start-2 row-start-1 text-right text-sm font-semibold tabular-nums xl:col-auto xl:row-auto ${row.kind === "income" ? "text-emerald-700 dark:text-emerald-300" : row.kind === "expense" ? "text-rose-600 dark:text-rose-400" : ""}`}
        >
          {row.kind === "expense" ? "− " : row.kind === "income" ? "+ " : ""}
          {money(row.amount === null ? null : Math.abs(row.amount), row.currency)}
        </span>
        <span className="text-xs text-ink-600">{disposition.type}</span>
        <div className="min-w-0">
          <StatusBadge
            tone={
              fixed || disposition.label === "Classificado"
                ? "success"
                : disposition.section === "ignored"
                  ? "neutral"
                  : disposition.section === "reconciliation"
                    ? "info"
                    : "warning"
            }
          >
            {disposition.label}
          </StatusBadge>
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded(!expanded)}
          className="inline-flex items-center justify-center gap-1 rounded-md border border-ink-950/15 px-2 py-2 text-xs font-semibold transition hover:bg-mint-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-mint-500"
        >
          {fixed
            ? "Ver vínculo"
            : disposition.section === "ignored"
              ? "Detalhes"
              : disposition.section === "reconciliation"
                ? "Comparar"
                : "Revisar"}
          <ChevronDown
            aria-hidden
            className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>
      </div>
      {disposition.section === "pending" || disposition.section === "ignored" ? (
        <p className="px-4 pb-3 text-xs leading-5 text-ink-600">{disposition.reason}</p>
      ) : null}
      {expanded ? (
        <div
          id={id}
          className="space-y-5 border-t border-ink-950/10 bg-[var(--hub-surface-muted)] px-4 py-5 text-sm"
        >
          <p className="flex items-start gap-2 text-ink-600">
            <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            {disposition.reason}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-xs text-ink-600">Categoria do banco</p>
              <p className="mt-1 font-medium">{row.category}</p>
            </div>
            <div>
              <p className="text-xs text-ink-600">Categoria no Hub</p>
              <p className="mt-1 font-medium">
                {categories.find((item) => item.id === row.selectedCategoryId)?.name ??
                  "Categoria pendente"}
              </p>
            </div>
            <div>
              <p className="text-xs text-ink-600">Titularidade</p>
              <p className="mt-1 font-medium">
                {row.selectedOwnership
                  ? ownerships[row.selectedOwnership]
                  : "Titularidade pendente"}
              </p>
            </div>
          </div>
          {fixed ? (
            <Link
              href={linked}
              className="inline-flex items-center gap-2 font-medium text-mint-600 underline"
            >
              <Link2 className="h-4 w-4" />
              Abrir módulo do lançamento vinculado
            </Link>
          ) : null}
          {row.classification.ambiguous ? (
            <p role="status" className="text-amber-700 dark:text-amber-300">
              Há regras conflitantes. Confira categoria e titularidade.
            </p>
          ) : null}
          {!fixed && row.candidates.length > 0 && eligible ? (
            <fieldset className="space-y-3">
              <legend className="mb-3 font-semibold">Comparar antes de vincular</legend>
              <div className="border-l-2 border-mint-500 pl-3">
                <p className="text-xs text-ink-600">Novo · Meu Pluggy</p>
                <p className="mt-1 font-medium">{row.description}</p>
                <p className="text-xs text-ink-600">
                  {dateLabel(row.date)} · {money(row.amount, row.currency)} · {row.bank} /{" "}
                  {row.account}
                </p>
              </div>
              {row.candidates.map((candidate) => (
                <label
                  key={`${candidate.table}:${candidate.id}`}
                  className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${selected === `${candidate.table}:${candidate.id}` ? "border-mint-500 bg-mint-100/40" : "border-ink-950/15"}`}
                >
                  <input
                    type="radio"
                    name={`${id}-candidate`}
                    className="mt-1 shrink-0"
                    disabled={disabled}
                    checked={selected === `${candidate.table}:${candidate.id}`}
                    onChange={() => {
                      setSelected(`${candidate.table}:${candidate.id}`);
                      setCreateNew(false);
                    }}
                  />
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="break-words">{candidate.description}</strong>
                      <StatusBadge tone="info">
                        Confiança {candidateConfidence(row, candidate).toLowerCase()}
                        {candidate.confidence
                          ? ` · ${candidate.confidence.score}/100`
                          : ""}
                      </StatusBadge>
                    </span>
                    <span className="block text-xs text-ink-600">
                      Existente no Hub · {dateLabel(candidate.date)} ·{" "}
                      {candidate.receivedDate && candidate.receivedDate !== candidate.date
                        ? `Recebido em ${dateLabel(candidate.receivedDate)} · `
                        : ""}
                      {money(candidate.amount)} ·{" "}
                      {candidate.origin === "manual"
                        ? "Cadastro manual"
                        : candidate.origin === "organizze"
                          ? "Organizze"
                          : candidate.origin === "pluggy"
                            ? "Meu Pluggy"
                            : "Hub"}
                    </span>
                    <span className="block text-xs text-ink-600">
                      {candidate.reason}
                      {candidate.linkedTo ? ` · ${candidate.linkedTo}` : ""}
                    </span>
                  </span>
                </label>
              ))}
              <div className="flex flex-wrap gap-2">
                <ActionButton
                  disabled={disabled || !selected}
                  onClick={() =>
                    void save(
                      "reconciled",
                      row.candidates.find(
                        (candidate) => `${candidate.table}:${candidate.id}` === selected,
                      ),
                    )
                  }
                >
                  <Link2 className="mr-2 h-4 w-4" />
                  Vincular selecionado
                </ActionButton>
                <ActionButton
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => void save("historical")}
                >
                  <Ban className="mr-2 h-4 w-4" />
                  Ignorar item
                </ActionButton>
                <ActionButton
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => {
                    setCreateNew(true);
                    setSelected("");
                  }}
                >
                  <ArrowUpRight className="mr-2 h-4 w-4" />
                  Preparar novo
                </ActionButton>
              </div>
            </fieldset>
          ) : null}
          {createNew ? (
            <p role="status" className="border-l-2 border-amber-400 pl-3 text-sm">
              Confira primeiro as correspondências acima. O cadastro é feito no módulo de
              origem:{" "}
              <Link
                className="font-semibold underline"
                href={
                  row.kind === "income"
                    ? "/dashboard/income"
                    : row.accountType === "CREDIT"
                      ? "/dashboard/cards"
                      : "/dashboard/accounts"
                }
              >
                abrir{" "}
                {row.kind === "income"
                  ? "Receitas"
                  : row.accountType === "CREDIT"
                    ? "Cartões"
                    : "Contas"}
              </Link>
              . Depois, volte para vincular o registro. Nenhuma importação foi aplicada.
            </p>
          ) : null}
          <div className="grid gap-3 md:grid-cols-3">
            <label>
              Situação da revisão
              <select
                className={`${inputClassName} mt-1`}
                value={state}
                disabled={disabled || fixed}
                onChange={(event) => setState(event.target.value as InboxReview["state"])}
              >
                <option value="new">Manter na caixa de entrada</option>
                <option value="pending">Manter em revisão</option>
                <option value="historical">Ignorar / somente referência</option>
                <option value="own_transfer">Transferência própria confirmada</option>
                <option value="invoice_payment">Pagamento de fatura confirmado</option>
                {fixed ? <option value="reconciled">Conciliado</option> : null}
              </select>
            </label>
            <div>
              <p className="mb-1">Categoria Hub</p>
              <SearchableSelect
                label="Categoria Hub"
                value={category}
                onChange={setCategory}
                disabled={disabled || fixed || !eligible}
                placeholder="Categoria pendente"
                options={categories
                  .filter((item) => item.type === row.kind)
                  .map((item) => ({ value: item.id, label: item.name }))}
              />
            </div>
            <label>
              Titularidade
              <select
                className={`${inputClassName} mt-1`}
                value={ownership}
                disabled={disabled || fixed}
                onChange={(event) => setOwnership(event.target.value as Ownership | "")}
              >
                <option value="">Titularidade pendente</option>
                {Object.entries(ownerships).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!fixed ? (
            <div className="flex flex-wrap gap-2">
              <ActionButton disabled={disabled} onClick={() => void save(state)}>
                <Check className="mr-2 h-4 w-4" />
                Salvar revisão
              </ActionButton>
              {disposition.canPrepare ? (
                <Link
                  className="inline-flex items-center gap-2 px-3 py-2 font-medium underline"
                  href={
                    row.kind === "income"
                      ? "/dashboard/income"
                      : row.accountType === "CREDIT"
                        ? "/dashboard/cards"
                        : "/dashboard/accounts"
                  }
                >
                  <ArrowUpRight className="h-4 w-4" />
                  Preparar cadastro no Hub
                </Link>
              ) : null}
            </div>
          ) : null}
          {row.historical.some((item) => item.confidence?.score >= 85) &&
          !row.candidates.length ? (
            <section className="space-y-2 border-l-2 border-sky-500 pl-3">
              <h3 className="font-medium">
                Possível correspondência no histórico Organizze
              </h3>
              {row.historical
                .filter((item) => item.confidence.score >= 85)
                .slice(0, 3)
                .map((item) => (
                  <div key={item.sourceKey} className="text-xs text-ink-600">
                    <p className="font-semibold">{item.description}</p>
                    <p>
                      {dateLabel(item.date)} · {money(item.amount)} · {item.account}
                    </p>
                    <p>
                      Confiança {item.confidence.label.toLowerCase()} ·{" "}
                      {item.confidence.score}/100 · {item.confidence.reason}
                    </p>
                  </div>
                ))}
              <p className="text-xs text-ink-600">
                O registro do arquivo ainda é somente referência. Um vínculo financeiro
                exige um registro já existente no Hub.
              </p>
            </section>
          ) : null}
          {row.historySuggestion ? (
            <section className="border-l-2 border-sky-500 pl-3">
              <h3 className="font-medium">Classificação sugerida pelo Organizze</h3>
              <p className="mt-1 text-xs text-ink-600">
                {row.historySuggestion.ambiguous
                  ? "Categorias históricas conflitantes: confira antes de usar."
                  : (row.historySuggestion.category ?? "Sem categoria única")}
              </p>
              {row.historySuggestion.tags.length ? (
                <p className="mt-2 text-xs text-mint-600">
                  {row.historySuggestion.tags.map((tag) => `#${tag}`).join(" · ")}
                </p>
              ) : null}
              {row.historySuggestion.categoryId && !fixed ? (
                <button
                  className="mt-2 text-xs font-semibold text-mint-600 underline"
                  type="button"
                  disabled={disabled}
                  onClick={() => setCategory(row.historySuggestion!.categoryId!)}
                >
                  Usar categoria sugerida na revisão
                </button>
              ) : (
                <p className="mt-2 text-xs text-ink-600">
                  Categoria original preservada como referência; escolha uma categoria Hub
                  compatível.
                </p>
              )}
            </section>
          ) : null}
          {row.historical.length ? (
            <details>
              <summary className="cursor-pointer font-medium">
                Referências Organizze ({row.historical.length})
              </summary>
              <ul className="mt-2 space-y-2 text-xs text-ink-600">
                {row.historical.map((reference) => (
                  <li key={reference.sourceKey}>
                    <p className="font-medium">
                      {reference.description || "Referência Organizze"}
                    </p>
                    <p>
                      {dateLabel(reference.date)} · {money(reference.amount)} ·{" "}
                      {reference.account || "Conta não informada"}
                    </p>
                    <p>
                      {reference.categoryPath || reference.category} ·{" "}
                      {reference.tags.join(", ") || "Sem tags"}
                    </p>
                    {reference.confidence ? (
                      <p className="mt-1">
                        Confiança {reference.confidence.label.toLowerCase()} ·{" "}
                        {reference.confidence.score}/100. {reference.confidence.reason}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <details>
            <summary className="cursor-pointer text-xs text-ink-600">
              Dados técnicos da origem
            </summary>
            <dl className="mt-2 grid gap-2 break-all text-xs text-ink-600 sm:grid-cols-2">
              <div>
                <dt>ID Pluggy</dt>
                <dd>{row.id}</dd>
              </div>
              <div>
                <dt>Situação bancária</dt>
                <dd>{row.bankStatus}</dd>
              </div>
              <div>
                <dt>Operação</dt>
                <dd>{row.operationType || "Não informada"}</dd>
              </div>
              <div>
                <dt>ID bancário</dt>
                <dd>{row.providerId || "Não informado"}</dd>
              </div>
              {row.invoiceId ? (
                <div>
                  <dt>Fatura de origem</dt>
                  <dd>{row.invoiceId}</dd>
                </div>
              ) : null}
              {row.installment !== null ? (
                <div>
                  <dt>Parcela</dt>
                  <dd>
                    {String(row.installment)} /{" "}
                    {String(row.installments ?? "Não informado")}
                  </dd>
                </div>
              ) : null}
              {row.review.targetId ? (
                <div>
                  <dt>Registro vinculado</dt>
                  <dd>{row.review.targetId}</dd>
                </div>
              ) : null}
            </dl>
            {row.alerts.map((alert) => (
              <p className="mt-2 text-xs text-ink-600" key={alert}>
                {alert}
              </p>
            ))}
          </details>
        </div>
      ) : null}
    </article>
  );
}
