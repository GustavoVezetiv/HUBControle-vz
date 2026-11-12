const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Fifth business day of the following month, excluding weekends and Brazilian
 * national holidays. Local holidays and optional public-sector days do not
 * change this calendar.
 */
export function getFifthBusinessDayOfNextMonth(receivedDate: string) {
  const match = ISO_DATE_PATTERN.exec(receivedDate);
  if (!match) return null;

  const [, yearValue, monthValue, dayValue] = match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const referenceDate = new Date(Date.UTC(year, month - 1, day));

  if (
    referenceDate.getUTCFullYear() !== year ||
    referenceDate.getUTCMonth() !== month - 1 ||
    referenceDate.getUTCDate() !== day
  ) {
    return null;
  }

  const candidate = new Date(Date.UTC(year, month, 1));
  const holidays = getBrazilNationalHolidays(candidate.getUTCFullYear());
  let businessDays = 0;

  while (businessDays < 5) {
    const weekday = candidate.getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !holidays.has(formatIsoDate(candidate)))
      businessDays += 1;
    if (businessDays === 5) return formatIsoDate(candidate);
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }

  return null;
}

export function getReimbursementToday(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Cuiaba" }).format(now);
}

export function getBrazilNationalHolidays(year: number) {
  const fixed = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "12-25"];
  if (year >= 2024) fixed.push("11-20");
  // Gregorian Easter (Meeus/Jones/Butcher); Good Friday is two days earlier.
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const base = h + l - 7 * m + 114;
  const goodFriday = new Date(
    Date.UTC(year, Math.floor(base / 31) - 1, (base % 31) + 1 - 2),
  );
  return new Set([...fixed.map((date) => `${year}-${date}`), formatIsoDate(goodFriday)]);
}

function formatIsoDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
