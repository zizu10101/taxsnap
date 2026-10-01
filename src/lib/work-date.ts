// Validation for the work_date (a plain calendar date, YYYY-MM-DD) on manually
// logged/edited hours. Kept free of imports so it can be unit-tested with
// `node --test` and shared by the hours dialog and the /api/hours routes -
// the API is the boundary, the dialog just tells the person sooner.
//
// Same rule as clocked sessions (owner_edit_time_session refuses future
// times): hours worked can't be dated in the future.

export const FUTURE_DATE_MESSAGE = "Date can't be in the future.";

// Calendar date in Toronto, the same zone the database uses for the
// work_date of clocked sessions.
export function torontoToday(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// Server-side check. Returns an error message, or null if the date is fine.
// Allows up to one day past Toronto's today: the browser sends the person's
// own local date, and in a zone ahead of Toronto (Atlantic, Newfoundland)
// that is already "tomorrow" for a short window after their midnight - a
// stricter server check would wrongly reject their real "today". The dialog
// itself is strict (it knows the person's local date).
export function validateWorkDateForApi(value: unknown, now: Date): string | null {
  if (typeof value !== "string" || !isRealDate(value)) return "Enter a valid date.";
  if (value > addDays(torontoToday(now), 1)) return FUTURE_DATE_MESSAGE;
  return null;
}

// Client-side check against the person's own local calendar date.
export function validateWorkDateForDialog(value: string, localToday: string): string | null {
  if (!value || !isRealDate(value)) return "Pick a date for these hours.";
  if (value > localToday) return FUTURE_DATE_MESSAGE;
  return null;
}
