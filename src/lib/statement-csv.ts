// Import a bank or card statement from a CSV file (the browser half and the rules both halves share).
//
// Pure (no I/O, no logging, no crypto): the dialog uses it to read the file and build the rows to send,
// and POST /api/statements/csv (statement-csv-server.ts) runs planStatementCsvRows() again on its own.
// The server never receives the file, only the mapped rows. No statement text, description or amount is
// ever put in a log line or an error message.
//
// It reuses the expense CSV import's pieces (expense-import.ts): the same parser, delimiters, BOM and
// quote handling (client-import.ts), exact-heading matching, $ / comma / parenthesis amounts
// (parseAmount), numeric and month-name dates (parseDate, analyzeDateFormat) and total-row detection
// (detectTotalRows). What is new here: finding the header row under preamble lines, the two amount
// layouts, the two sign conventions, and the balance check.
//
// SIGN. statement_lines.amount is "signed as the card sees it": money OUT (a charge) is positive, money
// IN (a payment, a deposit, a refund) is negative - the PDF path stores it that way and the line
// fingerprint (account | date | amount | nth) is built on it, so a CSV line only matches the same line
// read from a PDF if it is stored the same way. toCardAmount() is the one place the file's sign is turned
// into that.

import {
  IMPORT_MAX_BYTES,
  normalizeHeader,
  parseDelimited,
  rowsWithExtraValues,
  guessMappingWith,
  type ParsedTable,
} from "./client-import.ts";
import {
  analyzeDateFormat,
  detectTotalRows,
  headingsKey,
  parseAmount,
  parseDate,
  type DateOrder,
  type ExpenseImportRow,
} from "./expense-import.ts";
import { maskCardNumbers, round2 } from "./statement-lines.ts";

// 2,000 rows and 2 MB: a year of busy business banking is a few hundred rows; this leaves room for
// several accounts' worth in one export and still fits one request. (The expense import allows 500 / 1 MB.)
export const STATEMENT_CSV_MAX_ROWS = 2000;
export const STATEMENT_CSV_MAX_BYTES = 2 * 1024 * 1024;
export const STATEMENT_CSV_DESCRIPTION_MAX = 200;

export { IMPORT_MAX_BYTES };

// ------------------------------------------------------------------ layout and sign

export type AmountLayout = "signed" | "debit_credit";
export type SignConvention = "bank" | "card";

export const AMOUNT_LAYOUT_LABELS: Record<AmountLayout, string> = {
  signed: "One Amount column (positive and negative)",
  debit_credit: "Separate Debit and Credit columns",
};

export const SIGN_CONVENTION_LABELS: Record<SignConvention, string> = {
  bank: "Bank account: negative = money out",
  card: "Credit card: positive = a charge",
};

export const isAmountLayout = (v: unknown): v is AmountLayout => v === "signed" || v === "debit_credit";
export const isSignConvention = (v: unknown): v is SignConvention => v === "bank" || v === "card";

// What the sign dropdown starts on once the account is known.
export function defaultConventionFor(accountType: string | null | undefined): SignConvention {
  return accountType === "card" ? "card" : "bank";
}

// A CSV import never calls the model, so it records 0 input and 0 output tokens; a PDF or photo import always
// records some (every read is billed). There is no "source" column, so this is how the review screen tells them
// apart - it only decides whether "page N" is worth showing.
export function importCameFromCsv(imp: { input_tokens: number; output_tokens: number }): boolean {
  return imp.input_tokens === 0 && imp.output_tokens === 0;
}

// ------------------------------------------------------------------ column mapping

export type StatementCsvTarget =
  | "date"
  | "description"
  | "reference"
  | "amount"
  | "debit"
  | "credit"
  | "balance"
  | "ignore";

export const STATEMENT_CSV_TARGETS: StatementCsvTarget[] = [
  "date",
  "description",
  "reference",
  "amount",
  "debit",
  "credit",
  "balance",
  "ignore",
];

export const STATEMENT_CSV_TARGET_LABELS: Record<StatementCsvTarget, string> = {
  date: "Date",
  description: "Description / payee",
  reference: "Reference",
  amount: "Amount (signed)",
  debit: "Debit (money out)",
  credit: "Credit (money in)",
  balance: "Running balance",
  ignore: "Ignore",
};

const SYNONYMS: Record<Exclude<StatementCsvTarget, "ignore">, string[]> = {
  date: ["date", "transaction date", "trans date", "posting date", "posted date", "post date", "effective date", "txn date"],
  description: ["description", "details", "payee", "merchant", "memo", "narrative", "transaction description", "name", "transaction details"],
  reference: ["reference", "ref", "reference number", "reference no", "cheque number", "check number", "transaction id", "confirmation number"],
  amount: ["amount", "transaction amount", "cad", "cad amount", "value"],
  debit: ["debit", "debits", "withdrawal", "withdrawals", "money out", "paid out", "charge", "charges"],
  credit: ["credit", "credits", "deposit", "deposits", "money in", "paid in", "payment", "payments"],
  balance: ["balance", "running balance", "closing balance", "ledger balance", "available balance"],
};

export function guessStatementMapping(headers: string[]): StatementCsvTarget[] {
  return guessMappingWith(headers, SYNONYMS);
}

// A file with both Debit and Credit columns uses the second layout; otherwise one signed Amount column.
export function layoutFromMapping(mapping: StatementCsvTarget[]): AmountLayout {
  return mapping.includes("debit") && mapping.includes("credit") ? "debit_credit" : "signed";
}

// What still blocks Continue, given the mapping and the chosen layout.
export function statementMappingProblems(mapping: StatementCsvTarget[], layout: AmountLayout): string[] {
  const has = (t: StatementCsvTarget) => mapping.includes(t);
  const problems: string[] = [];
  if (!has("date")) problems.push("Choose which column is the date.");
  if (layout === "signed" && !has("amount")) problems.push("Choose the Amount column.");
  if (layout === "debit_credit" && !(has("debit") && has("credit"))) {
    problems.push("Choose both the Debit and the Credit column.");
  }
  if (!has("description") && !has("reference")) problems.push("Choose which column describes the transaction.");
  return problems;
}

// "taxsnap-statement-csv-<n>-<hash>": the expense import's heading hash under this feature's own prefix, so the
// two imports never read each other's remembered mapping.
export function statementHeadingsKey(headers: string[]): string {
  return headingsKey(headers).replace("taxsnap-expense-import-", "taxsnap-statement-csv-");
}

// A remembered mapping read back: exactly one valid target per column, none claimed twice. A value from
// before a target existed (or hand-edited) is thrown away rather than trusted.
export function parseSavedStatementMapping(raw: string | null, columnCount: number): StatementCsvTarget[] | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length !== columnCount) return null;
    if (!value.every((t) => typeof t === "string" && (STATEMENT_CSV_TARGETS as string[]).includes(t))) return null;
    const claimed = value.filter((t) => t !== "ignore");
    if (new Set(claimed).size !== claimed.length) return null;
    return value as StatementCsvTarget[];
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ reading the file (preamble lines)

export interface StatementCsvFile {
  table: ParsedTable;
  /** Lines of the file that hold more values than the heading row (an unquoted comma in an amount). */
  overflowRows: Set<number>;
  /** How many lines above the heading row were set aside (a bank's "Account: ..." preamble). */
  preambleLines: number;
}

const HEADER_SCAN_LINES = 60;

// A bank export often starts with lines that are not the table ("Account Activity", "Account: 1234", a
// blank line). The heading row is the first line, within the first 60, whose cells include a date heading
// AND an amount-like heading (amount, debit or credit); everything above it is set aside. No such line =
// the first non-blank row is the heading row, as in every other import. Row numbers stay the file's own.
export function readStatementCsv(text: string): StatementCsvFile {
  const bare = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = bare.split(/\r?\n/);
  let headerLine = -1;
  for (let i = 0; i < Math.min(lines.length, HEADER_SCAN_LINES); i++) {
    if (lines[i].trim() === "") continue;
    // Each line is judged on its own (it detects its own delimiter), so a one-cell preamble line above a
    // semicolon or tab file cannot make the whole file read as comma-separated.
    const cells = parseDelimited(lines[i]).headers.map(normalizeHeader);
    const hasDate = cells.some((c) => SYNONYMS.date.includes(c));
    const hasAmount = cells.some((c) => SYNONYMS.amount.includes(c) || SYNONYMS.debit.includes(c) || SYNONYMS.credit.includes(c));
    if (hasDate && hasAmount) {
      headerLine = i;
      break;
    }
  }
  const skip = Math.max(headerLine, 0);
  const cut = skip === 0 ? bare : lines.slice(skip).join("\n");
  const parsed = parseDelimited(cut);
  const table: ParsedTable = { ...parsed, rows: parsed.rows.map((r) => ({ ...r, row: r.row + skip })) };
  const overflowRows = new Set([...rowsWithExtraValues(cut)].map((n) => n + skip));
  return { table, overflowRows, preambleLines: skip };
}

// ------------------------------------------------------------------ rows sent to the server

// What the browser sends for each row: parsed to plain values, nothing else from the file. A blank
// amount cell is null. Amounts keep the FILE's sign; the layout and convention (sent once) turn them into the
// card's sign on both sides.
export interface StatementCsvRow {
  /** 1-based line in the file, for "row 7" messages. */
  row: number;
  /** YYYY-MM-DD; "" = the file had no readable-as-blank date for this row (the server decides: a total row or an error). */
  date: string;
  description: string;
  reference: string;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  /** Shown in the preview only. Never stored, never checked. */
  balance: number | null;
  /** Untick in the preview: the line is kept but skipped (still counted for the balance check). */
  skip?: boolean;
  /** Ticked on a flagged duplicate or total row. */
  import_anyway?: boolean;
}

export interface StatementCsvProblem {
  row: number;
  reason: string;
}

export interface StatementCsvBuildOptions {
  layout: AmountLayout;
  dateOrder: DateOrder | null;
  overflowRows?: Set<number>;
}

// The date question for this file, asked only when a date column is mapped (same rule as the expense import).
export function statementDateQuestion(table: ParsedTable, mapping: StatementCsvTarget[]) {
  const column = mapping.indexOf("date");
  if (column < 0) return null;
  return analyzeDateFormat(table.rows.map((r) => r.cells[column] ?? ""));
}

export function buildStatementRows(
  table: ParsedTable,
  mapping: StatementCsvTarget[],
  options: StatementCsvBuildOptions,
): { rows: StatementCsvRow[]; problems: StatementCsvProblem[] } {
  const col = (t: StatementCsvTarget) => mapping.indexOf(t);
  const cell = (cells: string[], t: StatementCsvTarget) => (col(t) >= 0 ? (cells[col(t)] ?? "").trim() : "");
  const rows: StatementCsvRow[] = [];
  const problems: StatementCsvProblem[] = [];

  for (const r of table.rows) {
    if (options.overflowRows?.has(r.row)) {
      problems.push({ row: r.row, reason: "More values than column headings (an unquoted comma?)" });
      continue;
    }
    const dateCell = cell(r.cells, "date");
    const date = dateCell === "" ? "" : parseDate(dateCell, options.dateOrder);
    if (date === null) {
      problems.push({ row: r.row, reason: "Unreadable date (or it doesn't fit the date format you chose)" });
      continue;
    }

    let bad: string | null = null;
    const amountOf = (t: "amount" | "debit" | "credit"): number | null => {
      if (col(t) < 0) return null;
      const result = parseAmount(cell(r.cells, t));
      if (result.state === "bad") bad = `Unreadable ${t} amount`;
      return result.state === "ok" ? result.value : null;
    };
    const amount = options.layout === "signed" ? amountOf("amount") : null;
    const debit = options.layout === "debit_credit" ? amountOf("debit") : null;
    const credit = options.layout === "debit_credit" ? amountOf("credit") : null;
    if (bad !== null) {
      problems.push({ row: r.row, reason: bad });
      continue;
    }
    // The balance is for display only: an unreadable one is left out, never an error.
    const balanceResult = col("balance") >= 0 ? parseAmount(cell(r.cells, "balance")) : null;

    rows.push({
      row: r.row,
      date,
      description: cell(r.cells, "description"),
      reference: cell(r.cells, "reference"),
      amount,
      debit,
      credit,
      balance: balanceResult?.state === "ok" ? balanceResult.value : null,
    });
  }
  return { rows, problems };
}

const finiteOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Coerces one untrusted request row (strings and finite numbers only).
export function coerceStatementRow(raw: unknown, index: number): StatementCsvRow {
  const o = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v : "").slice(0, max);
  const row = typeof o.row === "number" && Number.isInteger(o.row) && o.row > 0 ? o.row : index + 2;
  return {
    row,
    date: str(o.date, 40),
    description: str(o.description, 1000),
    reference: str(o.reference, 200),
    amount: finiteOrNull(o.amount),
    debit: finiteOrNull(o.debit),
    credit: finiteOrNull(o.credit),
    balance: finiteOrNull(o.balance),
    skip: o.skip === true,
    import_anyway: o.import_anyway === true,
  };
}

// ------------------------------------------------------------------ signs

export type CardAmount = { state: "ok"; value: number } | { state: "blank" } | { state: "both" };

// The row's amount the way the card sees it (money out positive, money in negative).
//  signed layout   bank: negative = money out, so the card amount is the file's amount with the sign flipped;
//                  card: positive = a charge, so it is the file's amount as it is.
//  debit/credit    Debit is money out and Credit is money in whatever the account is; both columns hold
//                  positive figures (a sign in either is ignored). A row with both filled is not guessed at.
export function toCardAmount(row: StatementCsvRow, layout: AmountLayout, convention: SignConvention): CardAmount {
  if (layout === "signed") {
    if (row.amount === null) return { state: "blank" };
    return { state: "ok", value: round2(convention === "card" ? row.amount : -row.amount) + 0 };
  }
  const debit = row.debit === null ? 0 : Math.abs(row.debit);
  const credit = row.credit === null ? 0 : Math.abs(row.credit);
  if (debit !== 0 && credit !== 0) return { state: "both" };
  if (row.debit === null && row.credit === null) return { state: "blank" };
  return { state: "ok", value: round2(debit - credit) + 0 };
}

// Money out is a charge. Money in is stored as a payment (never an expense): a CSV does not say whether a
// credit on a card was a refund or a payment, and a bank deposit is income, so none is guessed to be a refund.
// Money out is a purchase unless the description plainly says fee or interest (below).
// The review screen lets the person change a line's type.
// ------------------------------------------------------------------ fees and interest

// The PDF path gets a line's kind from the model. A CSV has no model, so money OUT is classified here from its
// description, and only when it is plain: anything unsure stays a "purchase" (the owner can change the type on
// the review screen with the pencil). Money in is never classified: it stays a payment.
//
// The description is first normalised: lower case, every run of anything that is not a letter or digit (hyphens,
// slashes, asterisks, extra spaces) becomes one space - "E-TRANSFER  FEE" -> "e transfer fee".
//
//   fee       <qualifier> fee|fees|charge|charges, where the qualifier is one of
//               account | monthly | annual | service | maintenance | overdraft | nsf | e ?transfer | interac |
//               wire | wire transfer | atm | withdrawal | foreign exchange | card | plan
//             or the word "nsf" on its own.      A bare "fee" ("permit fee", "registration fee") is NOT enough.
//   interest  the word "interest", unless it is "interest rate(s)" / "interest free" / "interest only" / "interest bearing".
//
// Fee wins when both read (it can't happen with these patterns, but the order is fixed).
//             Also: "tfr" (e transfer abbreviated: "SEND E-TFR FEE") and "(bus|business|credit) line fee(s)".
// Loan payments: "ln|loan pyt|pmt|pymt|payment int|interest" is interest (the interest part of a loan payment).
//
// NOT EXPENSES (money out stored as the existing kind "payment", see below):
//   loan principal   "ln|loan pyt|pmt|pymt|payment pri|prin|principal"
//   card payment / transfer between own accounts, when the description has a whole-word marker:
//     visa | mastercard | mc | amex | american express | captl one | capital one | td visa |
//     tfr to c c | transfer to c c | credit card payment | cc payment
//   ...unless it also has one of the whole words debit | interac | pos | purchase | pur (a debit-card or POS purchase,
//   "VISA DEBIT PUR ..."), which always stays a purchase. "mc donald(s)" is not a marker either.
const FEE_PATTERN =
  /\b(?:(?:account|monthly|annual|service|maintenance|overdraft|nsf|e ?transfer|tfr|interac|wire(?: transfer)?|atm|withdrawal|foreign exchange|card|plan|(?:bus|business|credit) line) (?:fee|fees|charge|charges)|nsf)\b/;
const INTEREST_PATTERN = /\binterest\b(?! (?:rates?|free|only|bearing)\b)/;
const LOAN_INTEREST_PATTERN = /\b(?:ln|loan) (?:pyt|pmt|pymt|payment) (?:int|interest)\b/;
const LOAN_PRINCIPAL_PATTERN = /\b(?:ln|loan) (?:pyt|pmt|pymt|payment) (?:pri|prin|principal)\b/;
const CARD_OR_TRANSFER_PATTERN =
  /\b(?:visa|mastercard|mc(?! ?donalds?\b)|amex|american express|captl one|capital one|td visa|(?:tfr|transfer) to c c|credit card payment|cc payment)\b/;
const POS_PATTERN = /\b(?:debit|interac|pos|purchase|pur)\b/;

export const normalizeForKind = (description: string) => description.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export type CsvLineKind = "purchase" | "payment" | "fee" | "interest";

// Money out is positive (the card's sign). Money in is a payment, whatever it says.
// Money out that is not an expense (loan principal, a card payment, a transfer to the owner's own account) is
// ALSO kind "payment", just with a positive amount: the PDF path already treats that kind as "never an expense,
// skipped automatically", so nothing new is stored. isNonExpenseOut() tells the two apart by the sign.
export function kindForCardAmount(value: number, description = ""): CsvLineKind {
  if (value <= 0) return "payment";
  const text = normalizeForKind(description);
  if (FEE_PATTERN.test(text)) return "fee";
  if (INTEREST_PATTERN.test(text) || LOAN_INTEREST_PATTERN.test(text)) return "interest";
  if (LOAN_PRINCIPAL_PATTERN.test(text)) return "payment";
  if (CARD_OR_TRANSFER_PATTERN.test(text) && !POS_PATTERN.test(text)) return "payment";
  return "purchase";
}

export const NON_EXPENSE_OUT_NOTE = "Transfer / loan principal";

export const KIND_NOTE: Partial<Record<CsvLineKind, string>> = { fee: "Fee", interest: "Interest" };

// The preview Note for a planned line: Fee, Interest, or (a payment-kind line that is money OUT) the transfer note.
export function noteForLine(kind: CsvLineKind, amount: number): string | undefined {
  return kind === "payment" && amount > 0 ? NON_EXPENSE_OUT_NOTE : KIND_NOTE[kind];
}

export interface MoneyTotals {
  out: number;
  outCount: number;
  in: number;
  inCount: number;
}

// Money out and money in over a set of card-signed amounts: the preview's "is the sign right?" check.
export function moneyTotals(cardAmounts: number[]): MoneyTotals {
  const t: MoneyTotals = { out: 0, outCount: 0, in: 0, inCount: 0 };
  for (const a of cardAmounts) {
    if (a > 0) {
      t.out += a;
      t.outCount += 1;
    } else if (a < 0) {
      t.in += -a;
      t.inCount += 1;
    }
  }
  return { ...t, out: round2(t.out), in: round2(t.in) };
}

export type BalanceCheck =
  | { state: "unchecked" }
  | { state: "ok"; expected: number }
  | { state: "off"; expected: number; diff: number };

// opening + money in - money out = closing for a bank account. For a card the balances are what is owed, so
// opening + charges - payments = closing. Only when BOTH balances are given; whole cents. A warning, never a block.
export function checkBalances(input: {
  opening: number | null;
  closing: number | null;
  totals: MoneyTotals;
  convention: SignConvention;
}): BalanceCheck {
  if (input.opening === null || input.closing === null) return { state: "unchecked" };
  const cents = (n: number) => Math.round(n * 100);
  const net = input.convention === "card" ? cents(input.totals.out) - cents(input.totals.in) : cents(input.totals.in) - cents(input.totals.out);
  const expected = round2((cents(input.opening) + net) / 100);
  const diff = round2((cents(input.closing) - cents(expected)) / 100);
  return diff === 0 ? { state: "ok", expected } : { state: "off", expected, diff };
}

// The opening / closing figures as the statement tables keep them (what the PDF path stores: the balance
// owed, so closing - opening = the signed sum of the lines). A bank balance is the opposite way round.
export function headerBalances(
  opening: number | null,
  closing: number | null,
  convention: SignConvention,
): { opening_balance: number | null; closing_balance: number | null } {
  if (opening === null || closing === null) return { opening_balance: null, closing_balance: null };
  const flip = (n: number) => round2(convention === "bank" ? -n : n) + 0;
  return { opening_balance: flip(opening), closing_balance: flip(closing) };
}

// ------------------------------------------------------------------ the plan (also run on the server)

export type CsvRowStatus = "ready" | "duplicate" | "total" | "ignored" | "error";

export interface PlannedCsvLine {
  txn_date: string;
  description: string;
  /** Money out positive, money in negative. */
  amount: number;
  kind: CsvLineKind;
}

export interface PlannedCsvRow {
  row: number;
  status: CsvRowStatus;
  /** Why it is a duplicate / total / error. Never contains the row's own values. */
  messages: string[];
  line: PlannedCsvLine | null;
  /** The running balance column, echoed for the preview. */
  balance: number | null;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
const cleanDescription = (value: string) =>
  maskCardNumbers(value.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim()).slice(0, STATEMENT_CSV_DESCRIPTION_MAX);

const DAY_MS = 86_400_000;

export interface PlanCsvContext {
  layout: AmountLayout;
  convention: SignConvention;
  /** Today, so a date in the future is refused (one day of slack for time zones ahead of Toronto). */
  now: Date;
}

// Decides what every row becomes, before duplicates (those need the saved lines: statement-csv-server.ts).
//   error    no readable date / no amount / both Debit and Credit filled / no description
//   ignored  a $0.00 line: left out, exactly as the PDF path does
//   total    looks like a spreadsheet's total (expense-import.ts detectTotalRows, unchanged rules); skipped unless ticked
//   ready    everything else
export function planStatementCsvRows(rows: StatementCsvRow[], ctx: PlanCsvContext): PlannedCsvRow[] {
  const amounts = rows.map((r) => toCardAmount(r, ctx.layout, ctx.convention));
  const asExpenseRows: ExpenseImportRow[] = rows.map((r, i) => {
    const a = amounts[i];
    return {
      row: r.row,
      date: r.date,
      supplier: r.description,
      invoice_number: r.reference,
      category: "",
      description: r.description,
      subtotal: null,
      tax: null,
      total: a.state === "ok" ? a.value : null,
    };
  });
  const totalFlags = detectTotalRows(asExpenseRows);
  const latest = new Date(ctx.now.getTime() + DAY_MS).toISOString().slice(0, 10);

  return rows.map((r, i): PlannedCsvRow => {
    const make = (status: CsvRowStatus, messages: string[], line: PlannedCsvLine | null): PlannedCsvRow => ({
      row: r.row,
      status,
      messages,
      line,
      balance: r.balance,
    });
    const flag = totalFlags[i];
    const failed = (message: string): PlannedCsvRow =>
      flag !== null ? make("total", [flag], null) : make("error", [message], null);

    const amount = amounts[i];
    if (amount.state === "both") return failed("Both Debit and Credit are filled");
    if (amount.state === "blank") return failed("No amount");
    if (r.date === "") return failed("No date");
    const date = parseDate(r.date, null) === r.date ? r.date : "";
    if (date === "") return failed("Unreadable date");
    if (date > latest) return failed("The date is in the future");
    const description = cleanDescription(r.description) || cleanDescription(r.reference);
    if (description === "") return failed("No description");
    if (amount.value === 0) return flag !== null ? make("total", [flag], null) : make("ignored", ["Zero amount: left out"], null);
    if (Math.abs(amount.value) > 999_999_999) return failed("Amount is too large");

    const line: PlannedCsvLine = {
      txn_date: date,
      description,
      amount: amount.value,
      kind: kindForCardAmount(amount.value, description),
    };
    const note = noteForLine(line.kind, line.amount);
    return flag !== null ? make("total", [flag], line) : make("ready", note ? [note] : [], line);
  });
}
