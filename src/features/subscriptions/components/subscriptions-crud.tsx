"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { categoryModuleDefinitions, filterCategoriesByScopes } from "@/features/categories/scopes";
import { ActionButton, CategoryBadge, CategorySelect, CrudFeedback, FieldShell, inputClassName, Modal, TextBadge } from "@/features/shared/crud-ui";
import { formatCurrency, formatDate, todayISO } from "@/features/shared/format";
import type { FeedbackState } from "@/features/shared/types";
import {
  createSubscription,
  generateSubscriptionOccurrence,
  listSubscriptionsSupportData,
  updateSubscription,
} from "@/features/subscriptions/queries";
import {
  emptySubscriptionForm,
  subscriptionToFormValues,
  type SubscriptionCategory,
  type SubscriptionFormValues,
  type SubscriptionMemberRow,
  type SubscriptionOccurrenceRow,
  type SubscriptionPerson,
  type SubscriptionRow,
  type SubscriptionCard,
} from "@/features/subscriptions/types";
import { createClient } from "@/lib/supabase/client";

type ModalState = { mode: "create" } | { mode: "edit"; subscription: SubscriptionRow } | null;
type GenerateModalState = { subscription: SubscriptionRow } | null;

export function SubscriptionsCrud() {
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [members, setMembers] = useState<SubscriptionMemberRow[]>([]);
  const [occurrences, setOccurrences] = useState<SubscriptionOccurrenceRow[]>([]);
  const [cards, setCards] = useState<SubscriptionCard[]>([]);
  const [people, setPeople] = useState<SubscriptionPerson[]>([]);
  const [categories, setCategories] = useState<SubscriptionCategory[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [generateModal, setGenerateModal] = useState<GenerateModalState>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const scopedCategories = useMemo(
    () => filterCategoriesByScopes(categories, [...categoryModuleDefinitions.invoices.scopes, "expense", "general"]),
    [categories],
  );

  const activeSubscriptions = subscriptions.filter((subscription) => subscription.status === "active");
  const monthlyTotal = activeSubscriptions.reduce((sum, subscription) => sum + Number(subscription.amount || 0), 0);
  const sharedTotal = activeSubscriptions.reduce(
    (sum, subscription) => sum + members.filter((member) => member.subscription_id === subscription.id && member.is_active).reduce((subTotal, member) => subTotal + Number(member.share_amount || 0), 0),
    0,
  );

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
    const result = await listSubscriptionsSupportData(client);
    const errors = [result.subscriptions, result.members, result.occurrences, result.cards, result.people, result.categories].find((item) => item.error)?.error;
    if (errors) {
      console.error("Erro técnico ao carregar assinaturas:", errors);
      setFeedback({ type: "error", message: "Não foi possível carregar as assinaturas." });
    } else {
      setSubscriptions(result.subscriptions.data ?? []);
      setMembers(result.members.data ?? []);
      setOccurrences(result.occurrences.data ?? []);
      setCards(result.cards.data ?? []);
      setPeople(result.people.data ?? []);
      setCategories(result.categories.data ?? []);
    }
    setLoading(false);
  }

  useEffect(() => { void loadData(); }, []);

  async function handleSave(values: SubscriptionFormValues) {
    if (!userId) return;
    setSaving(true);
    setFeedback(null);
    try {
      const result = modal?.mode === "edit"
        ? await updateSubscription(createClient(), userId, modal.subscription.id, values)
        : await createSubscription(createClient(), userId, values);
      if (result.error) {
        console.error("Erro técnico ao salvar assinatura:", result.error);
        setFeedback({ type: "error", message: result.error.message });
        return;
      }
      setFeedback({ type: "success", message: modal?.mode === "edit" ? "Assinatura atualizada." : "Assinatura criada." });
      setModal(null);
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao salvar assinatura:", error);
      setFeedback({ type: "error", message: "Não foi possível salvar a assinatura." });
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerate(referenceMonth: string) {
    if (!userId || !generateModal) return;
    setSaving(true);
    setFeedback(null);
    try {
      const result = await generateSubscriptionOccurrence(createClient(), userId, generateModal.subscription, referenceMonth);
      if (result.error) {
        console.error("Erro técnico ao gerar cobrança de assinatura:", result.error);
        setFeedback({ type: "error", message: result.error.message });
        return;
      }
      setGenerateModal(null);
      setFeedback({ type: "success", message: `Cobrança lançada na fatura e ${result.data?.reimbursementCount ?? 0} reembolso(s) criado(s).` });
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao gerar cobrança de assinatura:", error);
      setFeedback({ type: "error", message: "Não foi possível gerar a cobrança da assinatura." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Cobranças recorrentes"
        title="Assinaturas"
        description="Controle assinaturas do cartão e gere, de forma manual e segura, o lançamento e os reembolsos de cada mês."
        action={<ActionButton onClick={() => setModal({ mode: "create" })}>Nova assinatura</ActionButton>}
      />
      <CrudFeedback feedback={feedback} />
      <section className="grid gap-4 md:grid-cols-3">
        <StatCard label="Assinaturas ativas" value={String(activeSubscriptions.length)} helper="Cobranças prontas para gerar." tone="info" />
        <StatCard label="Custo mensal" value={formatCurrency(monthlyTotal)} helper="Total lançado no cartão por mês." tone="warning" />
        <StatCard label="Reembolso previsto" value={formatCurrency(sharedTotal)} helper="Parte compartilhada com outras pessoas." tone="success" />
      </section>
      <SectionCard title="Assinaturas cadastradas" description="Gerar cobrança cria o lançamento na fatura do cartão e títulos separados para cada participante.">
        {loading ? <p className="text-sm text-ink-600 dark:text-slate-300">Carregando assinaturas...</p> : subscriptions.length === 0 ? (
          <EmptyState title="Nenhuma assinatura cadastrada" description="Cadastre Microsoft Family, streaming ou qualquer cobrança recorrente que queira acompanhar fora da tela de faturas." />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {subscriptions.map((subscription) => {
              const subscriptionMembers = members.filter((member) => member.subscription_id === subscription.id && member.is_active);
              const latestOccurrence = occurrences.find((occurrence) => occurrence.subscription_id === subscription.id);
              const card = cards.find((item) => item.id === subscription.credit_card_id);
              const category = categories.find((item) => item.id === subscription.category_id);
              const sharedAmount = subscriptionMembers.reduce((sum, member) => sum + Number(member.share_amount || 0), 0);
              return (
                <article key={subscription.id} className="hub-card rounded-lg border border-ink-950/10 p-5 dark:border-white/10">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-ink-950 dark:text-slate-100">{subscription.name}</h2>
                      <p className="mt-1 text-sm text-ink-600 dark:text-slate-300">{card ? `${card.name}${card.issuer ? ` · ${card.issuer}` : ""}` : "Cartão não encontrado"}</p>
                    </div>
                    <TextBadge tone={subscription.status === "active" ? "success" : subscription.status === "paused" ? "warning" : "neutral"}>{subscription.status === "active" ? "Ativa" : subscription.status === "paused" ? "Pausada" : "Cancelada"}</TextBadge>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2"><CategoryBadge category={category} /><TextBadge tone="info">Dia {subscription.billing_day}</TextBadge>{subscriptionMembers.length > 0 ? <TextBadge tone="warning">{subscriptionMembers.length} pessoa(s)</TextBadge> : <TextBadge>Uso pessoal</TextBadge>}</div>
                  <div className="mt-4 grid gap-2 text-sm text-ink-600 dark:text-slate-300 sm:grid-cols-2">
                    <p>Valor mensal: <strong className="text-ink-950 dark:text-slate-100">{formatCurrency(Number(subscription.amount))}</strong></p>
                    <p>Reembolso previsto: <strong className="text-ink-950 dark:text-slate-100">{formatCurrency(sharedAmount)}</strong></p>
                    <p>Início: <strong className="text-ink-950 dark:text-slate-100">{formatDate(subscription.start_date)}</strong></p>
                    <p>Última geração: <strong className="text-ink-950 dark:text-slate-100">{latestOccurrence ? `${formatDate(latestOccurrence.reference_month)} · ${latestOccurrence.status === "generated" ? "Gerada" : latestOccurrence.status === "failed" ? "Com erro" : "Em processamento"}` : "Ainda não gerada"}</strong></p>
                  </div>
                  {subscription.description ? <p className="mt-4 text-sm leading-6 text-ink-600 dark:text-slate-300">{subscription.description}</p> : null}
                  <div className="mt-5 flex flex-wrap gap-2">
                    <ActionButton variant="secondary" onClick={() => setModal({ mode: "edit", subscription })}>Editar</ActionButton>
                    <ActionButton disabled={subscription.status !== "active"} onClick={() => setGenerateModal({ subscription })}>Gerar cobrança</ActionButton>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </SectionCard>
      {modal ? <SubscriptionModal modal={modal} cards={cards} categories={scopedCategories} people={people} members={members} saving={saving} onClose={() => setModal(null)} onSubmit={(values) => void handleSave(values)} /> : null}
      {generateModal ? <GenerateSubscriptionModal subscription={generateModal.subscription} saving={saving} onClose={() => setGenerateModal(null)} onSubmit={(referenceMonth) => void handleGenerate(referenceMonth)} /> : null}
    </div>
  );
}

function SubscriptionModal({ modal, cards, categories, people, members, saving, onClose, onSubmit }: {
  modal: NonNullable<ModalState>;
  cards: SubscriptionCard[];
  categories: SubscriptionCategory[];
  people: SubscriptionPerson[];
  members: SubscriptionMemberRow[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (values: SubscriptionFormValues) => void;
}) {
  const [values, setValues] = useState<SubscriptionFormValues>(modal.mode === "edit" ? subscriptionToFormValues(modal.subscription, members.filter((member) => member.subscription_id === modal.subscription.id)) : emptySubscriptionForm);
  const [personToAdd, setPersonToAdd] = useState("");
  const availablePeople = people.filter((person) => !values.members.some((member) => member.person_id === person.id));
  const sharedTotal = values.members.reduce((sum, member) => sum + Number(member.share_amount || 0), 0);

  function addPerson() {
    if (!personToAdd) return;
    setValues((current) => ({ ...current, members: [...current.members, { person_id: personToAdd, share_amount: "0" }] }));
    setPersonToAdd("");
  }

  return (
    <Modal title={modal.mode === "edit" ? "Editar assinatura" : "Nova assinatura"} description="A geração é manual: você escolhe o mês, cria o lançamento no cartão e, quando houver participantes, cria os reembolsos correspondentes." onClose={onClose} headerAction={<ActionButton type="submit" form="subscription-form" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</ActionButton>}>
      <form id="subscription-form" className="grid gap-4 md:grid-cols-2" aria-busy={saving} onSubmit={(event) => { event.preventDefault(); onSubmit(values); }}>
        <div className="md:col-span-2"><FieldShell label="Nome da assinatura"><input required className={inputClassName} value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} placeholder="Ex.: Microsoft Family" /></FieldShell></div>
        <FieldShell label="Cartão"><select required className={inputClassName} value={values.credit_card_id} onChange={(event) => setValues({ ...values, credit_card_id: event.target.value })}><option value="">Selecione o cartão</option>{cards.map((card) => <option key={card.id} value={card.id}>{card.name}{card.issuer ? ` · ${card.issuer}` : ""}</option>)}</select></FieldShell>
        <FieldShell label="Categoria"><CategorySelect categories={categories} value={values.category_id} onChange={(category_id) => setValues({ ...values, category_id })} /></FieldShell>
        <FieldShell label="Valor mensal"><input required min="0.01" step="0.01" type="number" className={inputClassName} value={values.amount} onChange={(event) => setValues({ ...values, amount: event.target.value })} /></FieldShell>
        <FieldShell label="Dia de cobrança"><input required min="1" max="31" type="number" className={inputClassName} value={values.billing_day} onChange={(event) => setValues({ ...values, billing_day: event.target.value })} /></FieldShell>
        <FieldShell label="Início"><input required type="date" className={inputClassName} value={values.start_date} onChange={(event) => setValues({ ...values, start_date: event.target.value })} /></FieldShell>
        <FieldShell label="Fim opcional"><input type="date" className={inputClassName} value={values.end_date} onChange={(event) => setValues({ ...values, end_date: event.target.value })} /></FieldShell>
        <FieldShell label="Status"><select className={inputClassName} value={values.status} onChange={(event) => setValues({ ...values, status: event.target.value as SubscriptionFormValues["status"] })}><option value="active">Ativa</option><option value="paused">Pausada</option><option value="cancelled">Cancelada</option></select></FieldShell>
        <div className="rounded-md border border-mint-500/25 bg-mint-50 px-3 py-3 text-sm text-ink-800 dark:bg-mint-950/25 dark:text-slate-100"><p className="font-semibold">Parte compartilhada</p><p className="mt-1">{formatCurrency(sharedTotal)} de {formatCurrency(Number(values.amount || 0))} será cobrado de outras pessoas.</p></div>
        <div className="md:col-span-2 rounded-md border border-ink-950/10 bg-slate-50 p-4 dark:border-white/10 dark:bg-slate-900/50">
          <div className="flex flex-wrap items-end gap-2"><div className="min-w-56 flex-1"><FieldShell label="Pessoa para reembolso"><select className={inputClassName} value={personToAdd} onChange={(event) => setPersonToAdd(event.target.value)}><option value="">Selecione uma pessoa</option>{availablePeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></FieldShell></div><ActionButton type="button" variant="secondary" onClick={addPerson} disabled={!personToAdd}>Adicionar</ActionButton></div>
          {values.members.length === 0 ? <p className="mt-4 text-sm text-ink-600 dark:text-slate-300">Sem participantes, a assinatura será apenas uma despesa pessoal no cartão.</p> : <div className="mt-4 grid gap-2">{values.members.map((member) => { const person = people.find((item) => item.id === member.person_id); return <div key={member.person_id} className="grid items-center gap-2 rounded-md border border-ink-950/10 bg-white p-3 sm:grid-cols-[1fr_10rem_auto] dark:border-white/10 dark:bg-slate-950"><span className="text-sm font-medium text-ink-950 dark:text-slate-100">{person?.name ?? "Pessoa"}</span><input min="0.01" step="0.01" type="number" className={inputClassName} value={member.share_amount} onChange={(event) => setValues((current) => ({ ...current, members: current.members.map((item) => item.person_id === member.person_id ? { ...item, share_amount: event.target.value } : item) }))} aria-label={`Valor devido por ${person?.name ?? "pessoa"}`} /><button type="button" onClick={() => setValues((current) => ({ ...current, members: current.members.filter((item) => item.person_id !== member.person_id) }))} className="rounded p-2 text-ink-600 transition hover:bg-danger-100 hover:text-danger-600 dark:text-slate-300 dark:hover:bg-danger-950/40" title={`Remover ${person?.name ?? "pessoa"}`}><X className="h-4 w-4" /></button></div>; })}</div>}
        </div>
        <div className="md:col-span-2"><FieldShell label="Descrição"><textarea rows={3} className={inputClassName} value={values.description} onChange={(event) => setValues({ ...values, description: event.target.value })} /></FieldShell></div>
        <div className="md:col-span-2"><FieldShell label="Observações"><textarea rows={3} className={inputClassName} value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} /></FieldShell></div>
        <div className="flex justify-end gap-2 md:col-span-2"><ActionButton type="button" variant="secondary" onClick={onClose}>Cancelar</ActionButton><ActionButton type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</ActionButton></div>
      </form>
    </Modal>
  );
}

function GenerateSubscriptionModal({ subscription, saving, onClose, onSubmit }: { subscription: SubscriptionRow; saving: boolean; onClose: () => void; onSubmit: (referenceMonth: string) => void }) {
  const [referenceMonth, setReferenceMonth] = useState(todayISO().slice(0, 7));
  return <Modal title="Gerar cobrança da assinatura" description={`Será criado um lançamento de ${formatCurrency(Number(subscription.amount))} na fatura do cartão. Reembolsos compartilhados também serão gerados, sem duplicar o mês.`} onClose={onClose} headerAction={<ActionButton type="submit" form="subscription-generate-form" disabled={saving}>{saving ? "Gerando..." : "Gerar cobrança"}</ActionButton>}><form id="subscription-generate-form" className="grid gap-4" aria-busy={saving} onSubmit={(event) => { event.preventDefault(); onSubmit(referenceMonth); }}><FieldShell label="Mês de referência"><input required type="month" className={inputClassName} value={referenceMonth} onChange={(event) => setReferenceMonth(event.target.value)} /></FieldShell><p className="rounded-md border border-amber-500/30 bg-amber-50 px-3 py-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">Esta ação cria a cobrança somente uma vez para o mês selecionado. Depois, cada reembolso continua independente para a pessoa correspondente.</p><div className="flex justify-end gap-2"><ActionButton type="button" variant="secondary" onClick={onClose}>Cancelar</ActionButton><ActionButton type="submit" disabled={saving}>{saving ? "Gerando..." : "Gerar cobrança"}</ActionButton></div></form></Modal>;
}
