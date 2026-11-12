"use client";

import { CreditCard, SlidersHorizontal } from "lucide-react";
import { FieldShell, inputClassName } from "@/features/shared/crud-ui";
import { SearchableSelect } from "@/features/shared/searchable-select";
import {
  defaultAdvancedReimbursementFilters,
  type AdvancedReimbursementFilters,
} from "../filters";
import type { ReimbursementCard } from "../types";

export function AdvancedReimbursementFiltersPanel({
  filters,
  cards,
  onChange,
}: {
  filters: AdvancedReimbursementFilters;
  cards: ReimbursementCard[];
  onChange: (filters: AdvancedReimbursementFilters) => void;
}) {
  const activeCount = Object.entries(defaultAdvancedReimbursementFilters).filter(
    ([key, value]) => filters[key as keyof AdvancedReimbursementFilters] !== value,
  ).length;
  return (
    <details className="mt-4 rounded-lg border border-ink-950/10 bg-slate-50/60 dark:border-white/10 dark:bg-slate-900/40">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-semibold">
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        Mais filtros {activeCount > 0 ? `· ${activeCount} ativo(s)` : ""}
      </summary>
      <div className="grid gap-3 px-4 pb-4 md:grid-cols-3">
        <FieldShell label="Saldo">
          <select
            className={inputClassName}
            value={filters.balanceFilter}
            onChange={(event) =>
              onChange({ ...filters, balanceFilter: event.target.value })
            }
          >
            <option value="all">Todos os saldos</option>
            <option value="open">Em aberto</option>
            <option value="closed">Quitados ou encerrados</option>
          </select>
        </FieldShell>
        <FieldShell label="Vencimento">
          <select
            className={inputClassName}
            value={filters.maturityFilter}
            onChange={(event) =>
              onChange({ ...filters, maturityFilter: event.target.value })
            }
          >
            <option value="all">Qualquer vencimento</option>
            <option value="late">Vencidos com saldo</option>
            <option value="today">Vencem hoje</option>
            <option value="week">Hoje e próximos 7 dias</option>
            <option value="undated">Sem data prevista</option>
          </select>
        </FieldShell>
        <FieldShell label="Recorrência">
          <select
            className={inputClassName}
            value={filters.recurrenceFilter}
            onChange={(event) =>
              onChange({ ...filters, recurrenceFilter: event.target.value })
            }
          >
            <option value="all">Avulsos e recorrentes</option>
            <option value="recurring">Somente recorrentes</option>
            <option value="single">Somente avulsos</option>
          </select>
        </FieldShell>
        <FieldShell label="Cartão vinculado">
          <SearchableSelect
            label="Filtrar por cartão"
            options={[
              { value: "all", label: "Todos os cartões e vínculos" },
              { value: "none", label: "Sem cartão vinculado" },
              ...cards.map((card) => ({
                value: card.id,
                label: card.name,
                description: card.issuer ?? "Cartão",
                icon: <CreditCard className="h-5 w-5 text-mint-600" />,
              })),
            ]}
            value={filters.cardFilter}
            onChange={(cardFilter) => onChange({ ...filters, cardFilter })}
            clearable={false}
          />
        </FieldShell>
        <FieldShell label="Saldo mínimo (R$)">
          <input
            type="number"
            min="0"
            step="0.01"
            className={inputClassName}
            placeholder="Sem mínimo"
            value={filters.minAmount}
            onChange={(event) => onChange({ ...filters, minAmount: event.target.value })}
          />
        </FieldShell>
        <FieldShell label="Saldo máximo (R$)">
          <input
            type="number"
            min="0"
            step="0.01"
            className={inputClassName}
            placeholder="Sem máximo"
            value={filters.maxAmount}
            onChange={(event) => onChange({ ...filters, maxAmount: event.target.value })}
          />
        </FieldShell>
        <p className="text-xs text-ink-600 dark:text-slate-400 md:col-span-3">
          A faixa considera o principal ainda a receber, sem juros. Os filtros são
          combinados com o período e os demais campos acima.
        </p>
      </div>
    </details>
  );
}
