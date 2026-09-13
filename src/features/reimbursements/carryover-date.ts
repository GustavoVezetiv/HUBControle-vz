const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Returns the fifth weekday (Monday through Friday) of the month after the
 * receipt date. Public holidays are not inferred without a regional calendar.
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
  let businessDays = 0;

  while (businessDays < 5) {
    const weekday = candidate.getUTCDay();
    if (weekday !== 0 && weekday !== 6) businessDays += 1;
    if (businessDays === 5) return formatIsoDate(candidate);
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }

  return null;
}

function formatIsoDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
