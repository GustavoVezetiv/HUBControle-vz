"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { ViewPreferenceActions } from "@/features/shared/crud-ui";
import { parsePeriodSearchParams, type PeriodValue } from "@/features/shared/period";
import { PeriodFilter } from "@/features/shared/period-filter";
import { clearViewPreference, loadViewPreference, preferenceRecord, saveViewPreference } from "@/features/shared/view-preferences";
import { createClient } from "@/lib/supabase/client";

type DashboardViewPreference = {
  period?: PeriodValue;
};

const defaultDashboardPreference: Required<DashboardViewPreference> = {
  period: parsePeriodSearchParams({}),
};

function buildPeriodQuery(period: PeriodValue) {
  const params = new URLSearchParams();
  params.set("period", period.preset);

  if (period.startDate) params.set("start", period.startDate);
  if (period.endDate) params.set("end", period.endDate);

  return params;
}

export function DashboardViewPreferences({ initialPeriod }: { initialPeriod: PeriodValue }) {
  const client = useMemo(() => createClient(), []);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function applySavedPreference() {
      if (searchParams.has("period") || searchParams.has("start") || searchParams.has("end")) return;

      const { data } = await client.auth.getUser();
      if (!active) return;

      const preference = loadViewPreference<DashboardViewPreference>("dashboard", data.user?.id);
      if (!preference) return;

      const savedPeriod = preferenceRecord(preference.period, defaultDashboardPreference.period);
      const matchesCurrent =
        savedPeriod.preset === initialPeriod.preset &&
        savedPeriod.startDate === initialPeriod.startDate &&
        savedPeriod.endDate === initialPeriod.endDate;

      if (matchesCurrent) return;

      router.replace(`${pathname}?${buildPeriodQuery(savedPeriod).toString()}`, { scroll: false });
    }

    void applySavedPreference();

    return () => {
      active = false;
    };
  }, [client, initialPeriod.endDate, initialPeriod.preset, initialPeriod.startDate, pathname, router, searchParams]);

  async function withUserId(callback: (userId: string | null) => void) {
    const { data } = await client.auth.getUser();
    callback(data.user?.id ?? null);
  }

  function handleChange(period: PeriodValue) {
    router.replace(`${pathname}?${buildPeriodQuery(period).toString()}`, { scroll: false });
  }

  function handleSave() {
    void withUserId((userId) => {
      const saved = saveViewPreference("dashboard", userId, { period: initialPeriod });
      setFeedback(saved ? "Visualização padrão do dashboard salva." : "Não foi possível salvar a visualização padrão.");
    });
  }

  function handleRestore() {
    void withUserId((userId) => {
      clearViewPreference("dashboard", userId);
      setFeedback("Visualização padrão do dashboard restaurada.");
      router.replace(`${pathname}?${buildPeriodQuery(defaultDashboardPreference.period).toString()}`, { scroll: false });
    });
  }

  function handleClearFilters() {
    setFeedback("Filtros do dashboard limpos.");
    router.replace(`${pathname}?${buildPeriodQuery(defaultDashboardPreference.period).toString()}`, { scroll: false });
  }

  return (
    <div className="space-y-4">
      <PeriodFilter
        value={initialPeriod}
        onChange={handleChange}
        description="Escolha o período usado nos cards, listas e resumo financeiro do dashboard."
      />
      <ViewPreferenceActions onSave={handleSave} onRestore={handleRestore} onClearFilters={handleClearFilters} />
      {feedback ? <p className="text-sm text-ink-600">{feedback}</p> : null}
    </div>
  );
}
