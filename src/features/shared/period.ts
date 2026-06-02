export type PeriodPreset =
  | "current_month"
  | "next_month"
  | "last_30_days"
  | "next_30_days"
  | "current_year"
  | "all"
  | "custom";

export type PeriodValue = {
  preset: PeriodPreset;
  startDate: string;
  endDate: string;
};

export const periodOptions: Array<{ value: PeriodPreset; label: string }> = [
  { value: "current_month", label: "Mês atual" },
  { value: "next_month", label: "Próximo mês" },
  { value: "last_30_days", label: "Últimos 30 dias" },
  { value: "next_30_days", label: "Próximos 30 dias" },
  { value: "current_year", label: "Ano atual" },
  { value: "all", label: "Todos" },
  { value: "custom", label: "Personalizado" },
];

export function createDefaultPeriodValue(preset: PeriodPreset = "current_month", now = new Date()): PeriodValue {
  return getPeriodValue(preset, now);
}

export function getPeriodValue(preset: PeriodPreset, now = new Date()): PeriodValue {
  const today = startOfDay(now);
  const year = today.getFullYear();
  const month = today.getMonth();

  if (preset === "all") {
    return { preset, startDate: "", endDate: "" };
  }

  if (preset === "next_month") {
    return {
      preset,
      startDate: toDateInputValue(new Date(year, month + 1, 1)),
      endDate: toDateInputValue(new Date(year, month + 2, 0)),
    };
  }

  if (preset === "last_30_days") {
    return {
      preset,
      startDate: toDateInputValue(addDays(today, -30)),
      endDate: toDateInputValue(today),
    };
  }

  if (preset === "next_30_days") {
    return {
      preset,
      startDate: toDateInputValue(today),
      endDate: toDateInputValue(addDays(today, 30)),
    };
  }

  if (preset === "current_year") {
    return {
      preset,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
    };
  }

  return {
    preset,
    startDate: toDateInputValue(new Date(year, month, 1)),
    endDate: toDateInputValue(new Date(year, month + 1, 0)),
  };
}

export function updatePeriodPreset(current: PeriodValue, preset: PeriodPreset): PeriodValue {
  if (preset === "custom") {
    return {
      preset,
      startDate: current.startDate || getPeriodValue("current_month").startDate,
      endDate: current.endDate || getPeriodValue("current_month").endDate,
    };
  }

  return getPeriodValue(preset);
}

export function isDateInPeriod(date: string | null | undefined, period: PeriodValue) {
  if (period.preset === "all") return true;

  const normalized = normalizeDate(date);
  if (!normalized) return false;

  return (!period.startDate || normalized >= period.startDate) && (!period.endDate || normalized <= period.endDate);
}

export function isAnyDateInPeriod(dates: Array<string | null | undefined>, period: PeriodValue) {
  if (period.preset === "all") return true;

  return dates.some((date) => isDateInPeriod(date, period));
}

export function isDateRangeInPeriod(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  period: PeriodValue,
) {
  if (period.preset === "all") return true;

  const normalizedStart = normalizeDate(startDate);
  const normalizedEnd = normalizeDate(endDate) ?? normalizedStart;

  if (!normalizedStart || !normalizedEnd) return false;

  return normalizedStart <= period.endDate && normalizedEnd >= period.startDate;
}

export function parsePeriodSearchParams(params: Record<string, string | string[] | undefined>): PeriodValue {
  const rawPreset = readParam(params.period);
  const preset = periodOptions.some((option) => option.value === rawPreset)
    ? (rawPreset as PeriodPreset)
    : "current_month";
  const startDate = readParam(params.start);
  const endDate = readParam(params.end);

  if (preset === "custom") {
    return {
      preset,
      startDate: startDate || getPeriodValue("current_month").startDate,
      endDate: endDate || getPeriodValue("current_month").endDate,
    };
  }

  const period = getPeriodValue(preset);
  return {
    ...period,
    startDate: startDate || period.startDate,
    endDate: endDate || period.endDate,
  };
}

export function normalizeDate(date: string | null | undefined) {
  if (!date) return null;
  if (/^\d{4}-\d{2}$/.test(date)) return `${date}-01`;
  return date.slice(0, 10);
}

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
