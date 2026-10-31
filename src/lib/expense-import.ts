// Import expenses from a supplier's CSV (one row per invoice).
//
// Everything here is pure (no I/O, no logging, no AI): the dialog uses it in the browser to read the
// file and build the rows to send, and POST /api/receipts/import uses planExpenseImport() to decide,
// again and on its own, what every row becomes. The server never receives the file, only the mapped
// rows, and nothing a person typed is ever put into a log line or an error message.
//
// It reuses the client import's parser and column-guessing (client-import.ts): the same delimiters,
// BOM and quote handling, the same exact-heading matching and the same row / size caps. Only the
// target set is its own.

import {
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  guessMappingWith,
  normalizeHeader,
  type ParsedTable,
} from "./client-import.ts";
import { cleanInvoiceNumber, INVOICE_NUMBER_MAX, normalizeInvoiceNumber } from "./invoice-number.ts";
import { vendorKey } from "./merchant-name.ts";
import { canonicalCategory, isBuiltInCategory, OTHER_CATEGORY } from "./tax-categories.ts";
import { calculateTax, categoryCodeFor, round2, type CategoryDefaults } from "./tax-codes.ts";

export { IMPORT_MAX_BYTES as EXPENSE_IMPORT_MAX_BYTES, IMPORT_MAX_ROWS as EXPENSE_IMPORT_MAX_ROWS };

// How many rows go into one database insert (the whole import is at most IMPORT_MAX_ROWS).
export const EXPENSE_IMPORT_BATCH = 100;
export const SUPPLIER_MAX = 200;
export const DESCRIPTION_MAX = 200;
// receipts.total_amount is numeric(12,2): anything near the limit is a typo, not an invoice.
export const AMOUNT_MAX = 999_999_999;

// ------------------------------------------------------------------ column mapping

export type ExpenseImportTarget =
  | "date"
  | "supplier"
  | "invoice_number"
  | "subtotal"
  | "tax"
  | "total"
  | "category"
  | "description"
  | "ignore";

export const EXPENSE_TARGETS: ExpenseImportTarget[] = [
  "date",
  "supplier",
  "invoice_number",
  "subtotal",
  "tax",
  "total",
  "category",
  "description",
  "ignore",
];

export const EXPENSE_TARGET_LABELS: Record<ExpenseImportTarget, string> = {
  date: "Date",
  supplier: "Supplier",
  invoice_number: "Invoice number",
  subtotal: "Subtotal",
  tax: "Tax (HST)",
  total: "Total",
  category: "Category",
  description: "Description",
  ignore: "Ignore",
};

// Headings (lower case, punctuation dropped) that mean each field. Exact matches only, as in the
// client import: "Amount" is the total, but "Amount Paid To Date" is not guessed at.
const EXPENSE_SYNONYMS: Record<Exclude<ExpenseImportTarget, "ignore">, string[]> = {
  date: ["date", "created date", "invoice date", "transaction date", "bill date", "order date", "issue date", "purchase date", "posted date"],
  supplier: ["supplier", "supplier name", "vendor", "vendor name", "merchant", "merchant name", "payee", "store", "seller", "company"],
  invoice_number: [
    "invoice",
    "invoice number",
    "invoice no",
    "invoice num",
    "invoice id",
    "inv",
    "inv no",
    "inv number",
    "receipt",
    "receipt number",
    "receipt no",
    "reference",
    "reference number",
    "reference no",
    "ref",
    "document number",
    "doc number",
  ],
  subtotal: ["subtotal", "sub total", "amount before tax", "before tax", "pre tax", "pretax", "net", "net amount", "amount excl tax"],
  tax: ["tax", "hst", "gst", "gst hst", "hst gst", "tax amount", "hst amount", "gst amount", "sales tax", "vat"],
  total: ["total", "total amount", "amount", "grand total", "invoice total", "total due", "amount due", "total incl tax", "total with tax"],
  category: ["category", "expense category", "expense type", "gl account"],
  description: ["description", "memo", "notes", "note", "details", "item", "items", "line item"],
};

export function guessExpenseMapping(headers: string[]): ExpenseImportTarget[] {
  return guessMappingWith(headers, EXPENSE_SYNONYMS);
}

// Which columns the person still has to provide, given the mapping: what blocks Continue. A date
// column is required unless they picked "Date for rows without a date" (`fallbackDate`), which then
// dates every row; with a date column mapped, that picker is optional and only fills blank cells.
export function mappingProblems(mapping: ExpenseImportTarget[], fallbackDate = ""): string[] {
  const has = (t: ExpenseImportTarget) => mapping.includes(t);
  const problems: string[] = [];
  if (!has("date") && !fallbackDate) {
    problems.push("Choose which column is the date, or pick a date for rows without one.");
  }
  if (!has("total") && !(has("subtotal") && has("tax"))) {
    problems.push("Choose the total column, or both the subtotal and the tax columns.");
  }
  return problems;
}

// A stable short key for "this exact set of headings", so the mapping chosen for one supplier's file
// is offered again for the next file from that supplier. Order matters (the mapping is per column).
// FNV-1a: tiny, no dependency, and only ever a localStorage key - not a security measure.
export function headingsKey(headers: string[]): string {
  const text = headers.map(normalizeHeader).join("|");
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `taxsnap-expense-import-${headers.length}-${hash.toString(16)}`;
}

// A saved mapping read back from storage. Anything that is not exactly one valid target per column
// (a hand-edited value, a different file shape) is thrown away rather than trusted.
export function parseSavedMapping(raw: string | null, columnCount: number): ExpenseImportTarget[] | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length !== columnCount) return null;
    if (!value.every((t) => typeof t === "string" && (EXPENSE_TARGETS as string[]).includes(t))) return null;
    const claimed = value.filter((t) => t !== "ignore");
    if (new Set(claimed).size !== claimed.length) return null;
    return value as ExpenseImportTarget[];
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ amounts

export type AmountResult = { state: "blank" } | { state: "bad" } | { state: "ok"; value: number };

// "$1,234.50", " 12.5 ", "(45.00)" and "45.00-" (a credit), "-45.00". Thousands commas are only
// accepted in proper groups of three: "12,50" is a decimal comma in some locales, and reading it as
// 1,250 would be a silent 100x error, so it is "bad" and the row is reported instead.
export function parseAmount(raw: string): AmountResult {
  let s = raw.replace(/[\s ]/g, "").replace(/\$/g, "");
  if (s === "") return { state: "blank" };
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/[-−]$/.test(s)) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (/^[-−]/.test(s)) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$|^\.\d+$/.test(s)) return { state: "bad" };
  const value = round2(Number(s.replace(/,/g, "")));
  if (!Number.isFinite(value) || value > AMOUNT_MAX) return { state: "bad" };
  return { state: "ok", value: negative && value !== 0 ? -value : value };
}

// ------------------------------------------------------------------ dates

export type DateOrder = "dmy" | "mdy";

export const DATE_ORDER_LABELS: Record<DateOrder, string> = {
  dmy: "Day / Month / Year (31/12/2026)",
  mdy: "Month / Day / Year (12/31/2026)",
};

const YMD = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ]\d.*)?$/;
const SLASH = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/;

function toIso(year: number, month: number, day: number): string | null {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

// Dates with a month NAME: "Jul 2, 2026", "July 2 2026", "2 Jul 2026", "2026-Jul-2". The word says which
// part is the month, so they are never ambiguous and ignore the day/month order setting.
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const NAME_MDY = /^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/i;
const NAME_DMY = /^(\d{1,2})\s+([a-z]+),?\s+(\d{4})$/i;
const NAME_YMD = /^(\d{4})[-\s]+([a-z]+)[-\s]+(\d{1,2})$/i;

// 1-12 for a full English month name or its 3-letter form (any case), otherwise 0.
function monthFromName(word: string): number {
  const w = word.toLowerCase();
  if (w.length < 3) return 0;
  const i = MONTHS.findIndex((m) => m === w || (w.length === 3 && m.startsWith(w)));
  return i + 1;
}

function parseMonthNameDate(s: string): string | null {
  const text = s.replace(/\s+/g, " ");
  let m = NAME_MDY.exec(text);
  if (m) return toIso(Number(m[3]), monthFromName(m[1]), Number(m[2]));
  m = NAME_DMY.exec(text);
  if (m) return toIso(Number(m[3]), monthFromName(m[2]), Number(m[1]));
  m = NAME_YMD.exec(text);
  if (m) return toIso(Number(m[1]), monthFromName(m[2]), Number(m[3]));
  return null;
}

// True when the column has at least one value and every non-empty value is a month-name date. Such a
// file needs no "how are the dates written?" answer: the format is settled by the words themselves.
export function allMonthNameDates(values: string[]): boolean {
  const filled = values.map((v) => v.trim()).filter((v) => v !== "");
  return filled.length > 0 && filled.every((v) => parseMonthNameDate(v) !== null);
}

// ISO and year-first dates (2026-03-14, 2026/3/14) and month-name dates (Jul 2, 2026) are never
// ambiguous. Day-first / month-first dates (14/03/2026, 3/14/26) need `order`; without one, only a date
// whose day cannot be a month (a first or second part over 12) is read - anything else is null, never a guess.
export function parseDate(raw: string, order: DateOrder | null): string | null {
  const s = raw.trim();
  const ymd = YMD.exec(s);
  if (ymd) return toIso(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  const named = parseMonthNameDate(s);
  if (named) return named;
  const m = SLASH.exec(s);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const year = fullYear(m[3]);
  const chosen = order ?? (a > 12 && b <= 12 ? "dmy" : b > 12 && a <= 12 ? "mdy" : null);
  if (chosen === null) return null;
  return chosen === "dmy" ? toIso(year, b, a) : toIso(year, a, b);
}

// The "How are the dates written?" question applies ONLY to dates that come from the file: with no date
// column mapped (every row dated by the picker) there is nothing to read and nothing to ask. Returns the
// analysis for the mapped date column, or null when there is no such column.
export function dateFormatQuestion(table: ParsedTable, mapping: ExpenseImportTarget[]): DateFormatAnalysis | null {
  const column = mapping.indexOf("date");
  if (column < 0) return null;
  return analyzeDateFormat(table.rows.map((r) => r.cells[column] ?? ""));
}

export interface DateFormatAnalysis {
  /** The person must pick day-first or month-first: the file does not settle it. */
  needsChoice: boolean;
  /** The one order the dates themselves prove (a part over 12), when they do and nothing contradicts it. */
  detected: DateOrder | null;
}

// Looks across the WHOLE file. 14/03/2026 proves day-first; 03/14/2026 proves month-first; a file
// holding both is contradictory and the person chooses (the rows that don't fit become errors).
// If nothing proves it - every date has both parts <= 12 - the person chooses, unless the two orders
// would give the same date for every row (05/05/2026), in which case no question is needed.
export function analyzeDateFormat(values: string[]): DateFormatAnalysis {
  let dayFirst = false;
  let monthFirst = false;
  let anySlash = false;
  let allSymmetric = true;
  for (const raw of values) {
    const m = SLASH.exec(raw.trim());
    if (!m || YMD.test(raw.trim())) continue;
    anySlash = true;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dayFirst = true;
    if (b > 12 && a <= 12) monthFirst = true;
    if (a !== b) allSymmetric = false;
  }
  if (!anySlash) return { needsChoice: false, detected: null };
  if (dayFirst && !monthFirst) return { needsChoice: false, detected: "dmy" };
  if (monthFirst && !dayFirst) return { needsChoice: false, detected: "mdy" };
  if (!dayFirst && !monthFirst && allSymmetric) return { needsChoice: false, detected: "dmy" };
  return { needsChoice: true, detected: null };
}

// ------------------------------------------------------------------ rows sent to the server

// What the browser sends for each row: already parsed to plain values, nothing else from the file.
// `tax: null` means the file has no tax column at all (a blank cell in a tax column is 0).
export interface ExpenseImportRow {
  /** 1-based line in the file (the header is line 1), for "row 7: ..." messages. */
  row: number;
  /** YYYY-MM-DD; "" means "the file had no date for this row" (the request's fallback_date fills it). */
  date: string;
  supplier: string;
  invoice_number: string;
  /** The value in the file's category column; "" = use the default. */
  category: string;
  description: string;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  /** The person unticked this row in the preview. */
  skip?: boolean;
  /** The person chose "Import anyway" on a flagged duplicate or a row that looks like a total. */
  import_anyway?: boolean;
  /** The supplier above is the dialog's one name for the whole file, not something this row said. */
  supplier_defaulted?: boolean;
}

export interface ImportProblem {
  row: number;
  reason: string;
}

export interface BuildOptions {
  /** One supplier for every row (used when the file has no supplier column, or a cell is blank). */
  supplierName: string;
  /** The chosen day-first / month-first order; required only if the file has slash dates. */
  dateOrder: DateOrder | null;
  /** Lines of the file that hold more values than there are headings (see rowsWithExtraValues). */
  overflowRows?: Set<number>;
  /**
   * "Date for rows without a date" (YYYY-MM-DD). With one, a row whose date cell is blank (or that has no
   * date column at all) is sent with an empty date and the SERVER fills it in; without one, such a row
   * is a problem. A date written in the file always wins, and an unreadable one is never replaced.
   */
  fallbackDate?: string;
}

// Turns the parsed table and the mapping into rows to send. A row whose date or an amount can't be
// read is returned as a problem instead (the preview shows it as an error; it is never sent).
export function buildImportRows(
  table: ParsedTable,
  mapping: ExpenseImportTarget[],
  options: BuildOptions,
): { rows: ExpenseImportRow[]; problems: ImportProblem[] } {
  const col = (t: ExpenseImportTarget) => mapping.indexOf(t);
  const cell = (cells: string[], t: ExpenseImportTarget) => (col(t) >= 0 ? (cells[col(t)] ?? "").trim() : "");
  const rows: ExpenseImportRow[] = [];
  const problems: ImportProblem[] = [];

  for (const r of table.rows) {
    // More values than headings: the cells are shifted (often an unquoted decimal comma), so no value
    // in this row can be trusted.
    if (options.overflowRows?.has(r.row)) {
      problems.push({ row: r.row, reason: "More values than column headings (an unquoted comma?)" });
      continue;
    }
    // A blank date is sent as "" and the SERVER decides: the picker's date fills it, or the row is an error
    // ("No date"), or it turns out to be a total row. Only a date that is there but unreadable stops here.
    const dateCell = cell(r.cells, "date");
    const date = dateCell === "" ? "" : parseDate(dateCell, options.dateOrder);
    if (date === null) {
      problems.push({
        row: r.row,
        reason: "Unreadable date (or it doesn't fit the date format you chose)",
      });
      continue;
    }

    let bad: string | null = null;
    const amount = (t: "subtotal" | "tax" | "total"): number | null => {
      if (col(t) < 0) return null;
      const result = parseAmount(cell(r.cells, t));
      if (result.state === "bad") bad = `Unreadable ${t === "tax" ? "tax" : t} amount`;
      // A blank cell in a tax column means "no tax"; a blank subtotal or total is simply absent.
      if (result.state === "blank") return t === "tax" ? 0 : null;
      return result.state === "ok" ? result.value : null;
    };
    const subtotal = amount("subtotal");
    const tax = amount("tax");
    const total = amount("total");
    if (bad !== null) {
      problems.push({ row: r.row, reason: bad });
      continue;
    }

    const ownSupplier = cell(r.cells, "supplier");
    rows.push({
      row: r.row,
      date,
      supplier_defaulted: ownSupplier === "",
      supplier: ownSupplier || options.supplierName.trim(),
      invoice_number: cell(r.cells, "invoice_number"),
      category: cell(r.cells, "category"),
      description: cell(r.cells, "description"),
      subtotal,
      tax,
      total,
    });
  }
  return { rows, problems };
}

// ------------------------------------------------------------------ the plan (also run on the server)

export interface ExistingExpense {
  merchant_name: string;
  invoice_number: string | null;
  transaction_date: string;
  total_amount: number;
}

export interface PlannedExpense {
  merchant_name: string;
  transaction_date: string;
  total_amount: number;
  tax_amount: number;
  tax_category: string;
  invoice_number: string | null;
  items: { name: string; amount: number }[];
  /** The tax was worked out from the category's default code, not read from the file. */
  tax_estimated: boolean;
  /** A negative total: a credit note, stored as a negative expense (like a statement refund). */
  credit: boolean;
  /** The file had no date for this row; it was dated with the "Date for rows without a date" picker. */
  date_set_at_import: boolean;
}

// "total" = the row looks like a spreadsheet total (a grand total at the bottom, a "Total" label): skipped
// by default, with an "Import anyway" choice like a duplicate.
export type RowStatus = "ready" | "warning" | "duplicate" | "total" | "error";

export interface PlannedRow {
  row: number;
  status: RowStatus;
  /** Why it is a warning / duplicate / error. Never contains the row's own values. */
  messages: string[];
  expense: PlannedExpense | null;
}

export interface PlanContext {
  /** Already resolved with resolveImportCategory: a built-in, or one of the owner's own. */
  defaultCategory: string;
  /** Every category name the owner added (active or not: an old expense may still use it). */
  customCategories: string[];
  existing: ExistingExpense[];
  defaults: CategoryDefaults;
  /** The picker's date, ALREADY validated by the caller (a real date, not in the future); null = none. */
  fallbackDate?: string | null;
}

// The note saved on an expense whose date was not in the file, alongside (never in place of) the
// owner's own description.
export const DATE_SET_AT_IMPORT_NOTE = "Date set at import";

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
const cleanText = (value: unknown, max: number) =>
  (typeof value === "string" ? value : "").replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim().slice(0, max);

// A category value from the file (or the chosen default) -> the category it is stored under.
// Built-ins, old names and the stock "Bank charges" go through canonicalCategory; the owner's own
// categories match case-insensitively; anything else is "Other" and the row warns.
export function resolveImportCategory(
  raw: string,
  fallback: string,
  customCategories: string[],
): { category: string; unknown: boolean } {
  const value = raw.trim();
  if (value === "") return { category: fallback, unknown: false };
  const canonical = canonicalCategory(value);
  if (isBuiltInCategory(canonical)) return { category: canonical, unknown: false };
  const custom = customCategories.find((c) => c.trim().toLowerCase() === value.toLowerCase());
  if (custom) return { category: custom.trim(), unknown: false };
  return { category: OTHER_CATEGORY, unknown: true };
}

const finiteOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Coerces one untrusted request row into an ExpenseImportRow (strings and finite numbers only).
export function coerceImportRow(raw: unknown, index: number): ExpenseImportRow {
  const o = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const row = typeof o.row === "number" && Number.isInteger(o.row) && o.row > 0 ? o.row : index + 2;
  return {
    row,
    date: str(o.date),
    supplier: str(o.supplier),
    invoice_number: str(o.invoice_number),
    category: str(o.category),
    description: str(o.description),
    subtotal: finiteOrNull(o.subtotal),
    tax: finiteOrNull(o.tax),
    total: finiteOrNull(o.total),
    skip: o.skip === true,
    import_anyway: o.import_anyway === true,
    supplier_defaulted: o.supplier_defaulted === true,
  };
}

const cents = (n: number) => Math.round(n * 100);

// ---------------------------------------------------------------------------
// Rows that look like a spreadsheet's TOTAL, not an invoice
// ---------------------------------------------------------------------------
// A grand total or a "Total" label at the bottom of a supplier's sheet would otherwise import as an expense
// and double the figures. A row is flagged when ANY of these holds (first match wins, in this order):
//   a  a text cell says exactly total, totals, grand total, sub total, subtotal or sum (any case; spaces and
//      a trailing colon ignored). Exact only: "Total Fuel" and "Totalline Supply" are ordinary names.
//   b  it has an amount but no supplier, no invoice number and no date. The picker's date and the dialog's
//      one-supplier-for-the-file name do not count: they are what the dialog fills in, not what the row says.
//   c  it has no invoice number and its total equals, within a cent, the sum of the totals of ALL THE OTHER
//      rows that rules a and b did not flag. It needs at least two other rows to add up: with one, "equal"
//      only means two purchases for the same amount.
// This reads only what the request sent, on the server too: no client claim about a row's status is used
// (the only hint taken from the client, `supplier_defaulted`, can only ever lead to MORE rows being asked
// about, and every flagged row can still be imported on purpose with "Import anyway").
export const TOTAL_LABELS = ["total", "totals", "grand total", "sub total", "subtotal", "sum"];

export const TOTAL_REASONS = {
  label: "Looks like a total row: a cell says total",
  bare: "Looks like a total row: an amount with no supplier, invoice number or date",
  sum: "Looks like a total row: its total equals the sum of the other rows",
} as const;

export function isTotalLabel(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const text = value.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim().replace(/\s*:+$/, "").trim().toLowerCase();
  return TOTAL_LABELS.includes(text);
}

// A row's total the way the plan will compute it, or null when it has none.
function totalOf(input: ExpenseImportRow): number | null {
  if (input.total !== null) return round2(input.total);
  if (input.subtotal !== null && input.tax !== null) return round2(input.subtotal + input.tax);
  return null;
}

// One entry per row: the reason it looks like a total, or null.
export function detectTotalRows(rows: ExpenseImportRow[]): (string | null)[] {
  const flags: (string | null)[] = rows.map((r) => {
    if ([r.supplier, r.invoice_number, r.category, r.description].some(isTotalLabel)) return TOTAL_REASONS.label;
    const hasAmount =
      r.total !== null || r.subtotal !== null || (r.tax !== null && r.tax !== 0);
    const noSupplier = r.supplier.trim() === "" || r.supplier_defaulted === true;
    if (hasAmount && noSupplier && r.invoice_number.trim() === "" && r.date.trim() === "") return TOTAL_REASONS.bare;
    return null;
  });

  const totals = rows.map(totalOf);
  rows.forEach((r, i) => {
    if (flags[i] !== null) return;
    const mine = totals[i];
    if (mine === null || mine === 0 || cleanInvoiceNumber(r.invoice_number) !== null) return;
    let others = 0;
    let sum = 0;
    rows.forEach((_, j) => {
      if (j === i || flags[j] !== null || totals[j] === null) return;
      others += 1;
      sum += totals[j] as number;
    });
    if (others >= 2 && Math.abs(cents(mine) - cents(sum)) <= 1) flags[i] = TOTAL_REASONS.sum;
  });
  return flags;
}

// Decides what every row becomes. Pure and order-dependent: a row is a duplicate of an EARLIER row in
// the same file, never a later one. Rules, in order:
//   error      no supplier / unreadable date / no usable amount / zero / tax > total / subtotal > total
//   duplicate  same invoice number AND supplier as an existing expense or an earlier row
//              (normalizeInvoiceNumber + vendorKey, the same rules as the scan-time warning)
//   warning    no invoice number, but the same supplier + date + total as an existing expense or an
//              earlier row; an unknown category turned into Other; a shortened invoice number; a
//              category with no default tax code (tax 0)
//   ready      everything else
// Tax: a tax column is used as entered (its sign follows the total's). With no tax column, the tax is
// subtotal-derived when both subtotal and total are there, otherwise ESTIMATED by backing the
// category's default code out of the total (13/113), and the row is marked estimated. A category with
// no ITC (Insurance, wages, bank charges) gets no tax.
export function planExpenseImport(rows: ExpenseImportRow[], ctx: PlanContext): PlannedRow[] {
  const existingByInvoice = new Map<string, true>();
  const existingByDetails = new Set<string>();
  for (const e of ctx.existing) {
    const vendor = vendorKey(e.merchant_name);
    if (vendor === null) continue;
    const inv = normalizeInvoiceNumber(e.invoice_number);
    if (inv !== null) existingByInvoice.set(`${vendor}|${inv}`, true);
    existingByDetails.add(`${vendor}|${e.transaction_date}|${cents(e.total_amount)}`);
  }
  const seenInvoice = new Map<string, number>();
  const seenDetails = new Map<string, number>();
  const totalFlags = detectTotalRows(rows);

  const planOne = (input: ExpenseImportRow, isTotal: boolean): PlannedRow => {
    const fail = (message: string): PlannedRow => ({ row: input.row, status: "error", messages: [message], expense: null });

    const merchant = cleanText(input.supplier, SUPPLIER_MAX);
    const vendor = vendorKey(merchant);
    if (merchant === "" || vendor === null) return fail("No supplier name");

    // A date in the file always wins; only a row with NO date takes the picker's. An unreadable date
    // is an error, never replaced.
    const setAtImport = input.date === "" && !!ctx.fallbackDate;
    const dated = setAtImport ? (ctx.fallbackDate as string) : input.date;
    const date = typeof dated === "string" && parseDate(dated, null) === dated ? dated : "";
    if (date === "") return fail(input.date === "" ? "No date" : "Unreadable date");

    const amounts = [input.subtotal, input.tax, input.total];
    if (amounts.some((a) => a !== null && Math.abs(a) > AMOUNT_MAX)) return fail("Amount is too large");

    let total: number;
    if (input.total !== null) total = round2(input.total);
    else if (input.subtotal !== null && input.tax !== null) total = round2(input.subtotal + input.tax);
    else return fail("Needs a total, or a subtotal and tax");
    if (total === 0) return fail("The amount is zero");
    const sign = total < 0 ? -1 : 1;

    const messages: string[] = [];
    const resolved = resolveImportCategory(input.category, ctx.defaultCategory, ctx.customCategories);
    if (resolved.unknown) messages.push("Category not recognised: set to Other");

    let taxAmount: number;
    let estimated = false;
    if (input.tax !== null) {
      taxAmount = round2(sign * Math.abs(input.tax));
    } else if (input.subtotal !== null && input.total !== null) {
      const net = round2(Math.abs(total) - Math.abs(input.subtotal));
      if (net < 0) return fail("The subtotal is more than the total");
      taxAmount = round2(sign * net);
    } else {
      const code = categoryCodeFor(ctx.defaults, resolved.category);
      taxAmount = code ? calculateTax(total, code) : 0;
      estimated = taxAmount !== 0;
      if (!code) messages.push("No default tax code for this category: tax set to 0");
    }
    if (Math.abs(taxAmount) > Math.abs(total)) return fail("The tax is more than the total");

    const invoice = cleanInvoiceNumber(input.invoice_number);
    if (input.invoice_number.replace(CONTROL_CHARS, "").trim().length > INVOICE_NUMBER_MAX) {
      messages.push(`Invoice number shortened to ${INVOICE_NUMBER_MAX} characters`);
    }

    const description = cleanText(input.description, DESCRIPTION_MAX);
    const items: { name: string; amount: number }[] = [];
    if (description) items.push({ name: description, amount: total });
    if (estimated) {
      items.push({ name: "HST estimated from the category's default tax code (imported from CSV)", amount: 0 });
    }
    if (setAtImport) items.push({ name: DATE_SET_AT_IMPORT_NOTE, amount: 0 });

    // ---- duplicates
    let duplicate = false;
    const invKey = normalizeInvoiceNumber(invoice);
    if (invKey !== null) {
      const key = `${vendor}|${invKey}`;
      const earlier = seenInvoice.get(key);
      if (existingByInvoice.has(key)) {
        duplicate = true;
        messages.unshift("This invoice number is already saved for this supplier");
      } else if (earlier !== undefined) {
        duplicate = true;
        messages.unshift(`Same invoice number and supplier as row ${earlier} in this file`);
      }
      // A row that looks like a total is not an invoice, so it never makes a later row "its duplicate".
      if (earlier === undefined && !isTotal) seenInvoice.set(key, input.row);
    } else {
      const key = `${vendor}|${date}|${cents(total)}`;
      const earlier = seenDetails.get(key);
      if (existingByDetails.has(key)) messages.unshift("Same supplier, date and total as an expense already saved");
      else if (earlier !== undefined) messages.unshift(`Same supplier, date and total as row ${earlier} in this file`);
      if (earlier === undefined && !isTotal) seenDetails.set(key, input.row);
    }

    return {
      row: input.row,
      status: duplicate ? "duplicate" : messages.length > 0 ? "warning" : "ready",
      messages,
      expense: {
        merchant_name: merchant,
        transaction_date: date,
        total_amount: total,
        tax_amount: taxAmount,
        tax_category: resolved.category,
        invoice_number: invoice,
        items,
        tax_estimated: estimated,
        credit: total < 0,
        date_set_at_import: setAtImport,
      },
    };
  };

  // A row that looks like a total keeps whatever the normal rules made of it (so "Import anyway" imports a
  // proper expense), but its status is "total" and the reason comes first. If the normal rules could not
  // build an expense from it (no supplier, no date, no amount), there is nothing to import anyway.
  return rows.map((input, i): PlannedRow => {
    const reason = totalFlags[i];
    const planned = planOne(input, reason !== null);
    if (reason === null) return planned;
    return { ...planned, status: "total", messages: [reason, ...planned.messages] };
  });
}

// What saving does with a planned row. A duplicate is skipped unless the person chose "Import anyway";
// a row they unticked is skipped; an error is never saved.
export type RowDecision = "import" | "skip" | "error";

export function decideRow(planned: PlannedRow, input: Pick<ExpenseImportRow, "skip" | "import_anyway">): RowDecision {
  // A row that looks like a total and could not be built into an expense is simply left out (it is not a
  // failure of the import); every other row without an expense is an error.
  if (planned.status === "total" && planned.expense === null) return "skip";
  if (planned.status === "error" || planned.expense === null) return "error";
  if (input.skip) return "skip";
  if ((planned.status === "duplicate" || planned.status === "total") && !input.import_anyway) return "skip";
  return "import";
}

export interface PlanTotals {
  rows: number;
  total: number;
  tax: number;
}

// The preview's footer: rows, total amount and total tax of what WOULD be saved.
export function planTotals(items: { planned: PlannedRow; input: Pick<ExpenseImportRow, "skip" | "import_anyway"> }[]): PlanTotals {
  let rows = 0;
  let total = 0;
  let tax = 0;
  for (const { planned, input } of items) {
    if (decideRow(planned, input) !== "import" || !planned.expense) continue;
    rows += 1;
    total += planned.expense.total_amount;
    tax += planned.expense.tax_amount;
  }
  return { rows, total: round2(total), tax: round2(tax) };
}

export interface ImportSummary {
  imported: number;
  skipped: number;
  failed: number;
}

export function importSummaryText(s: ImportSummary): string {
  return `${s.imported} imported, ${s.skipped} skipped, ${s.failed} failed`;
}
