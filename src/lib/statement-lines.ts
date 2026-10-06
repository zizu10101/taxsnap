import type { StatementLineKind } from "./database.types.ts";
import { STATEMENT_MAX_LINES } from "./statement-config.ts";

// Turns the model's raw JSON for one chunk of a card statement into rows that
// satisfy the statement_lines constraints (0052), or throws. Nothing is guessed
// or silently dropped: a line with an unreadable date/amount/kind fails the
// whole chunk (so the user retries it) instead of vanishing, because a vanished
// line would make the statement total not add up with no explanation.
// Pure and import-free (type imports only) so it unit-tests with `node --test`.

export const LINE_KINDS: readonly StatementLineKind[] = [
  "purchase",
  "payment",
  "refund",
  "fee",
  "interest",
  "other",
];

export interface ExtractedLine {
  page: number;
  line_no: number;
  txn_date: string;
  description: string;
  /** Signed as the card sees it: a charge is positive, a credit/refund negative. */
  amount: number;
  kind: StatementLineKind;
  currency: string;
  original_amount: number | null;
  original_currency: string | null;
  suggested_category: string | null;
}

export interface ChunkHeader {
  issuer: string | null;
  period_start: string | null;
  period_end: string | null;
  opening_balance: number | null;
  closing_balance: number | null;
  statement_total: number | null;
  statement_total_kind: "purchases" | "new_balance" | null;
}

export interface SanitizeContext {
  pageFrom: number;
  pageTo: number;
  /** YYYY-MM-DD */
  today: string;
  periodStart: string | null;
  periodEnd: string | null;
  /** Categories the model may suggest (defaults + this owner's custom ones). */
  allowedCategories: string[];
  /**
   * The category interest and fees are suggested under - the owner's bank-charges
   * category under whatever it is currently called - or null when they removed it
   * (then nothing is suggested for them). See statement-categories.ts.
   */
  bankChargesCategory: string | null;
}

export class ChunkValidationError extends Error {
  readonly code = "BAD_LINES";
  constructor(message: string) {
    super(message);
    this.name = "ChunkValidationError";
  }
}

const DAY_MS = 86_400_000;
// Statement lines are dated near their period (a charge a few days before the
// period starts can post inside it). Anything further out is a misread year.
const PERIOD_SLACK_DAYS = 45;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function dayNumber(isoDate: string): number {
  return Math.round(new Date(`${isoDate}T00:00:00Z`).getTime() / DAY_MS);
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toMoney(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[$,\s]/g, "")) : NaN;
  return Number.isFinite(n) ? round2(n) : null;
}

// Card numbers must never be stored: collapse any 13-19 digit run (with
// optional spaces/dashes) to "****" plus its last four digits.
export function maskCardNumbers(text: string): string {
  return text.replace(/\b(?:\d[ -]?){12,18}\d\b/g, (m) => `****${m.replace(/\D/g, "").slice(-4)}`);
}

function cleanDescription(value: unknown): string {
  const text = typeof value === "string" ? value : "";
  return maskCardNumbers(text.replace(/\s+/g, " ").trim()).slice(0, 200);
}

function canonicalCategory(value: unknown, allowed: string[]): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const key = value.trim().toLowerCase();
  return allowed.find((c) => c.toLowerCase() === key) ?? null;
}

function parseHeader(raw: unknown): ChunkHeader {
  const h = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  let periodStart = isIsoDate(h.period_start) ? h.period_start : null;
  let periodEnd = isIsoDate(h.period_end) ? h.period_end : null;
  if (periodStart && periodEnd && periodEnd < periodStart) {
    periodStart = null;
    periodEnd = null;
  }
  const kind = h.statement_total_kind === "purchases" || h.statement_total_kind === "new_balance"
    ? h.statement_total_kind
    : null;
  const total = toMoney(h.statement_total);
  return {
    issuer: typeof h.issuer === "string" && h.issuer.trim() ? h.issuer.trim().slice(0, 100) : null,
    period_start: periodStart,
    period_end: periodEnd,
    opening_balance: toMoney(h.opening_balance),
    closing_balance: toMoney(h.closing_balance),
    statement_total: total !== null && kind ? total : null,
    statement_total_kind: total !== null && kind ? kind : null,
  };
}

export function sanitizeChunk(
  raw: unknown,
  ctx: SanitizeContext,
): { lines: ExtractedLine[]; header: ChunkHeader } {
  const root = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const header = parseHeader(root.header);
  const rawLines = Array.isArray(root.lines) ? root.lines : [];
  if (rawLines.length > STATEMENT_MAX_LINES) {
    throw new ChunkValidationError(`Too many lines on these pages (${rawLines.length}).`);
  }

  // The period known so far (from earlier chunks, or this chunk's own header)
  // bounds how far a line's date may drift.
  const periodStart = ctx.periodStart ?? header.period_start;
  const periodEnd = ctx.periodEnd ?? header.period_end;
  const lowest = periodStart ? dayNumber(periodStart) - PERIOD_SLACK_DAYS : dayNumber("2000-01-01");
  const highest = Math.min(
    dayNumber(ctx.today) + 1,
    periodEnd ? dayNumber(periodEnd) + PERIOD_SLACK_DAYS : Number.POSITIVE_INFINITY,
  );
  const pagesInChunk = ctx.pageTo - ctx.pageFrom + 1;
  const bankCharges = canonicalCategory(ctx.bankChargesCategory, ctx.allowedCategories);

  const lineNoByPage = new Map<number, number>();
  const lines: ExtractedLine[] = [];

  rawLines.forEach((entry, index) => {
    const l = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const where = `line ${index + 1}`;

    const pageInChunk = Number(l.page_in_chunk);
    if (!Number.isInteger(pageInChunk) || pageInChunk < 1 || pageInChunk > pagesInChunk) {
      throw new ChunkValidationError(`${where}: page is outside this chunk.`);
    }
    const page = ctx.pageFrom + pageInChunk - 1;

    if (!isIsoDate(l.date)) throw new ChunkValidationError(`${where}: unreadable date.`);
    const day = dayNumber(l.date);
    if (day < lowest || day > highest) {
      throw new ChunkValidationError(`${where}: date ${l.date} is outside the statement period.`);
    }

    const description = cleanDescription(l.description);
    if (!description) throw new ChunkValidationError(`${where}: missing description.`);

    const parsedAmount = toMoney(l.amount);
    if (parsedAmount === null) throw new ChunkValidationError(`${where}: unreadable amount.`);
    // A $0.00 line (a rate note, a zero-balance row) has no effect on anything.
    if (parsedAmount === 0) return;

    const rawKind = typeof l.kind === "string" ? (l.kind.trim().toLowerCase() as StatementLineKind) : null;
    if (!rawKind || !LINE_KINDS.includes(rawKind)) {
      throw new ChunkValidationError(`${where}: unknown line type.`);
    }

    // Sign convention: charges positive, credits negative. A payment to the
    // card or a refund is always a credit; a "purchase" that came out negative
    // is a refund.
    let kind = rawKind;
    let amount = parsedAmount;
    if (kind === "payment" || kind === "refund") amount = -Math.abs(amount);
    if (kind === "purchase" && amount < 0) kind = "refund";

    let suggested = kind === "payment" ? null : canonicalCategory(l.suggested_category, ctx.allowedCategories);
    if (!suggested && (kind === "fee" || kind === "interest") && bankCharges) {
      suggested = bankCharges;
    }

    const currency =
      typeof l.currency === "string" && /^[A-Za-z]{3}$/.test(l.currency.trim())
        ? l.currency.trim().toUpperCase()
        : "CAD";
    const originalCurrency =
      typeof l.original_currency === "string" && /^[A-Za-z]{3}$/.test(l.original_currency.trim())
        ? l.original_currency.trim().toUpperCase()
        : null;
    const originalAmount = originalCurrency ? toMoney(l.original_amount) : null;

    const lineNo = (lineNoByPage.get(page) ?? 0) + 1;
    lineNoByPage.set(page, lineNo);

    lines.push({
      page,
      line_no: lineNo,
      txn_date: l.date,
      description,
      amount,
      kind,
      currency,
      original_amount: originalAmount,
      original_currency: originalAmount === null ? null : originalCurrency,
      suggested_category: suggested,
    });
  });

  return { lines, header };
}
