"use client";

import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import {
  createReimbursement,
  deleteReimbursement,
  generateRecurringReimbursements,
  listReimbursements,
  listReimbursementSupportData,
  updateReimbursement,
} from "@/features/reimbursements/queries";
import {
  emptyReimbursementForm,
  reimbursementToFormValues,
  type ReimbursementAccount,
  type ReimbursementFormValues,
  type ReimbursementIncome,
  type ReimbursementPerson,
  type ReimbursementRow,
  type ReimbursementTransaction,
} from "@/features/reimbursements/types";
import { ActionButton, BulkActionsBar, CrudFeedback, FieldShell, inputClassName, Modal, QuickEditInput, QuickEditSelect, RowSelectionHint, shouldToggleRowSelection, TextBadge, TitleButton } from "@/features/shared/crud-ui";
import { formatCurrency, formatDate } from "@/features/shared/format";
import { optionLabel, reimbursementStatusOptions } from "@/features/shared/options";
import { PeriodFilter } from "@/features/shared/period-filter";
import { createDefaultPeriodValue, isAnyDateInPeriod } from "@/features/shared/period";
import { getQuickTableEditPreference } from "@/features/shared/quick-edit";
import type { FeedbackState } from "@/features/shared/types";
import { createClient } from "@/lib/supabase/client";

type ModalState = { mode: "create"; reimbursement: null } | { mode: "edit"; reimbursement: ReimbursementRow } | null;

export function ReimbursementsCrud() {
  const [reimbursements, setReimbursements] = useState<ReimbursementRow[]>([]);
  const [people, setPeople] = useState<ReimbursementPerson[]>([]);
  const [transactions, setTransactions] = useState<ReimbursementTransaction[]>([]);
  const [accounts, setAccounts] = useState<ReimbursementAccount[]>([]);
  const [income, setIncome] = useState<ReimbursementIncome[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [personFilter, setPersonFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [linkedFilter, setLinkedFilter] = useState("all");
  const [period, setPeriod] = useState(createDefaultPeriodValue());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [allowQuickTableEdit, setAllowQuickTableEdit] = useState(false);

  const periodReimbursements = useMemo(() => {
    return reimbursements.filter((reimbursement) =>
      isAnyDateInPeriod([reimbursement.expected_date, reimbursement.received_date], period),
    );
  }, [period, reimbursements]);

  const filteredReimbursements = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return periodReimbursements.filter((reimbursement) => {
      const personName = people.find((person) => person.id === reimbursement.person_id)?.name ?? "";
      const hasLink = Boolean(
        reimbursement.credit_card_transaction_id ||
          reimbursement.account_payable_id ||
          reimbursement.income_source_id,
      );

      return (
        (!needle ||
          (reimbursement.description ?? "").toLowerCase().includes(needle) ||
          personName.toLowerCase().includes(needle)) &&
        (personFilter === "all" || reimbursement.person_id === personFilter) &&
        (statusFilter === "all" || reimbursement.status === statusFilter) &&
        (linkedFilter === "all" ||
          (linkedFilter === "linked" && hasLink) ||
          (linkedFilter === "manual" && !hasLink))
      );
    });
  }, [linkedFilter, people, periodReimbursements, personFilter, search, statusFilter]);

  const summary = useMemo(() => {
    const isOpen = (item: ReimbursementRow) => ["expected", "partial", "late"].includes(item.status);
    const totalExpected = periodReimbursements
      .filter(isOpen)
      .reduce((sum, item) => sum + Number(item.expected_amount), 0);
    const totalReceived = periodReimbursements.reduce((sum, item) => sum + Number(item.received_amount), 0);
    const lateAmount = periodReimbursements
      .filter((item) => item.status === "late")
      .reduce((sum, item) => sum + Number(item.expected_amount) - Number(item.received_amount), 0);
    const partialAmount = periodReimbursements
      .filter((item) => item.status === "partial")
      .reduce((sum, item) => sum + Number(item.expected_amount) - Number(item.received_amount), 0);
    const amountOwed = periodReimbursements
      .filter(isOpen)
      .reduce((sum, item) => sum + Number(item.expected_amount) - Number(item.received_amount), 0);
    const linkedGrossAmount = periodReimbursements.reduce((sum, item) => {
      const transaction = transactions.find((transactionItem) => transactionItem.id === item.credit_card_transaction_id);
      const account = accounts.find((accountItem) => accountItem.id === item.account_payable_id);

      return sum + Number(transaction?.amount ?? account?.amount ?? item.expected_amount ?? 0);
    }, 0);
    const estimatedPersonalCost = Math.max(linkedGrossAmount - amountOwed, 0);

    return { totalExpected, totalReceived, lateAmount, partialAmount, amountOwed, estimatedPersonalCost };
  }, [accounts, periodReimbursements, transactions]);

  const peopleSummary = useMemo(() => {
    return people
      .map((person) => {
        const personRows = periodReimbursements.filter((item) => item.person_id === person.id);
        const openRows = personRows.filter((item) => ["expected", "partial", "late"].includes(item.status));
        const expected = openRows.reduce((sum, item) => sum + Number(item.expected_amount), 0);
        const received = personRows.reduce((sum, item) => sum + Number(item.received_amount), 0);
        const open = openRows.reduce((sum, item) => sum + Number(item.expected_amount) - Number(item.received_amount), 0);
        const late = personRows
          .filter((item) => item.status === "late")
          .reduce((sum, item) => sum + Number(item.expected_amount) - Number(item.received_amount), 0);

        return { person, expected, received, open, late, count: personRows.length };
      })
      .filter((item) => item.count > 0)
      .sort((a, b) => b.open - a.open);
  }, [people, periodReimbursements]);

  async function loadData() {
    setLoading(true);
    const client = createClient();
    const { data: auth } = await client.auth.getUser();
    if (!auth.user) {
      setFeedback({ type: "error", message: "Sessão não encontrada." });
      setLoading(false);
      return;
    }

    setUserId(auth.user.id);
    const [reimbursementsResult, support, quickEdit] = await Promise.all([
      listReimbursements(client),
      listReimbursementSupportData(client),
      getQuickTableEditPreference(client, auth.user.id),
    ]);
    if (reimbursementsResult.error) setFeedback({ type: "error", message: reimbursementsResult.error.message });
    else setReimbursements(reimbursementsResult.data ?? []);
    if (!support.people.error) setPeople(support.people.data ?? []);
    if (!support.transactions.error) setTransactions(support.transactions.data ?? []);
    if (!support.accounts.error) setAccounts(support.accounts.data ?? []);
    if (!support.income.error) setIncome(support.income.data ?? []);
    setAllowQuickTableEdit(quickEdit);
    setLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function handleSubmit(values: ReimbursementFormValues) {
    if (!values.person_id || Number(values.expected_amount) < 0 || Number(values.received_amount) < 0) {
      setFeedback({ type: "error", message: "Pessoa é obrigatória e valores não podem ser negativos." });
      return;
    }
    if (values.is_recurring && !values.recurrence_start_date && !values.expected_date) {
      setFeedback({ type: "error", message: "Informe o início do reembolso recorrente." });
      return;
    }
    if (values.is_recurring && values.recurrence_end_date && values.recurrence_end_date < (values.recurrence_start_date || values.expected_date)) {
      setFeedback({ type: "error", message: "O fim da recorrência deve ser depois do início." });
      return;
    }
    if (!userId) return;

    setSaving(true);
    const client = createClient();
    const result =
      modal?.mode === "edit"
        ? await updateReimbursement(client, modal.reimbursement.id, values)
        : await createReimbursement(client, userId, values);

    if (result.error) setFeedback({ type: "error", message: result.error.message });
    else {
      let generatedMessage = "";
      const occurrences = Number(values.recurrence_occurrences || 0);

      if (values.is_recurring && occurrences > 0) {
        const generated = await generateRecurringReimbursements(client, userId, result.data, occurrences);

        if (generated.error) {
          setSaving(false);
          setFeedback({ type: "error", message: generated.error.message });
          return;
        }

        generatedMessage = ` ${generated.created} ocorrência(s) gerada(s), ${generated.skipped} já existia(m).`;
      }

      setFeedback({
        type: "success",
        message: `${modal?.mode === "edit" ? "Reembolso atualizado." : "Reembolso criado."}${generatedMessage}`,
      });
      setModal(null);
      await loadData();
    }
    setSaving(false);
  }

  async function handleGenerateRecurring(reimbursement: ReimbursementRow) {
    if (!userId) {
      setFeedback({ type: "error", message: "Sessão não encontrada." });
      return;
    }

    const raw = window.prompt("Quantas próximas ocorrências deseja gerar? Máximo 24.", "12");
    if (!raw) return;

    const occurrences = Number(raw);
    if (Number.isNaN(occurrences) || occurrences < 1) {
      setFeedback({ type: "error", message: "Informe uma quantidade válida." });
      return;
    }

    setGeneratingId(reimbursement.id);
    setFeedback(null);

    try {
      const result = await generateRecurringReimbursements(createClient(), userId, reimbursement, occurrences);

      if (result.error) {
        setFeedback({ type: "error", message: result.error.message });
        return;
      }

      setFeedback({ type: "success", message: `${result.created} reembolso(s) gerado(s). ${result.skipped} já existia(m).` });
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao gerar reembolsos recorrentes:", error);
      setFeedback({ type: "error", message: "Não foi possível gerar os próximos reembolsos." });
    } finally {
      setGeneratingId(null);
    }
  }

  async function handleDelete(reimbursement: ReimbursementRow) {
    if (!window.confirm("Excluir este reembolso?")) return;
    const { error } = await deleteReimbursement(createClient(), reimbursement.id);
    if (error) setFeedback({ type: "error", message: error.message });
    else {
      setFeedback({ type: "success", message: "Reembolso excluído." });
      await loadData();
    }
  }

  async function handleQuickUpdate(reimbursement: ReimbursementRow, patch: Partial<ReimbursementFormValues>) {
    setFeedback(null);

    try {
      const result = await updateReimbursement(createClient(), reimbursement.id, {
        ...reimbursementToFormValues(reimbursement),
        ...patch,
      });

      if (result.error) {
        console.error("Erro técnico ao editar reembolso rapidamente:", result.error);
        setFeedback({ type: "error", message: "Não foi possível salvar a edição rápida." });
        return;
      }

      await loadData();
    } catch (error) {
      console.error("Erro técnico ao editar reembolso rapidamente:", error);
      setFeedback({ type: "error", message: "Não foi possível salvar a edição rápida." });
    }
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    if (!window.confirm(`Tem certeza que deseja excluir ${ids.length} itens? Esta ação não pode ser desfeita.`)) {
      return;
    }

    setDeletingSelected(true);
    setFeedback(null);

    try {
      const client = createClient();
      const results = await Promise.all(ids.map((id) => deleteReimbursement(client, id)));
      const failed = results.find((result) => result.error);

      if (failed?.error) {
        console.error("Erro técnico ao excluir reembolsos selecionados:", failed.error);
        setFeedback({ type: "error", message: "Não foi possível excluir todos os itens selecionados." });
        return;
      }

      setSelectedIds(new Set());
      setFeedback({ type: "success", message: `${ids.length} reembolso(s) excluído(s).` });
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao excluir reembolsos selecionados:", error);
      setFeedback({ type: "error", message: "Não foi possível excluir os itens selecionados." });
    } finally {
      setDeletingSelected(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Dinheiro vinculado"
        title="Reembolsos"
        description="Controle o que outras pessoas devem por despesas que você pagou antes."
        action={<ActionButton onClick={() => setModal({ mode: "create", reimbursement: null })}>Novo reembolso</ActionButton>}
      />
      <CrudFeedback feedback={feedback} />

      <PeriodFilter value={period} onChange={setPeriod} />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <StatCard label="A receber" value={formatCurrency(summary.totalExpected)} helper="Não é renda livre." tone="warning" />
        <StatCard label="Recebido" value={formatCurrency(summary.totalReceived)} helper="Pix já recebido." tone="success" />
        <StatCard label="Atrasado" value={formatCurrency(summary.lateAmount)} helper="Maior risco de caixa." tone="danger" />
        <StatCard label="Parcial" value={formatCurrency(summary.partialAmount)} helper="Ainda falta receber." tone="warning" />
        <StatCard label="Pessoas devem" value={formatCurrency(summary.amountOwed)} helper="Saldo aberto." tone="info" />
        <StatCard label="Custo pessoal estimado" value={formatCurrency(summary.estimatedPersonalCost)} helper="Valor vinculado menos saldo aberto." tone="info" />
      </section>

      <SectionCard title="Separação importante" description="Reembolso existe para compensar despesa paga antes.">
        <p className="text-sm leading-6 text-ink-600">
          Mesmo quando entra via Pix, esse valor deve ser lido como dinheiro vinculado a uma compra,
          conta ou favor financeiro. Ele não aumenta sua renda real disponível.
        </p>
        <p className="mt-2 text-sm leading-6 text-ink-600">
          Reembolsos recorrentes servem para valores mensais combinados, como assinaturas familiares.
          Gere próximas ocorrências de forma controlada e revise cada uma antes de considerar no caixa.
        </p>
      </SectionCard>

      <SectionCard title="Quem deve agora" description="Resumo por pessoa responsável.">
        {peopleSummary.length === 0 ? (
          <EmptyState title="Nenhuma pessoa com reembolso" description="Quando houver reembolsos, o resumo por pessoa aparecerá aqui." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {peopleSummary.map((item) => (
              <div key={item.person.id} className="rounded-md border border-ink-950/10 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink-950">{item.person.name}</p>
                    <p className="mt-1 text-sm text-ink-600">{item.count} reembolso(s)</p>
                  </div>
                  <TextBadge tone={item.late > 0 ? "danger" : item.open > 0 ? "warning" : "success"}>
                    {item.late > 0 ? "Atrasado" : item.open > 0 ? "Aberto" : "Recebido"}
                  </TextBadge>
                </div>
                <div className="mt-4 grid gap-2 text-sm text-ink-600">
                  <p>Esperado: <strong className="text-ink-950">{formatCurrency(item.expected)}</strong></p>
                  <p>Recebido: <strong className="text-ink-950">{formatCurrency(item.received)}</strong></p>
                  <p>Em aberto: <strong className="text-ink-950">{formatCurrency(item.open)}</strong></p>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Filtros">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
          <input className={inputClassName} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por descrição ou pessoa" />
          <select className={inputClassName} value={personFilter} onChange={(event) => setPersonFilter(event.target.value)}>
            <option value="all">Todas pessoas</option>
            {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
          <select className={inputClassName} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">Todos status</option>
            {reimbursementStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select className={inputClassName} value={linkedFilter} onChange={(event) => setLinkedFilter(event.target.value)}>
            <option value="all">Todos vínculos</option>
            <option value="linked">Com lançamento</option>
            <option value="manual">Manual</option>
          </select>
        </div>
      </SectionCard>

      <SectionCard title="Reembolsos cadastrados">
        {loading ? (
          <p className="text-sm text-ink-600">Carregando reembolsos...</p>
        ) : reimbursements.length === 0 ? (
          <EmptyState title="Nenhum reembolso cadastrado" description="Crie reembolsos para separar dinheiro de terceiros da sua renda real." />
        ) : filteredReimbursements.length === 0 ? (
          <EmptyState title="Nenhum reembolso no período" description="Ajuste o período ou os filtros para ver outros reembolsos." />
        ) : (
          <>
          <BulkActionsBar
            selectedCount={selectedIds.size}
            deleting={deletingSelected}
            onClear={() => setSelectedIds(new Set())}
            onDelete={() => void handleBulkDelete()}
          />
          <RowSelectionHint />
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-ink-950/10 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-ink-600">
                <tr>
                  <th className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={filteredReimbursements.length > 0 && filteredReimbursements.every((item) => selectedIds.has(item.id))}
                      onChange={(event) => {
                        if (event.target.checked) {
                          setSelectedIds(new Set([...selectedIds, ...filteredReimbursements.map((item) => item.id)]));
                          return;
                        }
                        const next = new Set(selectedIds);
                        filteredReimbursements.forEach((item) => next.delete(item.id));
                        setSelectedIds(next);
                      }}
                      aria-label="Selecionar todos os reembolsos filtrados"
                    />
                  </th>
                  <th className="px-4 py-3">Pessoa</th>
                  <th className="px-4 py-3">Descrição</th>
                  <th className="px-4 py-3">Esperado</th>
                  <th className="px-4 py-3">Recebido</th>
                  <th className="px-4 py-3">Data prevista</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Vínculo</th>
                  <th className="px-4 py-3">Recorrência</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-950/10">
                {filteredReimbursements.map((reimbursement) => (
                  <tr
                    key={reimbursement.id}
                    onClick={(event) => {
                      if (!shouldToggleRowSelection(event)) return;
                      const next = new Set(selectedIds);
                      if (next.has(reimbursement.id)) next.delete(reimbursement.id);
                      else next.add(reimbursement.id);
                      setSelectedIds(next);
                    }}
                    className="cursor-default"
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(reimbursement.id)}
                        onChange={(event) => {
                          const next = new Set(selectedIds);
                          if (event.target.checked) next.add(reimbursement.id);
                          else next.delete(reimbursement.id);
                          setSelectedIds(next);
                        }}
                        aria-label={`Selecionar ${reimbursement.description ?? "reembolso"}`}
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-ink-950">
                      <TitleButton onClick={() => setModal({ mode: "edit", reimbursement })}>
                        {people.find((person) => person.id === reimbursement.person_id)?.name ?? "-"}
                      </TitleButton>
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {allowQuickTableEdit ? (
                        <QuickEditInput value={reimbursement.description ?? ""} onCommit={(value) => void handleQuickUpdate(reimbursement, { description: value })} />
                      ) : reimbursement.description ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-ink-950">
                      {allowQuickTableEdit ? (
                        <QuickEditInput type="number" value={String(reimbursement.expected_amount)} onCommit={(value) => void handleQuickUpdate(reimbursement, { expected_amount: value })} />
                      ) : formatCurrency(Number(reimbursement.expected_amount))}
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {allowQuickTableEdit ? (
                        <QuickEditInput type="number" value={String(reimbursement.received_amount)} onCommit={(value) => void handleQuickUpdate(reimbursement, { received_amount: value })} />
                      ) : formatCurrency(Number(reimbursement.received_amount))}
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {allowQuickTableEdit ? (
                        <QuickEditInput type="date" value={reimbursement.expected_date ?? ""} onCommit={(value) => void handleQuickUpdate(reimbursement, { expected_date: value })} />
                      ) : formatDate(reimbursement.expected_date)}
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {allowQuickTableEdit ? (
                        <QuickEditSelect value={reimbursement.status} options={reimbursementStatusOptions} onCommit={(value) => void handleQuickUpdate(reimbursement, { status: value })} />
                      ) : optionLabel(reimbursementStatusOptions, reimbursement.status)}
                    </td>
                    <td className="px-4 py-3">
                      <TextBadge tone={getLinkedTone(reimbursement)}>
                        {getLinkedLabel(reimbursement, transactions, accounts, income)}
                      </TextBadge>
                    </td>
                    <td className="px-4 py-3">
                      {reimbursement.is_recurring ? (
                        <TextBadge tone="info">{reimbursement.recurrence_parent_id ? "Ocorrência" : "Recorrente"}</TextBadge>
                      ) : (
                        <span className="text-ink-500">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {reimbursement.is_recurring && !reimbursement.recurrence_parent_id ? (
                          <ActionButton
                            variant="secondary"
                            disabled={generatingId === reimbursement.id}
                            onClick={() => void handleGenerateRecurring(reimbursement)}
                          >
                            {generatingId === reimbursement.id ? "Gerando..." : "Gerar próximas"}
                          </ActionButton>
                        ) : null}
                        <ActionButton variant="secondary" onClick={() => setModal({ mode: "edit", reimbursement })}>Editar</ActionButton>
                        <ActionButton variant="danger" onClick={() => void handleDelete(reimbursement)}>Excluir</ActionButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </SectionCard>

      {modal ? (
        <ReimbursementModal
          accounts={accounts}
          income={income}
          modal={modal}
          people={people}
          saving={saving}
          transactions={transactions}
          onClose={() => setModal(null)}
          onSubmit={(values) => void handleSubmit(values)}
        />
      ) : null}
    </div>
  );
}

function ReimbursementModal({
  accounts,
  income,
  modal,
  people,
  saving,
  transactions,
  onClose,
  onSubmit,
}: {
  accounts: ReimbursementAccount[];
  income: ReimbursementIncome[];
  modal: ModalState;
  people: ReimbursementPerson[];
  saving: boolean;
  transactions: ReimbursementTransaction[];
  onClose: () => void;
  onSubmit: (values: ReimbursementFormValues) => void;
}) {
  const [values, setValues] = useState<ReimbursementFormValues>(
    modal?.mode === "edit" ? reimbursementToFormValues(modal.reimbursement) : emptyReimbursementForm,
  );

  return (
    <Modal title={modal?.mode === "edit" ? "Editar reembolso" : "Novo reembolso"} onClose={onClose}>
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(values);
        }}
      >
        <FieldShell label="Pessoa responsável">
          <select required className={inputClassName} value={values.person_id} onChange={(event) => setValues({ ...values, person_id: event.target.value })}>
            <option value="">Selecione</option>
            {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        </FieldShell>
        <FieldShell label="Status">
          <select className={inputClassName} value={values.status} onChange={(event) => setValues({ ...values, status: event.target.value })}>
            {reimbursementStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FieldShell>
        <div className="md:col-span-2">
          <FieldShell label="Descrição">
            <input className={inputClassName} value={values.description} onChange={(event) => setValues({ ...values, description: event.target.value })} />
          </FieldShell>
        </div>
        <FieldShell label="Valor esperado">
          <input min="0" step="0.01" type="number" className={inputClassName} value={values.expected_amount} onChange={(event) => setValues({ ...values, expected_amount: event.target.value })} />
        </FieldShell>
        <FieldShell label="Valor recebido">
          <input min="0" step="0.01" type="number" className={inputClassName} value={values.received_amount} onChange={(event) => setValues({ ...values, received_amount: event.target.value })} />
        </FieldShell>
        <FieldShell label="Data prevista">
          <input type="date" className={inputClassName} value={values.expected_date} onChange={(event) => setValues({ ...values, expected_date: event.target.value })} />
        </FieldShell>
        <FieldShell label="Data recebida">
          <input type="date" className={inputClassName} value={values.received_date} onChange={(event) => setValues({ ...values, received_date: event.target.value })} />
        </FieldShell>
        <FieldShell label="Reembolso recorrente?">
          <select
            className={inputClassName}
            value={String(values.is_recurring)}
            onChange={(event) => setValues({ ...values, is_recurring: event.target.value === "true" })}
          >
            <option value="false">Não</option>
            <option value="true">Sim, mensal</option>
          </select>
        </FieldShell>
        {values.is_recurring ? (
          <>
            <FieldShell label="Frequência">
              <select className={inputClassName} value={values.recurrence_frequency} onChange={(event) => setValues({ ...values, recurrence_frequency: event.target.value as "monthly" })}>
                <option value="monthly">Mensal</option>
              </select>
            </FieldShell>
            <FieldShell label="Início">
              <input type="date" className={inputClassName} value={values.recurrence_start_date} onChange={(event) => setValues({ ...values, recurrence_start_date: event.target.value })} />
            </FieldShell>
            <FieldShell label="Fim opcional">
              <input type="date" className={inputClassName} value={values.recurrence_end_date} onChange={(event) => setValues({ ...values, recurrence_end_date: event.target.value })} />
            </FieldShell>
            <FieldShell label="Gerar próximas ocorrências">
              <input
                min="0"
                max="24"
                type="number"
                className={inputClassName}
                value={values.recurrence_occurrences}
                onChange={(event) => setValues({ ...values, recurrence_occurrences: event.target.value })}
              />
            </FieldShell>
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 md:col-span-2">
              Reembolsos recorrentes geram novas cobranças mensais sem transformar esse dinheiro em renda livre.
            </p>
          </>
        ) : null}
        <FieldShell label="Lançamento do cartão">
          <select className={inputClassName} value={values.credit_card_transaction_id} onChange={(event) => setValues({ ...values, credit_card_transaction_id: event.target.value })}>
            <option value="">Sem vínculo</option>
            {transactions.map((transaction) => (
              <option key={transaction.id} value={transaction.id}>
                {transaction.description} - {formatCurrency(Number(transaction.amount))}
              </option>
            ))}
          </select>
        </FieldShell>
        <FieldShell label="Conta vinculada">
          <select className={inputClassName} value={values.account_payable_id} onChange={(event) => setValues({ ...values, account_payable_id: event.target.value })}>
            <option value="">Sem vínculo</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.title}</option>
            ))}
          </select>
        </FieldShell>
        <FieldShell label="Entrada relacionada">
          <select className={inputClassName} value={values.income_source_id} onChange={(event) => setValues({ ...values, income_source_id: event.target.value })}>
            <option value="">Sem vínculo</option>
            {income.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </FieldShell>
        <div className="md:col-span-2">
          <FieldShell label="Notas">
            <textarea rows={3} className={inputClassName} value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} />
          </FieldShell>
        </div>
        <div className="flex justify-end gap-2 md:col-span-2">
          <ActionButton type="button" variant="secondary" onClick={onClose}>Cancelar</ActionButton>
          <ActionButton type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</ActionButton>
        </div>
      </form>
    </Modal>
  );
}

function getLinkedLabel(
  reimbursement: ReimbursementRow,
  transactions: ReimbursementTransaction[],
  accounts: ReimbursementAccount[],
  income: ReimbursementIncome[],
) {
  if (reimbursement.credit_card_transaction_id) {
    const transaction = transactions.find((item) => item.id === reimbursement.credit_card_transaction_id);
    return transaction ? `Cartão: ${transaction.description}` : "Lançamento de cartão";
  }

  if (reimbursement.account_payable_id) {
    const account = accounts.find((item) => item.id === reimbursement.account_payable_id);
    return account ? `Conta: ${account.title}` : "Conta vinculada";
  }

  if (reimbursement.income_source_id) {
    const incomeSource = income.find((item) => item.id === reimbursement.income_source_id);
    return incomeSource ? `Receita: ${incomeSource.name}` : "Receita relacionada";
  }

  return "Manual";
}

function getLinkedTone(reimbursement: ReimbursementRow) {
  if (reimbursement.credit_card_transaction_id) return "info";
  if (reimbursement.account_payable_id) return "warning";
  if (reimbursement.income_source_id) return "success";
  return "neutral";
}
