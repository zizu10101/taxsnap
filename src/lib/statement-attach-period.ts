import { isIsoDate } from "./statement-lines.ts";

// Attaching a scanned receipt to a statement-created expense takes the receipt's
// date. If that moves the expense into a different calendar month - and so possibly
// a different quarter, which is what an HST return is filed on - the person has to
// choose which date to keep. There is no default: either one can be wrong for them.
// (Quarters are calendar quarters, the same as the app's own date-range filters.)
// Pure and import-light so it unit-tests directly.

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export interface PeriodChange {
  crossesMonth: boolean;
  crossesQuarter: boolean;
  fromMonth: string; // "April 2026"
  toMonth: string;
  fromQuarter: string; // "Q2 2026"
  toQuarter: string;
}

function parts(date: string) {
  const [y, m] = date.split("-").map(Number);
  return { year: y, month: m - 1, quarter: Math.floor((m - 1) / 3) + 1 };
}

export function periodChange(statementDate: string, receiptDate: string): PeriodChange {
  const a = parts(statementDate);
  const b = parts(receiptDate);
  return {
    crossesMonth: a.year !== b.year || a.month !== b.month,
    crossesQuarter: a.year !== b.year || a.quarter !== b.quarter,
    fromMonth: `${MONTH_NAMES[a.month]} ${a.year}`,
    toMonth: `${MONTH_NAMES[b.month]} ${b.year}`,
    fromQuarter: `Q${a.quarter} ${a.year}`,
    toQuarter: `Q${b.quarter} ${b.year}`,
  };
}

export type AttachDateResult =
  | { ok: true; date: string }
  | { ok: false; code: "DATE_CHOICE_REQUIRED" | "INVALID_DATE" };

// The date the expense ends up with. Within the same month the receipt's date is
// used as before (nothing a report would notice). Across a month boundary the caller
// must have said which to keep; if they haven't, it is refused rather than guessed.
export function attachDate(
  statementDate: string,
  receiptDate: string,
  keepStatementDate: boolean | undefined,
): AttachDateResult {
  if (!isIsoDate(statementDate) || !isIsoDate(receiptDate)) return { ok: false, code: "INVALID_DATE" };
  if (!periodChange(statementDate, receiptDate).crossesMonth) return { ok: true, date: receiptDate };
  if (typeof keepStatementDate !== "boolean") return { ok: false, code: "DATE_CHOICE_REQUIRED" };
  return { ok: true, date: keepStatementDate ? statementDate : receiptDate };
}
