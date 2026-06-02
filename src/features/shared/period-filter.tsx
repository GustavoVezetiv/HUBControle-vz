"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { SectionCard } from "@/components/ui/section-card";
import { FieldShell, inputClassName } from "@/features/shared/crud-ui";
import {
  type PeriodValue,
  updatePeriodPreset,
  type PeriodPreset,
} from "@/features/shared/period";

type PeriodFilterProps = {
  value: PeriodValue;
  onChange?: (value: PeriodValue) => void;
  description?: string;
  syncUrl?: boolean;
};

export function PeriodFilter({
  value,
  onChange,
  description = "Escolha o recorte de datas usado na lista e nos cards de resumo.",
  syncUrl = false,
}: PeriodFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const visiblePeriodOptions: Array<{ value: PeriodPreset; label: string }> = [
    { value: "current_month", label: "Mês atual" },
    { value: "next_month", label: "Próximo mês" },
    { value: "last_30_days", label: "Últimos 30 dias" },
    { value: "next_30_days", label: "Próximos 30 dias" },
    { value: "all", label: "Todos" },
  ];

  function emit(nextValue: PeriodValue) {
    onChange?.(nextValue);

    if (!syncUrl) return;

    const params = new URLSearchParams(searchParams.toString());
    params.set("period", nextValue.preset);

    if (nextValue.startDate) {
      params.set("start", nextValue.startDate);
    } else {
      params.delete("start");
    }

    if (nextValue.endDate) {
      params.set("end", nextValue.endDate);
    } else {
      params.delete("end");
    }

    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <SectionCard title="Período" description={description}>
      <div className="grid gap-3 md:grid-cols-3">
        <FieldShell label="Ver registros de">
          <select
            className={inputClassName}
            value={value.preset}
            onChange={(event) => emit(updatePeriodPreset(value, event.target.value as PeriodPreset))}
          >
            {visiblePeriodOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            {value.preset === "custom" ? <option value="custom">Personalizado</option> : null}
          </select>
        </FieldShell>

        <FieldShell label="Data inicial">
          <input
            className={inputClassName}
            type="date"
            value={value.startDate}
            disabled={value.preset === "all"}
            onChange={(event) => emit({ ...value, preset: "custom", startDate: event.target.value })}
          />
        </FieldShell>
        <FieldShell label="Data final">
          <input
            className={inputClassName}
            type="date"
            value={value.endDate}
            disabled={value.preset === "all"}
            onChange={(event) => emit({ ...value, preset: "custom", endDate: event.target.value })}
          />
        </FieldShell>
      </div>
    </SectionCard>
  );
}
