"use client";

import { useState } from "react";

import { ActionButton, FieldShell, inputClassName, Modal } from "@/features/shared/crud-ui";
import { formatCurrency, formatDate } from "@/features/shared/format";
import { linkedEntryTypeOptions, type CashAvailability, type LinkedEntryContext, type LinkedEntryFormValues } from "@/features/linked-entries/types";

type PersonOption = {
  id: string;
  name: string;
};

export function InsufficientCashModal({
  availability,
  onCancel,
  onContinue,
  onRegisterEntry,
}: {
  availability: CashAvailability | null;
  onCancel: () => void;
  onContinue: () => void;
  onRegisterEntry: () => void;
}) {
  return (
    <Modal title="Entrada insuficiente" description="Revise a origem do dinheiro antes de concluir o pagamento." onClose={onCancel}>
      <div className="space-y-4">
        <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950 dark:border-amber-400/50 dark:bg-amber-950/35 dark:text-amber-100">
          Não encontramos entrada/saldo suficiente para justificar este pagamento.
        </p>
        {availability ? (
          <div className="grid gap-3 rounded-md border border-ink-950/10 bg-white p-4 text-sm text-ink-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 md:grid-cols-2">
            <p>Período: <strong>{formatDate(availability.periodStart)} a {formatDate(availability.periodEnd)}</strong></p>
            <p>Pagamento: <strong>{formatCurrency(availability.requiredAmount)}</strong></p>
            <p>Entradas registradas: <strong>{formatCurrency(availability.inflows)}</strong></p>
            <p>Saídas pagas: <strong>{formatCurrency(availability.outflows)}</strong></p>
            <p className="md:col-span-2">Saldo localizado: <strong>{formatCurrency(availability.available)}</strong></p>
          </div>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <ActionButton type="button" variant="secondary" onClick={onCancel}>Cancelar</ActionButton>
          <ActionButton type="button" variant="secondary" onClick={onContinue}>Continuar mesmo assim</ActionButton>
          <ActionButton type="button" onClick={onRegisterEntry}>Registrar entrada</ActionButton>
        </div>
      </div>
    </Modal>
  );
}

export function LinkedEntryModal({
  context,
  people = [],
  saving,
  onClose,
  onSubmit,
}: {
  context: LinkedEntryContext;
  people?: PersonOption[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (values: LinkedEntryFormValues) => void;
}) {
  const [values, setValues] = useState<LinkedEntryFormValues>({
    title: context.title,
    amount: String(context.amount),
    date: context.date,
    type: context.defaultType,
    person_id: context.personId ?? "",
    notes: context.notes ?? "",
  });

  return (
    <Modal title="Registrar entrada vinculada" description="Use esta entrada para justificar o pagamento sem transformar tudo em renda livre." onClose={onClose}>
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(values);
        }}
      >
        <div className="rounded-md border border-mint-500/30 bg-mint-50 px-4 py-3 text-sm text-ink-800 dark:border-mint-400/30 dark:bg-mint-950/30 dark:text-slate-100 md:col-span-2">
          Só o tipo <strong>Receita</strong> entra como renda livre. Reembolso, aporte, transferência, dinheiro já disponível e empréstimo entram como caixa vinculado.
        </div>
        <div className="rounded-md border border-ink-950/10 bg-slate-50 px-4 py-3 text-sm text-ink-700 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-200 md:col-span-2">
          <p className="font-semibold text-ink-950 dark:text-slate-100">Vínculo financeiro</p>
          <p className="mt-1">
            {linkedPaymentLabel(context.paymentType)} · {formatCurrency(context.amount)} · {formatDate(context.date)}
          </p>
          <p className="mt-1 text-xs text-ink-500 dark:text-slate-400">
            Esta entrada ficará vinculada ao registro atual e será usada para justificar o pagamento sem duplicar receita.
          </p>
        </div>
        <div className="md:col-span-2">
          <FieldShell label="Título">
            <input required className={inputClassName} value={values.title} onChange={(event) => setValues({ ...values, title: event.target.value })} />
          </FieldShell>
        </div>
        <FieldShell label="Valor">
          <input required min="0.01" step="0.01" type="number" className={inputClassName} value={values.amount} onChange={(event) => setValues({ ...values, amount: event.target.value })} />
        </FieldShell>
        <FieldShell label="Data">
          <input required type="date" className={inputClassName} value={values.date} onChange={(event) => setValues({ ...values, date: event.target.value })} />
        </FieldShell>
        <FieldShell label="Tipo da entrada">
          <select className={inputClassName} value={values.type} onChange={(event) => setValues({ ...values, type: event.target.value as LinkedEntryFormValues["type"] })}>
            {linkedEntryTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FieldShell>
        <FieldShell label="Origem/Pessoa">
          <select className={inputClassName} value={values.person_id} onChange={(event) => setValues({ ...values, person_id: event.target.value })}>
            <option value="">Sem pessoa</option>
            {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        </FieldShell>
        <div className="md:col-span-2">
          <FieldShell label="Observação">
            <textarea rows={3} className={inputClassName} value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} />
          </FieldShell>
        </div>
        <div className="flex justify-end gap-2 md:col-span-2">
          <ActionButton type="button" variant="secondary" onClick={onClose}>Cancelar</ActionButton>
          <ActionButton type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar entrada e continuar"}</ActionButton>
        </div>
      </form>
    </Modal>
  );
}

function linkedPaymentLabel(paymentType: LinkedEntryContext["paymentType"]) {
  if (paymentType === "invoice_payment") return "Pagamento de fatura";
  if (paymentType === "installment_payment") return "Pagamento de parcela";
  if (paymentType === "reimbursement_receipt") return "Recebimento de reembolso";
  return "Pagamento";
}
