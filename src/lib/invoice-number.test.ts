import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  INVOICE_NUMBER_MAX,
  cleanInvoiceNumber,
  invoiceNumberLikePattern,
  normalizeInvoiceNumber,
} from "./invoice-number.ts";
import { invoiceNumberMatches, invoiceNumberWarningText, similarReceipts } from "./receipt-duplicates.ts";
import { receiptsToCsv, receiptsToQuickBooksCsv } from "./csv.ts";
import type { Receipt } from "./database.types.ts";
import { findDuplicateChecks } from "./receipt-duplicates-server.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

// ---- cleaning: what the API stores ---------------------------------------------------------

test("cleanInvoiceNumber trims, and an empty or whitespace-only value becomes null", () => {
  assert.equal(cleanInvoiceNumber("  INV-0042  "), "INV-0042");
  assert.equal(cleanInvoiceNumber(""), null);
  assert.equal(cleanInvoiceNumber("   "), null);
  assert.equal(cleanInvoiceNumber("\t\n"), null);
});

test("cleanInvoiceNumber strips control characters (and what is left is trimmed)", () => {
  assert.equal(cleanInvoiceNumber("INV\u0000-42\u0007"), "INV-42");
  assert.equal(cleanInvoiceNumber("INV-1\r\nINV-2"), "INV-1INV-2");
  assert.equal(cleanInvoiceNumber("\u0085 A1 \u009f"), "A1");
  assert.equal(cleanInvoiceNumber("\u0001\u0002"), null);
});

test("cleanInvoiceNumber caps at 40 characters, then trims again", () => {
  assert.equal(INVOICE_NUMBER_MAX, 40);
  assert.equal(cleanInvoiceNumber("A".repeat(40)), "A".repeat(40));
  assert.equal(cleanInvoiceNumber("A".repeat(41)), "A".repeat(40));
  assert.equal(cleanInvoiceNumber("A".repeat(200))?.length, 40);
  // the cut can land after a space: no trailing space is left behind
  assert.equal(cleanInvoiceNumber(`${"A".repeat(39)} BBB`), "A".repeat(39));
});

test("cleanInvoiceNumber treats anything that is not a string as no number (a bad request body never throws)", () => {
  for (const v of [undefined, null, 42, {}, [], true]) assert.equal(cleanInvoiceNumber(v), null);
});

test("cleanInvoiceNumber keeps the number as printed (case, dashes, spaces inside)", () => {
  assert.equal(cleanInvoiceNumber("inv 00-42/B"), "inv 00-42/B");
});

// ---- normalising: what is compared ---------------------------------------------------------

test("normalizeInvoiceNumber: upper case, spaces and punctuation stripped, leading zeros stripped", () => {
  assert.equal(normalizeInvoiceNumber("inv-0042"), "INV0042");
  assert.equal(normalizeInvoiceNumber(" INV 0042 "), "INV0042");
  assert.equal(normalizeInvoiceNumber("INV/0042."), "INV0042");
  assert.equal(normalizeInvoiceNumber("000123"), "123");
  assert.equal(normalizeInvoiceNumber("00-123"), "123");
  assert.equal(normalizeInvoiceNumber("# 0007"), "7");
});

test("normalizeInvoiceNumber: the same invoice written differently gets one key", () => {
  const key = normalizeInvoiceNumber("INV-0042");
  for (const v of ["inv0042", "Inv 0042", "INV.0042", " inv-0042 "]) assert.equal(normalizeInvoiceNumber(v), key, v);
});

test("normalizeInvoiceNumber: only the very start loses zeros, so different numbers stay different", () => {
  assert.notEqual(normalizeInvoiceNumber("INV-0042"), normalizeInvoiceNumber("INV-42"));
  assert.notEqual(normalizeInvoiceNumber("A0"), normalizeInvoiceNumber("A"));
  assert.notEqual(normalizeInvoiceNumber("1005"), normalizeInvoiceNumber("15"));
});

test("normalizeInvoiceNumber: nothing left to compare is null (blank, punctuation only, all zeros)", () => {
  for (const v of ["", "   ", "---", "# /", "0", "000", "0-0", null, undefined, 5]) {
    assert.equal(normalizeInvoiceNumber(v), null, String(v));
  }
});

test("normalizeInvoiceNumber keeps letters and digits from other alphabets", () => {
  assert.equal(normalizeInvoiceNumber("facture-é12"), "FACTUREÉ12");
});

test("the database pre-filter pattern matches every stored spelling of the same key", () => {
  const key = normalizeInvoiceNumber("INV-0042")!;
  const pattern = new RegExp(`^${invoiceNumberLikePattern(key).replace(/%/g, ".*")}$`, "i");
  for (const stored of ["INV-0042", "inv0042", "INV 0042", "Inv.0042", "INV-0042-B"]) assert.match(stored, pattern, stored);
  assert.doesNotMatch("INV-0043", pattern);
  // leading zeros were dropped from the key, and the stored number still has them
  assert.match("000123", new RegExp(`^${invoiceNumberLikePattern("123").replace(/%/g, ".*")}$`));
  assert.equal(invoiceNumberLikePattern("AB1"), "%A%B%1%");
});

// ---- the duplicate rule --------------------------------------------------------------------

const saved = (id: string, merchant: string, invoice_number: string | null, total = 100, date = "2026-03-10") => ({
  id,
  merchant_name: merchant,
  transaction_date: date,
  total_amount: total,
  invoice_number,
});

test("duplicate: same merchant and same normalized number match, whatever the spelling of either", () => {
  const rows = [saved("a", "Home Depot #4521", "INV-0042")];
  const m = invoiceNumberMatches({ merchant: "HOME DEPOT", invoice_number: " inv 0042 ", total: 100 }, rows);
  assert.deepEqual(m.map((x) => x.id), ["a"]);
  assert.equal(m[0].invoice_number, "INV-0042");
  assert.equal(m[0].same_total, true);
});

test("duplicate: a blank number checks nothing", () => {
  const rows = [saved("a", "Home Depot", "INV-0042"), saved("b", "Home Depot", null)];
  for (const invoice_number of ["", "   ", "---", "000", null, undefined]) {
    assert.deepEqual(invoiceNumberMatches({ merchant: "Home Depot", invoice_number, total: 100 }, rows), []);
  }
  // and a saved expense with no number is never a match for a typed one
  assert.deepEqual(invoiceNumberMatches({ merchant: "Home Depot", invoice_number: "INV-1", total: 100 }, [saved("b", "Home Depot", null)]), []);
});

test("duplicate: the same number from a DIFFERENT merchant is not a duplicate", () => {
  const rows = [saved("a", "Rona", "INV-0042")];
  assert.deepEqual(invoiceNumberMatches({ merchant: "Home Depot", invoice_number: "INV-0042", total: 100 }, rows), []);
  // "Shell" and "Shell Energy" stay different merchants here too
  assert.deepEqual(
    invoiceNumberMatches({ merchant: "Shell", invoice_number: "9001", total: 50 }, [saved("s", "Shell Energy", "9001", 50)]),
    [],
  );
});

test("duplicate: the same number and merchant with a DIFFERENT total still matches, and says the total differs", () => {
  const rows = [saved("a", "Home Depot", "INV-0042", 100)];
  const m = invoiceNumberMatches({ merchant: "Home Depot", invoice_number: "INV-0042", total: 125.5 }, rows);
  assert.equal(m.length, 1);
  assert.equal(m[0].same_total, false);
  const money = (n: number) => `$${n.toFixed(2)}`;
  const text = invoiceNumberWarningText(m, 125.5, money)!;
  assert.match(text.detail, /the total differs: \$100\.00 saved, \$125\.50 here/);
  assert.match(text.detail, /just save it/);
});

test("duplicate: the same total gets the plain wording, and a matching date is not needed", () => {
  const rows = [saved("a", "Home Depot", "INV-0042", 100, "2025-01-02")];
  const m = invoiceNumberMatches({ merchant: "Home Depot", invoice_number: "INV-0042", total: 100 }, rows);
  assert.equal(m.length, 1, "a date months apart still matches");
  const text = invoiceNumberWarningText(m, 100, (n) => `$${n.toFixed(2)}`)!;
  assert.doesNotMatch(text.detail, /differs/);
  assert.match(text.detail, /Home Depot invoice INV-0042 \(\$100\.00\)/);
  assert.equal(invoiceNumberWarningText([], 100, String), null);
});

test("duplicate: an unknown total is not claimed to differ", () => {
  const m = invoiceNumberMatches({ merchant: "Home Depot", invoice_number: "INV-0042", total: 0 }, [saved("a", "Home Depot", "INV-0042", 100)]);
  assert.equal(m.length, 1);
  assert.doesNotMatch(invoiceNumberWarningText(m, 0, (n) => `$${n}`)!.detail, /differs/);
});

test("duplicate: a merchant with no usable name checks nothing", () => {
  assert.deepEqual(invoiceNumberMatches({ merchant: "   ", invoice_number: "INV-1", total: 10 }, [saved("a", "   ", "INV-1", 10)]), []);
});

test("duplicate: same-total matches come first, then the newest; at most three are returned", () => {
  const rows = [
    saved("old-diff", "Home Depot", "INV-7", 50, "2026-01-01"),
    saved("new-diff", "Home Depot", "INV-7", 60, "2026-03-01"),
    saved("same", "Home Depot", "INV-7", 100, "2026-02-01"),
    saved("extra", "Home Depot", "INV-7", 70, "2025-12-01"),
  ];
  const m = invoiceNumberMatches({ merchant: "Home Depot", invoice_number: "INV-7", total: 100 }, rows);
  assert.deepEqual(m.map((x) => x.id), ["same", "new-diff", "old-diff"]);
});

test("duplicate: it outranks the merchant + total + date rule - a number match does not need the total or date", () => {
  const rows = [saved("a", "Home Depot", "INV-0042", 100, "2026-03-10")];
  // the old rule needs the same total within two days: a different total finds nothing...
  assert.deepEqual(similarReceipts({ merchant: "Home Depot", total: 130, date: "2026-03-10" }, rows), []);
  // ...but the invoice number still does
  assert.equal(invoiceNumberMatches({ merchant: "Home Depot", invoice_number: "INV-0042", total: 130 }, rows).length, 1);
});

test("the server answer drops a receipt the invoice check already found from the other two lists", () => {
  const src = read("./receipt-duplicates-server.ts");
  assert.match(src, /invoiceIds\.has\(s\.id\)/, "similar excludes invoice matches");
  assert.match(src, /attached\.filter\(\(a\) => !invoiceIds\.has\(a\.id\)\)/, "attached excludes invoice matches");
  assert.match(src, /\.eq\("user_id", userId\)/, "the lookup is scoped to the owner");
  assert.match(src, /\.not\("invoice_number", "is", null\)/);
});

// ---- the API ---------------------------------------------------------------------------------

test("the routes clean the number with cleanInvoiceNumber and never store it raw", () => {
  const post = read("../app/api/receipts/route.ts");
  assert.match(post, /cleanInvoiceNumber\(invoice_number\)/);
  assert.match(post, /invoice_number: invoiceNumber/);
  assert.doesNotMatch(post, /invoice_number: invoice_number/);

  const patch = read("../app/api/receipts/[id]/route.ts");
  assert.match(patch, /invoice_number !== undefined && \{ invoice_number: cleanInvoiceNumber\(invoice_number\) \}/);

  const attach = read("../app/api/receipts/[id]/attach/route.ts");
  assert.match(attach, /cleanInvoiceNumber\(invoice_number\)/);
  assert.doesNotMatch(attach, /invoice_number: invoice_number/);

  const check = read("../app/api/receipts/duplicate-check/route.ts");
  assert.match(check, /cleanInvoiceNumber\(url\.searchParams\.get\("invoice_number"\)\)/);
});

test("the manual expense dialog, the review dialog and the drawer all send the number and cap the input", () => {
  for (const file of ["manual-expense-dialog", "upload-receipt", "receipt-detail-dialog"]) {
    const src = read(`../components/dashboard/${file}.tsx`);
    assert.match(src, /invoice_number: (form|draft)\.invoice_number/, `${file} sends it`);
    assert.match(src, /maxLength=\{INVOICE_NUMBER_MAX\}/, `${file} caps the input`);
    assert.match(src, /Invoice \/ receipt number \(optional\)/, `${file} labels it optional`);
    assert.doesNotMatch(src, /required[^\n]*invoice|invoice[^\n]*\brequired\b/i, `${file} does not require it`);
  }
});

// ---- Gemini ----------------------------------------------------------------------------------

test("Gemini: invoice_number is a nullable string in the schema and is NOT required", () => {
  const src = read("./gemini.ts");
  const schema = src.slice(src.indexOf("const RECEIPT_SCHEMA"), src.indexOf("function buildSystemPrompt"));
  assert.match(
    schema,
    /invoice_number: \{\s*type: Type\.STRING,\s*nullable: true,\s*description: "The invoice or receipt number printed on the document, or null\.",\s*\},/,
  );
  const required = schema.slice(schema.lastIndexOf("required: ["));
  assert.doesNotMatch(required, /invoice_number/);
  // the other fields are still required
  for (const f of ["merchant_name", "total_amount", "tax_category", "items"]) assert.match(required, new RegExp(`"${f}"`));
});

test("Gemini: the prompt says to copy it as printed, name what it is not, and return null when unsure", () => {
  const src = read("./gemini.ts");
  const prompt = src.slice(src.indexOf("function buildSystemPrompt"));
  assert.match(prompt, /invoice_number: [\s\S]*copied exactly as/);
  for (const word of ["order number", "purchase order", "account", "card number", "phone number", "GST/HST"]) {
    assert.ok(prompt.includes(word), `the prompt rules out ${word}`);
  }
  assert.match(prompt, /return null - never guess/);
});

test("Gemini: parseReceiptImage returns the cleaned number (ParsedReceipt carries it)", () => {
  const src = read("./gemini.ts");
  assert.match(src, /invoice_number: string \| null;/);
  assert.match(src, /invoice_number: cleanInvoiceNumber\(parsed\.invoice_number\)/);
});

// ---- exports ---------------------------------------------------------------------------------

const receipt = (over: Partial<Receipt>) =>
  ({
    merchant_name: "Home Depot",
    transaction_date: "2026-03-14",
    total_amount: 48.2,
    tax_amount: 5.55,
    tax_category: "Materials & Supplies",
    items: [],
    paid_with_account_id: null,
    ...over,
  }) as Receipt;

test("generic CSV: 'Invoice number' is the last column, filled when present, blank otherwise", () => {
  const lines = receiptsToCsv([receipt({ invoice_number: "INV-0042" }), receipt({ invoice_number: null })]).split("\n");
  const header = lines[0].split(",");
  assert.equal(header.at(-1), "Invoice number");
  assert.equal(header.at(-2), "Tax Basis", "the existing columns did not move");
  assert.equal(lines[1].split(",").at(-1), "INV-0042");
  assert.equal(lines[2].split(",").at(-1), "");
  assert.equal(lines.at(-1)!.split(",").length, header.length, "the totals row has the same number of columns");
});

test("QuickBooks CSV format is unchanged: no invoice number anywhere", () => {
  const csv = receiptsToQuickBooksCsv([receipt({ invoice_number: "INV-0042" })]);
  assert.doesNotMatch(csv, /INV-0042|Invoice/i);
  const row = csv.split("\n")[1].split(",");
  assert.equal(row.length, csv.split("\n")[0].split(",").length);
  assert.equal(csv.split("\n")[1], "03/14/2026,Home Depot - Materials & Supplies,48.20,");
});

// ---- the migration -----------------------------------------------------------------------------

test("migration 0073: a nullable column and a partial index, no backfill, no grants, and a rollback", () => {
  const sql = read("../../supabase/migrations/0073_receipt_invoice_number.sql");
  assert.match(sql, /add column invoice_number text;/);
  assert.match(sql, /create index receipts_user_invoice_number_idx\s+on public\.receipts \(user_id, invoice_number\)\s+where invoice_number is not null;/);
  const code = sql.replace(/--.*$/gm, "");
  assert.doesNotMatch(code, /\bgrant\b|\brevoke\b|\bupdate\b|\binsert\b/i);
  assert.doesNotMatch(code, /add column invoice_number text[^;]*(not null|default|unique)/i);
  const rollback = read("../../supabase/rollbacks/0073_receipt_invoice_number_rollback.sql");
  assert.match(rollback, /drop index if exists public\.receipts_user_invoice_number_idx;/);
  assert.match(rollback, /drop column if exists invoice_number;/);
});

// ---- the manual expense dialog: same merchant, same number, entered by hand ----------------------

type Row = Record<string, unknown>;
// A minimal stand-in for the Supabase query builder: it applies .eq / .ilike / .gte / .lte to the rows,
// ignores .not / .order / .limit, and records which tables were read.
function fakeClient(rows: Row[]) {
  const reads: string[] = [];
  const client = {
    from(table: string) {
      reads.push(table);
      let q = rows.slice();
      const b = {
        select: () => b,
        eq: (c: string, v: unknown) => ((q = q.filter((r) => r[c] === v)), b),
        not: () => b,
        ilike: (c: string, p: string) => {
          const re = new RegExp(`^${p.replace(/%/g, ".*")}$`, "i");
          return ((q = q.filter((r) => re.test(String(r[c] ?? "")))), b);
        },
        gte: (c: string, v: string) => ((q = q.filter((r) => String(r[c]) >= v)), b),
        lte: (c: string, v: string) => ((q = q.filter((r) => String(r[c]) <= v)), b),
        order: () => b,
        limit: () => b,
        then: (resolve: (v: { data: Row[]; error: null }) => void) => resolve({ data: q, error: null }),
      };
      return b;
    },
  };
  return { client: client as unknown as Parameters<typeof findDuplicateChecks>[0], reads };
}

const manualRow = (over: Row = {}): Row => ({
  id: "r1",
  user_id: "u1",
  merchant_name: "X",
  transaction_date: "2026-10-28",
  total_amount: 50,
  invoice_number: "INV-100",
  from_statement: false,
  no_receipt: false,
  ...over,
});

test("manual entry: a second expense with the same merchant and invoice number finds the first (invoice-only lookup)", async () => {
  const { client, reads } = fakeClient([manualRow()]);
  const r = await findDuplicateChecks(
    client,
    "u1",
    { merchant: "X", total: 50, date: "2026-10-29", invoice_number: "INV-100" },
    { invoiceOnly: true },
  );
  assert.deepEqual(r.invoice.map((m) => [m.id, m.invoice_number, m.same_total]), [["r1", "INV-100", true]]);
  assert.deepEqual([r.similar, r.attached], [[], []]);
  assert.deepEqual(reads, ["receipts"], "ONE query: the merchant + total + date rule is not run for a manual entry");
});

test("manual entry: the number is matched however it is typed the second time (case, spaces, dashes)", async () => {
  for (const typed of ["inv-100", " INV 100 ", "INV100", "Inv.100"]) {
    const { client } = fakeClient([manualRow()]);
    const r = await findDuplicateChecks(client, "u1", { merchant: "x", total: 0, date: "", invoice_number: typed }, { invoiceOnly: true });
    assert.equal(r.invoice.length, 1, typed);
  }
});

test("manual entry: a different total still warns (and says so); the date does not matter", async () => {
  const { client } = fakeClient([manualRow({ transaction_date: "2025-01-01" })]);
  const r = await findDuplicateChecks(client, "u1", { merchant: "X", total: 80, date: "2026-10-29", invoice_number: "INV-100" }, { invoiceOnly: true });
  assert.equal(r.invoice.length, 1);
  assert.equal(r.invoice[0].same_total, false);
  assert.match(invoiceNumberWarningText(r.invoice, 80, (n) => `$${n}`)!.detail, /total differs/);
});

test("manual entry: nothing is found for another merchant, another number, another owner, or a blank number", async () => {
  const run = (rows: Row[], candidate: { merchant: string; invoice_number: string | null }, user = "u1") =>
    findDuplicateChecks(fakeClient(rows).client, user, { total: 50, date: "2026-10-29", ...candidate }, { invoiceOnly: true });
  assert.equal((await run([manualRow()], { merchant: "Y", invoice_number: "INV-100" })).invoice.length, 0, "other merchant");
  assert.equal((await run([manualRow()], { merchant: "X", invoice_number: "INV-101" })).invoice.length, 0, "other number");
  assert.equal((await run([manualRow({ user_id: "u2" })], { merchant: "X", invoice_number: "INV-100" })).invoice.length, 0, "other owner's expense");
  assert.equal((await run([manualRow()], { merchant: "X", invoice_number: null })).invoice.length, 0, "blank number");
  assert.equal((await run([manualRow()], { merchant: "X", invoice_number: "  " })).invoice.length, 0, "whitespace number");
});

test("scan (full) lookup still runs the other rules, and an invoice match is not listed twice", async () => {
  const { client, reads } = fakeClient([manualRow()]);
  const r = await findDuplicateChecks(client, "u1", { merchant: "X", total: 50, date: "2026-10-28", invoice_number: "INV-100" });
  assert.equal(r.invoice.length, 1);
  assert.deepEqual(r.similar, [], "the same expense is shown under the invoice-number message only");
  assert.ok(reads.length >= 3, "invoice, similar and attached lookups all ran");
});

test("the manual dialog runs ONLY the invoice-number check: hook, blur, save-time re-check, warning, Save anyway", () => {
  const src = read("../components/dashboard/manual-expense-dialog.tsx");
  assert.match(src, /useInvoiceNumberCheck\(open, form\.merchant_name, form\.invoice_number, form\.total_amount\)/);
  assert.doesNotMatch(src, /useDuplicateChecks|SimilarReceiptsWarning|AlreadyAttachedWarning/, "no merchant + total + date check here");
  assert.match(src, /onBlur=\{\(\) => void invoiceCheck\.check\(\)\}/, "re-checked when the number field loses focus");
  assert.match(src, /await invoiceCheck\.check\(\)/, "and again at save");
  assert.match(src, /<InvoiceNumberWarning matches=\{invoiceCheck\.matches\}/);
  assert.match(src, /invoiceCheck\.matches\.length > 0 \? "Save anyway" : "Save Expense"/);
  // a match the person has not seen yet stops the first press; one already on screen never blocks
  assert.match(src, /found\.length > 0 && !alreadyShown/);
});

test("the hook asks the route for the invoice rule only, and the route honours it", () => {
  const hook = read("../components/dashboard/duplicate-warnings.tsx");
  assert.match(hook, /invoice_only: "1"/);
  assert.match(hook, /debounce|setTimeout\(async \(\) => \{\s*const matches = await lookup\(\)/);
  const route = read("../app/api/receipts/duplicate-check/route.ts");
  assert.match(route, /searchParams\.get\("invoice_only"\) === "1"/);
  assert.match(route, /\{ invoiceOnly \}/);
});
