"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import {
  ActionButton,
  BulkActionsBar,
  CategoryBadge,
  CategorySelect,
  CrudFeedback,
  FieldShell,
  inputClassName,
  Modal,
  RowSelectionHint,
  shouldToggleRowSelection,
  TextBadge,
  TitleButton,
  ViewPreferenceActions,
} from "@/features/shared/crud-ui";
import { formatCurrency, formatDate, todayISO } from "@/features/shared/format";
import {
  accountStatusOptions,
  optionLabel,
  paymentMethodOptions,
  priorityOptions,
} from "@/features/shared/options";
import { PeriodFilter } from "@/features/shared/period-filter";
import { isDateInPeriod, parsePeriodSearchParams, type PeriodValue } from "@/features/shared/period";
import type { FeedbackState } from "@/features/shared/types";
import { clearViewPreference, loadViewPreference, preferenceRecord, preferenceText, saveViewPreference } from "@/features/shared/view-preferences";
import {
  archiveAccountPayable,
  createAccountPayable,
  generateRecurringAccounts,
  listAccountsPayable,
  listAccountSupportData,
  payAccountWithCard,
  updateAccountPayable,
} from "@/features/accounts-payable/queries";
import {
  accountToFormValues,
  emptyAccountForm,
  type AccountCardPaymentFormValues,
  type AccountCategory,
  type AccountCreditCard,
  type AccountInvoice,
  type AccountInstallment,
  type AccountPayableFormValues,
  type AccountPayableRow,
  type AccountPerson,
} from "@/features/accounts-payable/types";
import { createClient } from "@/lib/supabase/client";

type ModalState =
  | { mode: "create"; account: null }
  | { mode: "edit"; account: AccountPayableRow }
  | null;
type CardPaymentModalState = { account: AccountPayableRow } | null;
type AccountsViewPreference = {
  search?: string;
  statusFilter?: string;
  priorityFilter?: string;
  categoryFilter?: string;
  personFilter?: string;
  period?: PeriodValue;
};

const accountsDefaultViewPreference: Required<AccountsViewPreference> = {
  search: "",
  statusFilter: "all",
  priorityFilter: "all",
  categoryFilter: "all",
  personFilter: "all",
  period: parsePeriodSearchParams({}),
};

export function AccountsPayableCrud() {
  const searchParams = useSearchParams();
  const [accounts, setAccounts] = useState<AccountPayableRow[]>([]);
  const [categories, setCategories] = useState<AccountCategory[]>([]);
  const [people, setPeople] = useState<AccountPerson[]>([]);
  const [installments, setInstallments] = useState<AccountInstallment[]>([]);
  const [cards, setCards] = useState<AccountCreditCard[]>([]);
  const [invoices, setInvoices] = useState<AccountInvoice[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") ?? "all");
  const [priorityFilter, setPriorityFilter] = useState(searchParams.get("priority") ?? "all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [personFilter, setPersonFilter] = useState("all");
  const [period, setPeriod] = useState(() => parsePeriodSearchParams(Object.fromEntries(searchParams.entries())));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [cardPaymentModal, setCardPaymentModal] = useState<CardPaymentModalState>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [allowQuickTableEdit, setAllowQuickTableEdit] = useState(false);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [bulkPersonId, setBulkPersonId] = useState("");

  const periodAccounts = useMemo(() => {
    return accounts.filter((account) => isDateInPeriod(account.due_date, period));
  }, [accounts, period]);

  const filteredAccounts = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return periodAccounts.filter((account) => {
      const matchesSearch =
        !needle ||
        account.title.toLowerCase().includes(needle) ||
        (account.description ?? "").toLowerCase().includes(needle);
      const matchesStatus = statusFilter === "all" || account.status === statusFilter;
      const matchesPriority = priorityFilter === "all" || account.priority === priorityFilter;
      const matchesCategory = categoryFilter === "all" || account.category_id === categoryFilter;
      const matchesPerson =
        personFilter === "all" ||
        (personFilter === "none" ? !account.person_id : account.person_id === personFilter);

      return (
        matchesSearch &&
        matchesStatus &&
        matchesPriority &&
        matchesCategory &&
        matchesPerson
      );
    });
  }, [categoryFilter, periodAccounts, personFilter, priorityFilter, search, statusFilter]);

  const summary = useMemo(() => {
    const today = todayISO();
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const nextWeekISO = nextWeek.toISOString().slice(0, 10);

    return periodAccounts.reduce(
      (acc, account) => {
        const amount = Number(account.amount);

        if (account.status === "pending") {
          acc.pending += amount;
        }

        if (account.status === "overdue") {
          acc.overdue += amount;
        }

        if (account.priority === "high" || account.priority === "critical") {
          acc.highPriority += amount;
        }

        if (account.status === "pending" && account.due_date >= today && account.due_date <= nextWeekISO) {
          acc.nextSevenDays += amount;
        }

        return acc;
      },
      { pending: 0, overdue: 0, highPriority: 0, nextSevenDays: 0 },
    );
  }, [periodAccounts]);

  async function loadAccounts() {
    setLoading(true);
    setFeedback(null);

    try {
      const client = createClient();
      const {
        data: { user },
        error: userError,
      } = await client.auth.getUser();

      if (userError || !user) {
        setFeedback({ type: "error", message: "Sessão não encontrada. Entre novamente." });
        return;
      }

      setUserId(user.id);

      const [accountsResult, support, profileResult] = await Promise.all([
        listAccountsPayable(client),
        listAccountSupportData(client),
        client.from("profiles").select("allow_quick_table_edit").eq("id", user.id).maybeSingle(),
      ]);

      if (accountsResult.error) {
        setFeedback({ type: "error", message: accountsResult.error.message });
        return;
      }

      if (support.categories.error) {
        setFeedback({ type: "error", message: support.categories.error.message });
        return;
      }

      if (support.people.error) {
        setFeedback({ type: "error", message: support.people.error.message });
        return;
      }

      if (support.installments.error) {
        setFeedback({ type: "error", message: support.installments.error.message });
        return;
      }
      if (support.cards.error) {
        setFeedback({ type: "error", message: support.cards.error.message });
        return;
      }
      if (support.invoices.error) {
        setFeedback({ type: "error", message: support.invoices.error.message });
        return;
      }

      setAccounts(accountsResult.data ?? []);
      setCategories(support.categories.data ?? []);
      setPeople(support.people.data ?? []);
      setInstallments(support.installments.data ?? []);
      setCards(support.cards.data ?? []);
      setInvoices(support.invoices.data ?? []);
      if (!profileResult.error) setAllowQuickTableEdit(Boolean(profileResult.data?.allow_quick_table_edit));
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Erro ao carregar contas.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAccounts();
  }, []);

  useEffect(() => {
    if (!userId) return;
    const preference = loadViewPreference<AccountsViewPreference>("accounts", userId);
    if (!preference) return;

    setSearch(preferenceText(preference.search));
    if (!searchParams.get("status")) setStatusFilter(preferenceText(preference.statusFilter, "all"));
    if (!searchParams.get("priority")) setPriorityFilter(preferenceText(preference.priorityFilter, "all"));
    setCategoryFilter(preferenceText(preference.categoryFilter, "all"));
    setPersonFilter(preferenceText(preference.personFilter, "all"));
    if (!searchParams.get("period") && !searchParams.get("start") && !searchParams.get("end")) {
      setPeriod(preferenceRecord(preference.period, accountsDefaultViewPreference.period));
    }
  }, [searchParams, userId]);

  function handleSaveViewPreference() {
    const saved = saveViewPreference("accounts", userId, {
      search,
      statusFilter,
      priorityFilter,
      categoryFilter,
      personFilter,
      period,
    });
    setFeedback({
      type: saved ? "success" : "error",
      message: saved ? "Visualização padrão de contas salva." : "Não foi possível salvar a visualização padrão.",
    });
  }

  function handleRestoreViewPreference() {
    clearViewPreference("accounts", userId);
    handleClearFilters();
    setFeedback({ type: "success", message: "Visualização padrão de contas restaurada." });
  }

  function handleClearFilters() {
    setSearch(accountsDefaultViewPreference.search);
    setStatusFilter(accountsDefaultViewPreference.statusFilter);
    setPriorityFilter(accountsDefaultViewPreference.priorityFilter);
    setCategoryFilter(accountsDefaultViewPreference.categoryFilter);
    setPersonFilter(accountsDefaultViewPreference.personFilter);
    setPeriod(accountsDefaultViewPreference.period);
  }

  async function handleSubmit(values: AccountPayableFormValues) {
    const amount = Number(values.amount);

    if (!values.title.trim()) {
      setFeedback({ type: "error", message: "Informe o título da conta." });
      return;
    }

    if (!values.due_date) {
      setFeedback({ type: "error", message: "Informe a data de vencimento." });
      return;
    }

    if (Number.isNaN(amount) || amount < 0) {
      setFeedback({ type: "error", message: "O valor deve ser maior ou igual a zero." });
      return;
    }

    if (values.is_recurring) {
      const recurrenceStartDate = values.recurrence_start_date || values.due_date;

      if (!recurrenceStartDate) {
        setFeedback({ type: "error", message: "Informe o início da recorrência." });
        return;
      }

      if (values.recurrence_end_date && values.recurrence_end_date < recurrenceStartDate) {
        setFeedback({ type: "error", message: "O fim da recorrência deve ser depois do início." });
        return;
      }

      const occurrences = Number(values.recurrence_occurrences || 0);
      if (Number.isNaN(occurrences) || occurrences < 0 || occurrences > 24) {
        setFeedback({ type: "error", message: "A quantidade de ocorrências deve ficar entre 0 e 24." });
        return;
      }
    }

    if (!userId) {
      setFeedback({ type: "error", message: "Sessão não encontrada. Entre novamente." });
      return;
    }

    setSaving(true);
    setFeedback(null);

    try {
      const client = createClient();
      const result =
        modal?.mode === "edit"
          ? await updateAccountPayable(client, modal.account.id, values)
          : await createAccountPayable(client, userId, values);

      if (result.error) {
        setFeedback({ type: "error", message: result.error.message });
        return;
      }

      const savedAccount = result.data as AccountPayableRow | null;
      const occurrencesToGenerate = Number(values.recurrence_occurrences || 0);
      let generationMessage = "";

      if (savedAccount && values.is_recurring && occurrencesToGenerate > 0) {
        const generation = await generateRecurringAccounts(client, userId, savedAccount, occurrencesToGenerate);

        if (generation.error) {
          setFeedback({ type: "error", message: generation.error.message });
          return;
        }

        generationMessage = ` ${generation.created} ocorrência(s) criada(s). ${generation.skipped} duplicada(s) ignorada(s).`;
      }

      setFeedback({
        type: "success",
        message: `${modal?.mode === "edit" ? "Conta atualizada." : "Conta criada."}${generationMessage}`,
      });
      setModal(null);
      await loadAccounts();
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateRecurring(account: AccountPayableRow) {
    if (!userId) {
      setFeedback({ type: "error", message: "Sessão não encontrada. Entre novamente." });
      return;
    }

    const rawOccurrences = window.prompt(
      "Esta ação cria contas futuras com base nesta recorrência.\nVocê pode editar ou excluir cada ocorrência depois.\n\nQuantas próximas ocorrências deseja gerar? Máximo: 24.",
      "6",
    );

    if (rawOccurrences === null) return;

    const occurrences = Number(rawOccurrences);

    if (Number.isNaN(occurrences) || occurrences < 1 || occurrences > 24) {
      setFeedback({ type: "error", message: "Informe uma quantidade entre 1 e 24." });
      return;
    }

    setGeneratingId(account.id);
    setFeedback(null);

    try {
      const result = await generateRecurringAccounts(createClient(), userId, account, occurrences);

      if (result.error) {
        setFeedback({ type: "error", message: result.error.message });
        return;
      }

      setFeedback({
        type: "success",
        message: `${result.created} conta(s) futura(s) criada(s). ${result.skipped} duplicada(s) ignorada(s).`,
      });
      await loadAccounts();
    } catch (error) {
      console.error("Erro técnico ao gerar contas recorrentes:", error);
      setFeedback({ type: "error", message: "Não foi possível gerar as próximas contas." });
    } finally {
      setGeneratingId(null);
    }
  }

  async function handleDelete(account: AccountPayableRow) {
    if (!userId) return;
    if (!window.confirm(`Arquivar ${account.title}?`)) {
      return;
    }

    const { error } = await archiveAccountPayable(createClient(), account.id, userId);

    if (error) {
      setFeedback({ type: "error", message: error.message });
      return;
    }

    setFeedback({ type: "success", message: "Conta arquivada." });
    await loadAccounts();
  }

  async function handlePayWithCard(values: AccountCardPaymentFormValues) {
    if (!cardPaymentModal || !userId) return;
    const amount = Number(values.amount);

    if (!values.credit_card_id || !values.invoice_id || !values.transaction_date || !values.description.trim()) {
      setFeedback({ type: "error", message: "Cartão, fatura, data e descrição são obrigatórios." });
      return;
    }
    if (Number.isNaN(amount) || amount < 0) {
      setFeedback({ type: "error", message: "O valor deve ser maior ou igual a zero." });
      return;
    }

    setSaving(true);
    setFeedback(null);

    try {
      const result = await payAccountWithCard(createClient(), userId, cardPaymentModal.account, values);

      if (result.error) {
        setFeedback({ type: "error", message: result.error.message });
        return;
      }

      setFeedback({ type: "success", message: "Conta movida para a fatura selecionada." });
      setCardPaymentModal(null);
      await loadAccounts();
    } catch (error) {
      console.error("Erro técnico ao pagar conta com cartão:", error);
      setFeedback({ type: "error", message: "Não foi possível mover a conta para o cartão." });
    } finally {
      setSaving(false);
    }
  }

  async function handleQuickUpdate(account: AccountPayableRow, patch: Partial<AccountPayableFormValues>) {
    setFeedback(null);

    try {
      const result = await updateAccountPayable(createClient(), account.id, {
        ...accountToFormValues(account),
        ...patch,
      });

      if (result.error) {
        console.error("Erro técnico ao editar conta rapidamente:", result.error);
        setFeedback({ type: "error", message: "Não foi possível salvar a edição rápida." });
        return;
      }

      await loadAccounts();
    } catch (error) {
      console.error("Erro técnico ao editar conta rapidamente:", error);
      setFeedback({ type: "error", message: "Não foi possível salvar a edição rápida." });
    }
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);

    if (ids.length === 0) return;

    if (!userId) return;
    if (!window.confirm(`Arquivar ${ids.length} conta(s) selecionada(s)?`)) {
      return;
    }

    setDeletingSelected(true);
    setFeedback(null);

    try {
      const client = createClient();
      const results = await Promise.all(ids.map((id) => archiveAccountPayable(client, id, userId)));
      const failed = results.find((result) => result.error);

      if (failed?.error) {
        console.error("Erro técnico ao arquivar contas selecionadas:", failed.error);
        setFeedback({ type: "error", message: "Não foi possível arquivar todos os itens selecionados." });
        return;
      }

      setSelectedIds(new Set());
      setFeedback({ type: "success", message: `${ids.length} conta(s) arquivada(s).` });
      await loadAccounts();
    } catch (error) {
      console.error("Erro técnico ao arquivar contas selecionadas:", error);
      setFeedback({ type: "error", message: "Não foi possível arquivar os itens selecionados." });
    } finally {
      setDeletingSelected(false);
    }
  }

  async function handleBulkUpdate(
    label: string,
    getPatch: (account: AccountPayableRow) => Partial<AccountPayableFormValues>,
  ) {
    const selected = accounts.filter((account) => selectedIds.has(account.id));
    if (selected.length === 0) return;
    if (!window.confirm(`${label} em ${selected.length} conta(s) selecionada(s)?`)) return;

    setBulkUpdating(true);
    setFeedback(null);

    try {
      const client = createClient();
      const results = await Promise.all(
        selected.map((account) =>
          updateAccountPayable(client, account.id, {
            ...accountToFormValues(account),
            ...getPatch(account),
          }),
        ),
      );
      const failed = results.find((result) => result.error);

      if (failed?.error) {
        console.error("Erro técnico ao alterar contas em lote:", failed.error);
        setFeedback({ type: "error", message: "Não foi possível alterar todas as contas selecionadas." });
        return;
      }

      setSelectedIds(new Set());
      setBulkStatus("");
      setBulkCategoryId("");
      setBulkPersonId("");
      setFeedback({ type: "success", message: `${selected.length} conta(s) atualizada(s).` });
      await loadAccounts();
    } catch (error) {
      console.error("Erro técnico ao alterar contas em lote:", error);
      setFeedback({ type: "error", message: "Não foi possível alterar as contas selecionadas." });
    } finally {
      setBulkUpdating(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Obrigações"
        title="Contas"
        description="Controle contas, dívidas e pagamentos que entram no planejamento mensal."
        action={<ActionButton onClick={() => setModal({ mode: "create", account: null })}>Nova conta</ActionButton>}
      />

      <CrudFeedback feedback={feedback} />

      <SectionCard title="Parcelamentos em Contas" description="Parcelamentos geram obrigações mensais em Contas.">
        <p className="text-sm leading-6 text-ink-600">
          As parcelas geradas aparecem aqui como contas do mês com origem Parcelamento. Não cadastre a mesma parcela manualmente em Contas para evitar duplicidade.
        </p>
      </SectionCard>

      <PeriodFilter value={period} onChange={setPeriod} syncUrl />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Pendente" value={formatCurrency(summary.pending)} helper="Contas ainda abertas." tone="warning" />
        <StatCard label="Atrasado" value={formatCurrency(summary.overdue)} helper="Obrigações em atraso." tone="danger" />
        <StatCard label="Alta prioridade" value={formatCurrency(summary.highPriority)} helper="Alta ou crítica." tone="danger" />
        <StatCard label="Próximos 7 dias" value={formatCurrency(summary.nextSevenDays)} helper="Vence em breve." tone="info" />
      </section>

      <SectionCard title="Filtros" description="Refine por status, prioridade e categoria.">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar" className={inputClassName} />
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={inputClassName}>
            <option value="all">Todos status</option>
            {accountStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} className={inputClassName}>
            <option value="all">Todas prioridades</option>
            {priorityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <CategorySelect
            categories={categories}
            value={categoryFilter === "all" ? "" : categoryFilter}
            placeholder="Todas categorias"
            onChange={(value) => setCategoryFilter(value || "all")}
          />
          <select value={personFilter} onChange={(event) => setPersonFilter(event.target.value)} className={inputClassName}>
            <option value="all">Todas as pessoas</option>
            <option value="none">Sem pessoa</option>
            {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        </div>
        <div className="mt-4">
          <ViewPreferenceActions onSave={handleSaveViewPreference} onRestore={handleRestoreViewPreference} onClearFilters={handleClearFilters} />
        </div>
      </SectionCard>

      <SectionCard title="Contas cadastradas">
        {loading ? (
          <p className="text-sm text-ink-600">Carregando contas...</p>
        ) : accounts.length === 0 ? (
          <EmptyState title="Nenhuma conta cadastrada" description="Crie contas para começar a planejar o mês." />
        ) : filteredAccounts.length === 0 ? (
          <EmptyState title="Nenhuma conta no período" description="Ajuste o período ou os filtros para ver outras contas." />
        ) : (
          <>
          <BulkActionsBar
            selectedCount={selectedIds.size}
            deleting={deletingSelected || bulkUpdating}
            onClear={() => setSelectedIds(new Set())}
            onDelete={() => void handleBulkDelete()}
          >
            <select className={inputClassName} value={bulkStatus} disabled={deletingSelected || bulkUpdating} onChange={(event) => setBulkStatus(event.target.value)}>
              <option value="">Status</option>
              {accountStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <ActionButton type="button" variant="secondary" disabled={!bulkStatus || deletingSelected || bulkUpdating} onClick={() => void handleBulkUpdate("Alterar status", () => ({ status: bulkStatus }))}>
              Alterar status
            </ActionButton>
            <select className={inputClassName} value={bulkCategoryId} disabled={deletingSelected || bulkUpdating} onChange={(event) => setBulkCategoryId(event.target.value)}>
              <option value="">Categoria</option>
              <option value="__none">Sem categoria</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <ActionButton type="button" variant="secondary" disabled={!bulkCategoryId || deletingSelected || bulkUpdating} onClick={() => void handleBulkUpdate("Alterar categoria", () => ({ category_id: bulkCategoryId === "__none" ? "" : bulkCategoryId }))}>
              Alterar categoria
            </ActionButton>
            <select className={inputClassName} value={bulkPersonId} disabled={deletingSelected || bulkUpdating} onChange={(event) => setBulkPersonId(event.target.value)}>
              <option value="">Pessoa</option>
              <option value="__none">Sem pessoa</option>
              {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
            <ActionButton type="button" variant="secondary" disabled={!bulkPersonId || deletingSelected || bulkUpdating} onClick={() => void handleBulkUpdate("Alterar pessoa", () => ({ person_id: bulkPersonId === "__none" ? "" : bulkPersonId }))}>
              Alterar pessoa
            </ActionButton>
          </BulkActionsBar>
          <RowSelectionHint />
          <AccountsTable
            accounts={filteredAccounts}
            categories={categories}
            people={people}
            installments={installments}
            onEdit={(account) => setModal({ mode: "edit", account })}
            onDelete={(account) => void handleDelete(account)}
            onGenerate={(account) => void handleGenerateRecurring(account)}
            onPayWithCard={(account) => setCardPaymentModal({ account })}
            onQuickUpdate={(account, patch) => void handleQuickUpdate(account, patch)}
            allowQuickTableEdit={allowQuickTableEdit}
            generatingId={generatingId}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
          />
          </>
        )}
      </SectionCard>

      {modal ? (
        <AccountModal
          modal={modal}
          categories={categories}
          people={people}
          saving={saving}
          onSubmit={(values) => void handleSubmit(values)}
          onClose={() => setModal(null)}
        />
      ) : null}
      {cardPaymentModal ? (
        <CardPaymentModal
          account={cardPaymentModal.account}
          cards={cards}
          invoices={invoices}
          saving={saving}
          onClose={() => setCardPaymentModal(null)}
          onSubmit={(values) => void handlePayWithCard(values)}
        />
      ) : null}
    </div>
  );
}

function AccountsTable({
  accounts,
  categories,
  people,
  installments,
  onEdit,
  onDelete,
  onGenerate,
  onPayWithCard,
  onQuickUpdate,
  allowQuickTableEdit,
  generatingId,
  selectedIds,
  onSelectionChange,
}: {
  accounts: AccountPayableRow[];
  categories: AccountCategory[];
  people: AccountPerson[];
  installments: AccountInstallment[];
  onEdit: (account: AccountPayableRow) => void;
  onDelete: (account: AccountPayableRow) => void;
  onGenerate: (account: AccountPayableRow) => void;
  onPayWithCard: (account: AccountPayableRow) => void;
  onQuickUpdate: (account: AccountPayableRow, patch: Partial<AccountPayableFormValues>) => void;
  allowQuickTableEdit: boolean;
  generatingId: string | null;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
}) {
  const allSelected = accounts.length > 0 && accounts.every((account) => selectedIds.has(account.id));

  function toggleAll(checked: boolean) {
    if (checked) {
      onSelectionChange(new Set([...selectedIds, ...accounts.map((account) => account.id)]));
      return;
    }

    const next = new Set(selectedIds);
    accounts.forEach((account) => next.delete(account.id));
    onSelectionChange(next);
  }

  function toggleOne(id: string, checked: boolean) {
    const next = new Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    onSelectionChange(next);
  }

  function handleRowClick(event: React.MouseEvent<HTMLTableRowElement>, id: string) {
    if (!shouldToggleRowSelection(event)) return;
    toggleOne(id, !selectedIds.has(id));
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-ink-950/10 text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-ink-600">
          <tr>
            <th className="px-4 py-3">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(event) => toggleAll(event.target.checked)}
                aria-label="Selecionar todas as contas filtradas"
              />
            </th>
            <th className="px-4 py-3">Vencimento</th>
            <th className="px-4 py-3">Conta</th>
            <th className="px-4 py-3">Valor</th>
            <th className="px-4 py-3">Categoria</th>
            <th className="px-4 py-3">Pessoa</th>
            <th className="px-4 py-3">Origem</th>
            <th className="px-4 py-3">Prioridade</th>
            <th className="px-4 py-3">Recorrência</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-950/10">
          {accounts.map((account) => (
            <tr key={account.id} onClick={(event) => handleRowClick(event, account.id)} className="cursor-default">
              <td className="px-4 py-3">
                <input
                  type="checkbox"
                  checked={selectedIds.has(account.id)}
                  onChange={(event) => toggleOne(account.id, event.target.checked)}
                  aria-label={`Selecionar ${account.title}`}
                />
              </td>
              <td className="px-4 py-3 text-ink-600">
                {allowQuickTableEdit && !account.is_generated ? (
                  <QuickEditInput type="date" value={account.due_date} onCommit={(value) => onQuickUpdate(account, { due_date: value })} />
                ) : formatDate(account.due_date)}
              </td>
              <td className="px-4 py-3">
                {allowQuickTableEdit && !account.is_generated ? (
                  <QuickEditInput value={account.title} onCommit={(value) => onQuickUpdate(account, { title: value })} />
                ) : (
                  <TitleButton onClick={() => onEdit(account)}>{account.title}</TitleButton>
                )}
                {account.installment_id ? (
                  <p className="text-xs font-medium text-mint-600">
                    {getInstallmentOriginLabel(account, installments)}
                  </p>
                ) : null}
                <p className="text-xs text-ink-600">{account.description ?? "-"}</p>
              </td>
              <td className="px-4 py-3 font-medium text-ink-950">
                {allowQuickTableEdit && !account.is_generated ? (
                  <QuickEditInput type="number" value={String(account.amount)} onCommit={(value) => onQuickUpdate(account, { amount: value })} />
                ) : formatCurrency(Number(account.amount))}
              </td>
              <td className="px-4 py-3">
                {allowQuickTableEdit && !account.is_generated ? (
                  <QuickEditSelect value={account.category_id ?? ""} options={[{ value: "", label: "Sem categoria" }, ...categories.map((category) => ({ value: category.id, label: category.name }))]} onCommit={(value) => onQuickUpdate(account, { category_id: value })} />
                ) : (
                  <CategoryBadge category={categories.find((category) => category.id === account.category_id)} />
                )}
              </td>
              <td className="px-4 py-3 text-ink-600">{people.find((person) => person.id === account.person_id)?.name ?? "-"}</td>
              <td className="px-4 py-3">
                {account.installment_id ? (
                  <TextBadge tone="info">
                    {getInstallmentOriginLabel(account, installments)}
                  </TextBadge>
                ) : account.is_generated ? (
                  <TextBadge tone="neutral">Gerada</TextBadge>
                ) : (
                  <span className="text-ink-500">Manual</span>
                )}
              </td>
              <td className="px-4 py-3 text-ink-600">
                {allowQuickTableEdit && !account.is_generated ? (
                  <QuickEditSelect value={account.priority} options={priorityOptions} onCommit={(value) => onQuickUpdate(account, { priority: value })} />
                ) : optionLabel(priorityOptions, account.priority)}
              </td>
              <td className="px-4 py-3">
                {account.is_recurring ? (
                  <TextBadge tone={account.recurrence_parent_id ? "info" : "warning"}>
                    {account.recurrence_parent_id ? "Ocorrência" : "Recorrente"}
                  </TextBadge>
                ) : (
                  <span className="text-ink-500">-</span>
                )}
              </td>
              <td className="px-4 py-3 text-ink-600">
                {allowQuickTableEdit ? (
                  <QuickEditSelect value={account.status} options={accountStatusOptions} onCommit={(value) => onQuickUpdate(account, { status: value })} />
                ) : optionLabel(accountStatusOptions, account.status)}
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-2">
                  {account.is_recurring && !account.recurrence_parent_id ? (
                    <ActionButton
                      variant="secondary"
                      disabled={generatingId === account.id}
                      onClick={() => onGenerate(account)}
                    >
                      {generatingId === account.id ? "Gerando..." : "Gerar próximas"}
                    </ActionButton>
                  ) : null}
                  {account.status !== "paid" ? (
                    <ActionButton variant="secondary" onClick={() => onPayWithCard(account)}>Pagar com cartão</ActionButton>
                  ) : null}
                  <ActionButton variant="secondary" onClick={() => onEdit(account)}>Editar</ActionButton>
                  <ActionButton variant="danger" onClick={() => onDelete(account)}>Arquivar</ActionButton>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuickEditInput({
  value,
  type = "text",
  onCommit,
}: {
  value: string;
  type?: "text" | "number" | "date";
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commit() {
    if (draft !== value) onCommit(draft);
  }

  return (
    <input
      className="w-full min-w-28 rounded-md border border-ink-950/10 bg-white px-2 py-1 text-sm text-ink-950"
      type={type}
      step={type === "number" ? "0.01" : undefined}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") setDraft(value);
      }}
    />
  );
}

function QuickEditSelect({
  value,
  options,
  onCommit,
}: {
  value: string;
  options: { value: string; label: string }[];
  onCommit: (value: string) => void;
}) {
  return (
    <select
      className="w-full min-w-32 rounded-md border border-ink-950/10 bg-white px-2 py-1 text-sm text-ink-950"
      value={value}
      onChange={(event) => onCommit(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}

function AccountModal({
  modal,
  categories,
  people,
  saving,
  onSubmit,
  onClose,
}: {
  modal: ModalState;
  categories: AccountCategory[];
  people: AccountPerson[];
  saving: boolean;
  onSubmit: (values: AccountPayableFormValues) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState<AccountPayableFormValues>(
    modal?.mode === "edit" ? accountToFormValues(modal.account) : emptyAccountForm,
  );

  return (
    <Modal
      title={modal?.mode === "edit" ? "Editar conta" : "Nova conta"}
      description="Contas e dívidas pertencem ao seu usuário e são protegidas por RLS."
      onClose={onClose}
    >
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(values);
        }}
      >
        <FieldShell label="Título">
          <input value={values.title} onChange={(event) => setValues({ ...values, title: event.target.value })} className={inputClassName} required />
        </FieldShell>
        <FieldShell label="Valor">
          <input value={values.amount} onChange={(event) => setValues({ ...values, amount: event.target.value })} type="number" min="0" step="0.01" className={inputClassName} required />
        </FieldShell>
        <FieldShell label="Vencimento">
          <input value={values.due_date} onChange={(event) => setValues({ ...values, due_date: event.target.value })} type="date" className={inputClassName} required />
        </FieldShell>
        <FieldShell label="Categoria">
          <CategorySelect categories={categories} value={values.category_id} onChange={(category_id) => setValues({ ...values, category_id })} />
        </FieldShell>
        <FieldShell label="Pessoa">
          <select value={values.person_id} onChange={(event) => setValues({ ...values, person_id: event.target.value })} className={inputClassName}>
            <option value="">Sem pessoa</option>
            {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        </FieldShell>
        <FieldShell label="Prioridade">
          <select value={values.priority} onChange={(event) => setValues({ ...values, priority: event.target.value })} className={inputClassName}>
            {priorityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FieldShell>
        <FieldShell label="Status">
          <select value={values.status} onChange={(event) => setValues({ ...values, status: event.target.value })} className={inputClassName}>
            {accountStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FieldShell>
        <FieldShell label="Forma planejada">
          <select value={values.payment_method_planned} onChange={(event) => setValues({ ...values, payment_method_planned: event.target.value })} className={inputClassName}>
            {paymentMethodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FieldShell>
        <FieldShell label="Pode atrasar?">
          <select value={String(values.can_delay)} onChange={(event) => setValues({ ...values, can_delay: event.target.value === "true" })} className={inputClassName}>
            <option value="false">Não</option>
            <option value="true">Sim</option>
          </select>
        </FieldShell>
        <FieldShell label="Risco de atraso">
          <select value={values.delay_risk} onChange={(event) => setValues({ ...values, delay_risk: event.target.value as AccountPayableFormValues["delay_risk"] })} className={inputClassName}>
            {priorityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FieldShell>
        <FieldShell label="Conta recorrente?">
          <select
            value={String(values.is_recurring)}
            onChange={(event) => {
              const isRecurring = event.target.value === "true";
              setValues({
                ...values,
                is_recurring: isRecurring,
                recurrence_start_date: isRecurring ? values.recurrence_start_date || values.due_date : values.recurrence_start_date,
              });
            }}
            className={inputClassName}
          >
            <option value="false">Não</option>
            <option value="true">Sim</option>
          </select>
        </FieldShell>
        {values.is_recurring ? (
          <>
            <FieldShell label="Frequência">
              <select value={values.recurrence_frequency} onChange={(event) => setValues({ ...values, recurrence_frequency: event.target.value as AccountPayableFormValues["recurrence_frequency"] })} className={inputClassName}>
                <option value="monthly">Mensal</option>
                <option value="weekly">Semanal</option>
                <option value="yearly">Anual</option>
              </select>
            </FieldShell>
            <FieldShell label="Início da recorrência">
              <input
                type="date"
                value={values.recurrence_start_date || values.due_date}
                onChange={(event) => setValues({ ...values, recurrence_start_date: event.target.value })}
                className={inputClassName}
              />
            </FieldShell>
            <FieldShell label="Fim da recorrência opcional">
              <input type="date" value={values.recurrence_end_date} onChange={(event) => setValues({ ...values, recurrence_end_date: event.target.value })} className={inputClassName} />
            </FieldShell>
            <FieldShell label="Quantidade de próximas ocorrências a gerar">
              <input
                type="number"
                min="0"
                max="24"
                value={values.recurrence_occurrences}
                onChange={(event) => setValues({ ...values, recurrence_occurrences: event.target.value })}
                className={inputClassName}
              />
            </FieldShell>
            <div className="rounded-md border border-amberRisk-500/20 bg-amberRisk-100 p-4 text-sm leading-6 text-ink-800 md:col-span-2">
              Esta ação cria contas futuras com base nesta recorrência. Você pode editar ou excluir cada ocorrência depois.
            </div>
          </>
        ) : null}
        <div className="md:col-span-2">
          <FieldShell label="Descrição">
            <textarea value={values.description} onChange={(event) => setValues({ ...values, description: event.target.value })} className={inputClassName} rows={3} />
          </FieldShell>
        </div>
        <div className="md:col-span-2">
          <FieldShell label="Notas">
            <textarea value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} className={inputClassName} rows={3} />
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

function CardPaymentModal({
  account,
  cards,
  invoices,
  saving,
  onClose,
  onSubmit,
}: {
  account: AccountPayableRow;
  cards: AccountCreditCard[];
  invoices: AccountInvoice[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (values: AccountCardPaymentFormValues) => void;
}) {
  const [values, setValues] = useState<AccountCardPaymentFormValues>({
    credit_card_id: "",
    invoice_id: "",
    transaction_date: todayISO(),
    description: account.title,
    amount: String(account.amount),
  });
  const filteredInvoices = values.credit_card_id
    ? invoices.filter((invoice) => invoice.credit_card_id === values.credit_card_id)
    : invoices;

  return (
    <Modal
      title="Pagar com cartão"
      description="Pagar com cartão move esta obrigação para a fatura selecionada."
      onClose={onClose}
    >
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(values);
        }}
      >
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 md:col-span-2">
          A conta será marcada como paga por cartão e deixará de aparecer como pendente no caixa.
          A fatura escolhida passa a carregar essa pressão financeira.
        </p>
        <FieldShell label="Cartão">
          <select
            required
            className={inputClassName}
            value={values.credit_card_id}
            onChange={(event) => setValues({ ...values, credit_card_id: event.target.value, invoice_id: "" })}
          >
            <option value="">Selecione</option>
            {cards.map((card) => (
              <option key={card.id} value={card.id}>{card.name}{card.issuer ? ` - ${card.issuer}` : ""}</option>
            ))}
          </select>
        </FieldShell>
        <FieldShell label="Fatura">
          <select required className={inputClassName} value={values.invoice_id} onChange={(event) => setValues({ ...values, invoice_id: event.target.value })}>
            <option value="">Selecione</option>
            {filteredInvoices.map((invoice) => (
              <option key={invoice.id} value={invoice.id}>
                {invoice.reference_month.slice(0, 7)} - vence {formatDate(invoice.due_date)}
              </option>
            ))}
          </select>
        </FieldShell>
        <FieldShell label="Data">
          <input type="date" required className={inputClassName} value={values.transaction_date} onChange={(event) => setValues({ ...values, transaction_date: event.target.value })} />
        </FieldShell>
        <FieldShell label="Valor">
          <input min="0" step="0.01" type="number" required className={inputClassName} value={values.amount} onChange={(event) => setValues({ ...values, amount: event.target.value })} />
        </FieldShell>
        <div className="md:col-span-2">
          <FieldShell label="Descrição">
            <input required className={inputClassName} value={values.description} onChange={(event) => setValues({ ...values, description: event.target.value })} />
          </FieldShell>
        </div>
        <div className="flex justify-end gap-2 md:col-span-2">
          <ActionButton type="button" variant="secondary" onClick={onClose}>Cancelar</ActionButton>
          <ActionButton type="submit" disabled={saving}>{saving ? "Movendo..." : "Confirmar"}</ActionButton>
        </div>
      </form>
    </Modal>
  );
}

function getInstallmentOriginLabel(account: AccountPayableRow, installments: AccountInstallment[]) {
  const installment = installments.find((item) => item.id === account.installment_id);
  const total = installment?.installment_total ?? installment?.installment_count;
  const installmentNumber = account.installment_number;

  if (installmentNumber && total) {
    return `Parcelamento: parcela ${installmentNumber}/${total}`;
  }

  if (installmentNumber) {
    return `Parcelamento: parcela ${installmentNumber}`;
  }

  return "Parcelamento";
}
