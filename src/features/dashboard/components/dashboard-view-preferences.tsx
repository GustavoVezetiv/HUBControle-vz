"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { ViewPreferenceActions } from "@/features/shared/crud-ui";
import { parsePeriodSearchParams, type PeriodValue } from "@/features/shared/period";
import { PeriodFilter } from "@/features/shared/period-filter";
import { clearViewPreference, loadViewPreference, preferenceRecord, preferenceString, saveViewPreference } from "@/features/shared/view-preferences";
import { createClient } from "@/lib/supabase/client";

type DashboardViewPreference = {
  period?: PeriodValue;
  mode?: DashboardLayoutMode;
};

export type DashboardLayoutMode = "simple" | "full";

const defaultDashboardPreference: Required<DashboardViewPreference> = {
  period: parsePeriodSearchParams({}),
  mode: "simple",
};

function buildPeriodQuery(period: PeriodValue) {
  const params = new URLSearchParams();
  params.set("period", period.preset);

  if (period.startDate) params.set("start", period.startDate);
  if (period.endDate) params.set("end", period.endDate);

  return params;
}

function buildDashboardQuery(period: PeriodValue, mode: DashboardLayoutMode) {
  const params = buildPeriodQuery(period);
  params.set("mode", mode);
  return params;
}

export function DashboardViewPreferences({ initialPeriod }: { initialPeriod: PeriodValue }) {
  const client = useMemo(() => createClient(), []);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [feedback, setFeedback] = useState<string | null>(null);
  const initialMode = (searchParams.get("mode") as DashboardLayoutMode | null) ?? defaultDashboardPreference.mode;

  useEffect(() => {
    let active = true;

    async function applySavedPreference() {
      if (searchParams.has("period") || searchParams.has("start") || searchParams.has("end") || searchParams.has("mode")) return;

      const { data } = await client.auth.getUser();
      if (!active) return;

      const preference = loadViewPreference<DashboardViewPreference>("dashboard", data.user?.id);
      if (!preference) return;

      const savedPeriod = preferenceRecord(preference.period, defaultDashboardPreference.period);
      const matchesCurrent =
        savedPeriod.preset === initialPeriod.preset &&
        savedPeriod.startDate === initialPeriod.startDate &&
        savedPeriod.endDate === initialPeriod.endDate;

      const savedMode = preferenceString(preference.mode, ["simple", "full"] as const, defaultDashboardPreference.mode);
      if (matchesCurrent && savedMode === initialMode) return;

      router.replace(`${pathname}?${buildDashboardQuery(savedPeriod, savedMode).toString()}`, { scroll: false });
    }

    void applySavedPreference();

    return () => {
      active = false;
    };
  }, [client, initialMode, initialPeriod.endDate, initialPeriod.preset, initialPeriod.startDate, pathname, router, searchParams]);

  async function withUserId(callback: (userId: string | null) => void) {
    const { data } = await client.auth.getUser();
    callback(data.user?.id ?? null);
  }

  function handleChange(period: PeriodValue) {
    router.replace(`${pathname}?${buildDashboardQuery(period, initialMode).toString()}`, { scroll: false });
  }

  function handleModeChange(mode: DashboardLayoutMode) {
    router.replace(`${pathname}?${buildDashboardQuery(initialPeriod, mode).toString()}`, { scroll: false });
  }

  function handleSave() {
    void withUserId((userId) => {
      const saved = saveViewPreference("dashboard", userId, { period: initialPeriod, mode: initialMode });
      setFeedback(saved ? "Visualização padrão do dashboard salva." : "Não foi possível salvar a visualização padrão.");
    });
  }

  function handleRestore() {
    void withUserId((userId) => {
      clearViewPreference("dashboard", userId);
      setFeedback("Visualização padrão do dashboard restaurada.");
      router.replace(`${pathname}?${buildDashboardQuery(defaultDashboardPreference.period, defaultDashboardPreference.mode).toString()}`, { scroll: false });
    });
  }

  function handleClearFilters() {
    setFeedback("Filtros do dashboard limpos.");
    router.replace(`${pathname}?${buildDashboardQuery(defaultDashboardPreference.period, defaultDashboardPreference.mode).toString()}`, { scroll: false });
  }

  return (
    <div className="space-y-4">
      <PeriodFilter
        value={initialPeriod}
        onChange={handleChange}
        description="Escolha o período usado nos cards, listas e resumo financeiro do dashboard."
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`hub-filter-chip rounded-full px-3 py-1.5 text-sm font-semibold transition ${initialMode === "simple" ? "hub-filter-chip-active" : ""}`}
          onClick={() => handleModeChange("simple")}
        >
          Resumo simples
        </button>
        <button
          type="button"
          className={`hub-filter-chip rounded-full px-3 py-1.5 text-sm font-semibold transition ${initialMode === "full" ? "hub-filter-chip-active" : ""}`}
          onClick={() => handleModeChange("full")}
        >
          Visão completa
        </button>
      </div>
      <ViewPreferenceActions onSave={handleSave} onRestore={handleRestore} onClearFilters={handleClearFilters} />
      {feedback ? <p className="text-sm text-ink-600 dark:text-slate-300">{feedback}</p> : null}
    </div>
  );
}
