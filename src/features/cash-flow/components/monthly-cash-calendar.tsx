"use client";

import { CalendarDays, Link2, TrendingDown, TrendingUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { SectionCard } from "@/components/ui/section-card";
import { ActionButton, FieldShell, inputClassName, Modal } from "@/features/shared/crud-ui";
import type { FlowRow } from "@/features/decision/financial-summary";
import { formatCurrency } from "@/features/shared/format";
import { createClient } from "@/lib/supabase/client";

type CalendarDay = {
  date: string;
  day: number;
  rows: FlowRow[];
  freeIncome: number;
  linkedIncome: number;
  outgoing: number;
  balance: number;
};

export function MonthlyCashCalendar({
  monthStart,
  rows,
  startingBalance = 0,
  userId,
}: {
  monthStart: string;
  rows: FlowRow[];
  startingBalance?: number;
  userId: string | null;
}) {
  const days = buildCalendarDays(monthStart, rows, startingBalance);
  const monthLabel = formatMonth(monthStart);
  const leadingEmptyDays = getWeekdayIndex(monthStart);
  const endingBalance = days.at(-1)?.balance ?? startingBalance;
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  return (
    <>
      <SectionCard
        title={`Calendário financeiro · ${monthLabel}`}
        description="Clique em um dia para registrar saldo disponível ou uma despesa prevista."
      >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-ink-950/10 bg-slate-50 px-4 py-3 dark:border-white/10 dark:bg-slate-900/70">
        <div className="flex items-center gap-2 text-sm text-ink-700 dark:text-slate-200">
          <CalendarDays className="h-4 w-4 text-mint-600" />
          <span>Saldo inicial: <strong>{formatCurrency(startingBalance)}</strong></span>
        </div>
        <p className={`text-sm font-semibold ${endingBalance < 0 ? "text-danger-600" : "text-mint-600"}`}>
          Saldo ao fim do mês: {formatCurrency(endingBalance)}
        </p>
      </div>

      <div className="hidden overflow-x-auto lg:block">
        <div className="min-w-[1050px]">
          <div className="mb-2 grid grid-cols-7 gap-2 text-center text-xs font-semibold uppercase text-ink-600 dark:text-slate-300">
            {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((weekday) => <span key={weekday}>{weekday}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: leadingEmptyDays }, (_, index) => (
              <div key={`empty-${index}`} className="min-h-40 rounded-md border border-dashed border-ink-950/5 bg-slate-50/40 dark:border-white/5 dark:bg-slate-950/20" />
            ))}
            {days.map((day) => <CalendarDayCard key={day.date} day={day} onSelect={setSelectedDate} />)}
          </div>
        </div>
      </div>

      <div className="space-y-3 lg:hidden">
        {days.filter((day) => day.rows.length > 0).map((day) => <CalendarDayCard key={day.date} day={day} compact onSelect={setSelectedDate} />)}
        {days.every((day) => day.rows.length === 0) ? (
          <p className="rounded-md border border-dashed border-ink-950/10 px-4 py-8 text-center text-sm text-ink-600 dark:border-white/10 dark:text-slate-300">
            Nenhuma entrada ou saída prevista neste mês.
          </p>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-4 text-xs text-ink-600 dark:text-slate-300">
        <Legend icon={<TrendingUp className="h-3.5 w-3.5" />} label="Renda livre" className="text-mint-600" />
        <Legend icon={<Link2 className="h-3.5 w-3.5" />} label="Dinheiro vinculado" className="text-sky-600" />
        <Legend icon={<TrendingDown className="h-3.5 w-3.5" />} label="Saídas" className="text-danger-600" />
      </div>
      </SectionCard>
      {selectedDate ? <CashFlowQuickEntryModal date={selectedDate} userId={userId} onClose={() => setSelectedDate(null)} /> : null}
    </>
  );
}

function CalendarDayCard({ day, compact = false, onSelect }: { day: CalendarDay; compact?: boolean; onSelect: (date: string) => void }) {
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onSelect(day.date)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(day.date);
        }
      }}
      className={`hub-calendar-day cursor-pointer rounded-md border border-ink-950/10 bg-white p-3 text-left dark:border-white/10 dark:bg-slate-950/55 ${compact ? "min-h-0" : "min-h-40"}`}
      title={`Adicionar movimento em ${day.date}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex size-7 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-ink-950 dark:bg-slate-800 dark:text-slate-100">
          {day.day}
        </span>
        <span className={`text-xs font-semibold ${day.balance < 0 ? "text-danger-600" : "text-ink-700 dark:text-slate-200"}`}>
          {formatCurrency(day.balance)}
        </span>
      </div>
      {day.rows.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          {day.freeIncome > 0 ? <CalendarValue prefix="+" value={day.freeIncome} label="renda" tone="success" /> : null}
          {day.linkedIncome > 0 ? <CalendarValue prefix="+" value={day.linkedIncome} label="vinculado" tone="info" /> : null}
          {day.outgoing > 0 ? <CalendarValue prefix="−" value={day.outgoing} label="saídas" tone="danger" /> : null}
          <div className="border-t border-ink-950/8 pt-2 dark:border-white/10">
            {day.rows.slice(0, 3).map((row, index) => (
              <p key={`${row.type}-${row.description}-${index}`} className="truncate text-xs text-ink-600 dark:text-slate-300" title={row.description}>
                {row.description}
              </p>
            ))}
            {day.rows.length > 3 ? <p className="text-xs font-medium text-mint-600">+ {day.rows.length - 3} movimentação(ões)</p> : null}
          </div>
        </div>
      ) : (
        <p className="mt-8 text-center text-xs text-ink-500 dark:text-slate-500">Sem movimento</p>
      )}
    </article>
  );
}

function CashFlowQuickEntryModal({ date, userId, onClose }: { date: string; userId: string | null; onClose: () => void }) {
  const router = useRouter();
  const [kind, setKind] = useState<"available_cash" | "expense">("available_cash");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("0");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const numericAmount = Number(amount);

    if (!userId || !title.trim() || !Number.isFinite(numericAmount) || numericAmount < 0) {
      setError("Informe uma descrição e um valor maior ou igual a zero.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const client = createClient();
      const result = kind === "available_cash"
        ? await client.from("income_sources").insert({
            user_id: userId,
            name: title.trim(),
            description: notes.trim() || null,
            source_type: "available_cash",
            inflow_kind: "third_party_money",
            amount: numericAmount,
            expected_date: date,
            received_date: null,
            received_at: null,
            status: "expected",
            confidence: "high",
            is_recurring: false,
            notes: "Entrada manual criada pelo calendário financeiro.",
          })
        : await client.from("accounts_payable").insert({
            user_id: userId,
            title: title.trim(),
            description: notes.trim() || null,
            amount: numericAmount,
            due_date: date,
            status: "pending",
            priority: "medium",
            risk_level: "medium",
            payment_method_planned: "unknown",
            can_delay: true,
            delay_risk: "medium",
            source_type: "manual_cash_flow",
            is_generated: false,
            notes: "Despesa manual criada pelo calendário financeiro.",
          });

      if (result.error) {
        console.error("Erro técnico ao criar movimento pelo calendário:", result.error);
        setError("Não foi possível registrar o movimento. Tente novamente.");
        return;
      }

      onClose();
      router.refresh();
    } catch (caughtError) {
      console.error("Erro técnico ao criar movimento pelo calendário:", caughtError);
      setError("Não foi possível registrar o movimento. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Adicionar movimento no dia" onClose={onClose}>
      <form className="grid gap-4" onSubmit={handleSubmit}>
        <p className="text-sm text-ink-600 dark:text-slate-300">Data selecionada: <strong>{date.split("-").reverse().join("/")}</strong></p>
        <FieldShell label="Tipo de movimento">
          <select className={inputClassName} value={kind} onChange={(event) => setKind(event.target.value as "available_cash" | "expense")}>
            <option value="available_cash">Adicionar saldo disponível</option>
            <option value="expense">Adicionar débito / despesa</option>
          </select>
        </FieldShell>
        <FieldShell label="Descrição">
          <input autoFocus className={inputClassName} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={kind === "available_cash" ? "Ex.: Saldo já disponível" : "Ex.: Conta eventual"} />
        </FieldShell>
        <FieldShell label="Valor">
          <input min="0" step="0.01" type="number" className={inputClassName} value={amount} onChange={(event) => setAmount(event.target.value)} />
        </FieldShell>
        <FieldShell label="Observação">
          <textarea className={inputClassName} value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
        </FieldShell>
        {kind === "available_cash" ? <p className="rounded-md border border-sky-500/25 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-950/35 dark:text-sky-100">Saldo disponível ajuda a projeção de caixa, mas não é registrado como renda livre.</p> : null}
        {error ? <p className="text-sm font-medium text-danger-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <ActionButton type="button" variant="secondary" onClick={onClose}>Cancelar</ActionButton>
          <ActionButton type="submit" disabled={saving}>{saving ? "Salvando..." : "Adicionar movimento"}</ActionButton>
        </div>
      </form>
    </Modal>
  );
}

function CalendarValue({ prefix, value, label, tone }: { prefix: string; value: number; label: string; tone: "success" | "info" | "danger" }) {
  const toneClass = tone === "success" ? "text-mint-600" : tone === "info" ? "text-sky-600 dark:text-sky-300" : "text-danger-600";
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-ink-500 dark:text-slate-400">{label}</span>
      <strong className={toneClass}>{prefix}{formatCurrency(value)}</strong>
    </div>
  );
}

function Legend({ icon, label, className }: { icon: React.ReactNode; label: string; className: string }) {
  return <span className={`inline-flex items-center gap-1.5 ${className}`}>{icon}<span>{label}</span></span>;
}

function buildCalendarDays(monthStart: string, rows: FlowRow[], startingBalance: number) {
  const [year, month] = monthStart.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  let balance = startingBalance;

  return Array.from({ length: lastDay }, (_, index) => {
    const day = index + 1;
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dayRows = rows.filter((row) => row.date.slice(0, 10) === date);
    const freeIncome = sum(dayRows.filter((row) => row.direction === "in" && !row.linkedMoney));
    const linkedIncome = sum(dayRows.filter((row) => row.direction === "in" && row.linkedMoney));
    const outgoing = sum(dayRows.filter((row) => row.direction === "out"));
    balance += freeIncome + linkedIncome - outgoing;

    return { date, day, rows: dayRows, freeIncome, linkedIncome, outgoing, balance };
  });
}

function sum(rows: FlowRow[]) {
  return rows.reduce((total, row) => total + Number(row.amount || 0), 0);
}

function getWeekdayIndex(monthStart: string) {
  return new Date(`${monthStart}T12:00:00`).getDay();
}

function formatMonth(monthStart: string) {
  const [year, month] = monthStart.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}
