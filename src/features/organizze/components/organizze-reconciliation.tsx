"use client";

import { useMemo, useState } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import { ActionButton, inputClassName } from "@/features/shared/crud-ui";
import { SearchableSelect } from "@/features/shared/searchable-select";
import { movementOrigin, ownershipLabels, type Ownership, type ReconciliationDecision, type ReconciliationDecisions, type ReconciliationReview } from "@/features/imports/organizze";
import type { References, Snapshot } from "../types";
import { usePaginationScroll } from "@/features/shared/use-pagination-scroll";

const stateLabels: Record<string, string> = { pending: "Pendente de classificação", blocked: "Revisar decisão", historical: "Somente histórico", new: "Novo selecionado", reconciled: "Conciliado", already_imported: "Já conciliado" };
const money = (cents: unknown) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(cents) / 100);
const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const inflowLabels = { real_income: "Receita própria", reimbursement: "Recebimento de reembolso", third_party_money: "Dinheiro de terceiros" };

export function OrganizzeReconciliation({ snapshot, references, reviews, decisions, disabled, onChange }: {
  snapshot: Snapshot; references: References; reviews: ReconciliationReview[]; decisions: ReconciliationDecisions; disabled: boolean; onChange: (next: ReconciliationDecisions) => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const { topRef, bottomRef, changePage } = usePaginationScroll(page);
  const [bulkOwnership, setBulkOwnership] = useState<Ownership | "">("");
  const [bulkInflow, setBulkInflow] = useState("");
  const [bulkPerson, setBulkPerson] = useState("");
  const records = useMemo(() => new Map(snapshot.records.map(row => [row.key, row])), [snapshot]);
  const filtered = reviews.filter(review => {
    const raw = records.get(review.sourceKey)?.raw;
    return (filter === "all" || filter === "possible" && (review.candidates.length || review.internalCandidates.length) || filter === "unmatched" && !review.candidates.length && !review.internalCandidates.length || filter === review.state) && normalize(`${raw?.description ?? ""} ${review.sourceKey} ${JSON.stringify(raw?.tags ?? [])}`).includes(normalize(search));
  });
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 25) - 1));
  const eligible = filtered.filter(row => row.state === "pending" && row.canCreate && !row.candidates.length && !row.internalCandidates.length);
  const hasIncome = eligible.some(row => Number(records.get(row.sourceKey)?.raw.amount_cents) > 0);
  function update(key: string, patch: Partial<ReconciliationDecision>) {
    onChange({ ...decisions, [key]: { ...(decisions[key] ?? { action: "historical" }), ...patch } });
  }
  const owners = <><option value="">Titularidade: confirmar</option>{Object.entries(ownershipLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</>;
  return <section className="mt-5 space-y-3 border-t pt-4" aria-label="Conciliação Organizze">
    <div ref={topRef} className="scroll-mt-20" />
    <h3 className="font-semibold">Conciliação — histórico fora dos totais até sua decisão</h3>
    <p className="text-sm">Origem, categoria e titularidade são informações distintas. Mesmo valor e data próxima (até 7 dias) sugerem uma correspondência; nunca confirmam um vínculo automaticamente. Tags não definem responsáveis ou reembolsos.</p>
    <div className="flex flex-wrap gap-2">
      <input aria-label="Buscar movimentações para conciliar" className={inputClassName} placeholder="Buscar descrição, tag ou ID" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} />
      <select aria-label="Filtrar conciliação" className={inputClassName} value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }}><option value="all">Todas</option><option value="possible">Possíveis correspondências</option><option value="unmatched">Sem correspondência encontrada</option>{Object.entries(stateLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
    </div>
    <details><summary className="cursor-pointer text-sm font-semibold">Selecionar novos sem possíveis correspondências</summary><div className="mt-3 flex flex-wrap gap-2">
      <select aria-label="Titularidade para seleção em lote" className={inputClassName} disabled={disabled} value={bulkOwnership} onChange={event => setBulkOwnership(event.target.value as Ownership)}>{owners}</select>
      <select aria-label="Natureza das entradas selecionadas em lote" className={inputClassName} disabled={disabled} value={bulkInflow} onChange={event => setBulkInflow(event.target.value)}><option value="">Natureza das entradas: confirmar</option>{Object.entries(inflowLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <SearchableSelect label="Responsável para seleção em lote" options={(references.people ?? []).map(person => ({ value: person.id, label: person.name }))} value={bulkPerson} disabled={disabled} onChange={setBulkPerson} />
      <ActionButton variant="secondary" disabled={disabled || !eligible.length || !bulkOwnership || hasIncome && !bulkInflow || bulkOwnership === "reimbursable" && !bulkPerson} onClick={() => {
        const next = { ...decisions };
        eligible.forEach(row => { next[row.sourceKey] = { action: "new", ownership: bulkOwnership as Ownership, personId: bulkPerson, inflowKind: bulkInflow as ReconciliationDecision["inflowKind"] }; });
        onChange(next);
      }}>Selecionar {eligible.length} novos e aplicar classificação</ActionButton>
    </div><p className="mt-2 text-sm">Aplica sua escolha apenas aos registros filtrados sem possíveis duplicatas. Ainda exige revisão de cartões e confirmação final. Não executa a importação.</p></details>
    <p className="text-sm">{filtered.length} movimentações · página {currentPage + 1} de {Math.max(1, Math.ceil(filtered.length / 25))}</p>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">Referência Organizze</th><th className="p-2">Estado</th><th className="p-2">Decisão e classificação</th></tr></thead><tbody>{filtered.slice(currentPage * 25, currentPage * 25 + 25).map(review => {
      const row = records.get(review.sourceKey)!; const raw = row.raw; const decision = decisions[review.sourceKey];
      const category = records.get(`category:${raw.category_id}`)?.raw.name;
      const candidates = review.candidates.flatMap(candidate => {
        const movement = references.movements.find(item => item.id === candidate.id && item.table === candidate.table);
        return movement ? [{ value: `${candidate.table}|${candidate.id}`, label: movement.description, description: `${movement.date ?? movement.receivedDate} · ${money(movement.amountCents)} · ${movementOrigin(movement)}${movement.cardId ? ` · Cartão: ${references.cards.find(card => card.id === movement.cardId)?.name ?? movement.cardId}` : ""}${movement.invoiceId ? ` · Fatura: ${references.invoices.find(invoice => invoice.id === movement.invoiceId)?.due_date ?? movement.invoiceId}` : ""}${movement.ownership ? ` · ${ownershipLabels[movement.ownership as Ownership] ?? movement.ownership}` : ""}${movement.isAutomatic ? " · Automático" : ""}${movement.linkedTo ? ` · ${movement.linkedTo}` : ""} · ${candidate.reason}` }] : [];
      });
      const locked = review.state === "already_imported";
      return <tr key={row.key} className="border-b align-top"><td className="max-w-xs p-2"><p className="font-medium">{String(raw.description || row.key)}</p><p>{String(raw.date ?? "")} · {money(raw.amount_cents)}</p><p className="text-xs">Origem: Organizze · {row.key}</p><p className="text-xs">Conta/cartão de origem: {String(records.get(`card:${raw.credit_card_id ?? raw.account_id}`)?.raw.name ?? records.get(`account:${raw.account_id}`)?.raw.name ?? "não informado")}{raw.credit_card_invoice_id ? ` · Fatura #${raw.credit_card_invoice_id}` : ""}</p><p className="text-xs">Categoria histórica: {String(category ?? "não informada")}</p><p className="text-xs">Tags: {Array.isArray(raw.tags) ? raw.tags.map(tag => typeof tag === "string" ? tag : (tag as { name?: string })?.name).filter(Boolean).join(", ") : String(raw.tags ?? "não informadas")}</p></td>
        <td className="max-w-xs p-2"><StatusBadge tone={review.state === "blocked" ? "danger" : ["reconciled", "already_imported"].includes(review.state) ? "success" : review.state === "new" ? "info" : "warning"}>{stateLabels[review.state]}</StatusBadge><p className="mt-2 text-xs">{review.reason}</p>{review.internalCandidates.length > 0 && <p className="mt-2 text-xs">{review.internalCandidates.length} movimentações semelhantes no próprio histórico. Confira antes de criar.</p>}</td>
        <td className="min-w-80 space-y-2 p-2"><select aria-label={`Decisão ${row.key}`} className={inputClassName} disabled={disabled || locked} value={decision?.action ?? ""} onChange={event => update(row.key, { action: event.target.value as ReconciliationDecision["action"], targetId: undefined, target: undefined })}><option value="" disabled>Não classificado — fora dos totais</option><option value="historical">Manter somente como histórico</option><option value="link" disabled={!candidates.length}>Vincular a um lançamento existente</option><option value="new" disabled={!review.canCreate}>É um lançamento novo</option></select>
        {decision?.action === "link" && <SearchableSelect label={`Correspondência ${row.key}`} options={candidates} value={decision.targetId ? `${decision.target}|${decision.targetId}` : ""} disabled={disabled || locked} placeholder="Busque e confirme o lançamento existente" onChange={value => { const [target, targetId] = value.split("|"); update(row.key, { target, targetId }); }} />}
        {decision?.action === "new" && <><select aria-label={`Titularidade ${row.key}`} className={inputClassName} value={decision.ownership ?? ""} disabled={disabled} onChange={event => update(row.key, { ownership: event.target.value as Ownership })}>{owners}</select><SearchableSelect label={`Responsável ${row.key}`} options={(references.people ?? []).map(person => ({ value: person.id, label: person.name }))} value={decision.personId ?? ""} disabled={disabled} onChange={personId => update(row.key, { personId })} />{Number(raw.amount_cents) > 0 && <select aria-label={`Natureza da entrada ${row.key}`} className={inputClassName} value={decision.inflowKind ?? ""} disabled={disabled} onChange={event => update(row.key, { inflowKind: event.target.value as ReconciliationDecision["inflowKind"] })}><option value="">Confirmar natureza da entrada</option>{Object.entries(inflowLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>}{(candidates.length > 0 || review.internalCandidates.length > 0) && <label className="block text-xs"><input type="checkbox" disabled={disabled} checked={decision.confirmDifferent === true} onChange={event => update(row.key, { confirmDifferent: event.target.checked })} /> Conferi as correspondências: é um lançamento diferente.</label>}</>}
        </td></tr>;
    })}</tbody></table></div>
    <div ref={bottomRef} className="flex scroll-mb-6 gap-2"><ActionButton variant="secondary" disabled={currentPage === 0} onClick={() => changePage(() => setPage(currentPage - 1))}>Anterior</ActionButton><ActionButton variant="secondary" disabled={(currentPage + 1) * 25 >= filtered.length} onClick={() => changePage(() => setPage(currentPage + 1))}>Próxima</ActionButton></div>
    <details><summary className="cursor-pointer font-semibold">Lançamentos existentes no Hub — preservados</summary><p className="mt-2 text-sm">A origem do lançamento permanece; referências Organizze/Pluggy são vínculos adicionais. A conciliação não troca o ID nem altera categoria, titularidade, fatura ou reembolso.</p><ul className="mt-2 space-y-2">{references.movements.filter(row => normalize(`${row.description} ${movementOrigin(row)}`).includes(normalize(search))).slice(0, 50).map(row => <li key={`${row.table}:${row.id}`} className="rounded-md border p-2 text-sm"><p>{row.description} · {row.receivedDate || row.date} · {money(row.amountCents)}</p><div className="flex flex-wrap gap-2"><StatusBadge>{movementOrigin(row)}</StatusBadge>{row.isAutomatic && <StatusBadge tone="info">Automático</StatusBadge>}{!!row.origins?.length && <StatusBadge tone="success">Conciliado · {row.origins.join(" + ")}</StatusBadge>}{row.isArchived && <StatusBadge>Arquivado</StatusBadge>}</div><p className="text-xs">Titularidade: {row.ownership ? ownershipLabels[row.ownership as Ownership] ?? row.ownership : "não informada"} · Categoria: {references.categories.find(category => category.id === row.categoryId)?.name ?? "não informada"}{row.linkedTo ? ` · ${row.linkedTo}` : ""}</p></li>)}</ul><p className="mt-2 text-xs">Até 50 resultados; use a busca para localizar outros lançamentos.</p></details>
  </section>;
}
