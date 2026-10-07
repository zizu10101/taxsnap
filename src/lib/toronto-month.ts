// The start of the current calendar month in Toronto, as a UTC instant. start_statement_import (0052)
// counts a user's imports since exactly this moment (date_trunc('month', now() at time zone
// 'America/Toronto') at time zone 'America/Toronto'), so the app shows the same number the database
// enforces. Pure and import-free.

export function torontoMonthStart(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value);

  // Midnight on the 1st in Toronto is 05:00 UTC in winter (EST) or 04:00 UTC in summer (EDT). The
  // daylight-saving switches happen mid-month, never on the 1st at midnight, so exactly one of the
  // two candidates reads "00:00" back in Toronto.
  for (const utcHour of [5, 4]) {
    const candidate = new Date(Date.UTC(year, month - 1, 1, utcHour, 0, 0));
    const hour = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(candidate);
    if (Number(hour) === 0) return candidate;
  }
  return new Date(Date.UTC(year, month - 1, 1, 5, 0, 0));
}
