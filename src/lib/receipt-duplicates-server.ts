import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { isSha256Hex } from "./file-hash.ts";
import { invoiceNumberLikePattern, normalizeInvoiceNumber } from "./invoice-number.ts";
import { vendorKey } from "./merchant-name.ts";
import {
  attachedStatementMatches,
  invoiceNumberMatches,
  type InvoiceNumberCandidate,
  type InvoiceNumberMatch,
  DUPLICATE_WINDOW_DAYS,
  MAX_DUPLICATE_MATCHES,
  similarReceipts,
  type AttachedSummary,
  type DuplicateSummary,
  type SimilarCandidate,
} from "./receipt-duplicates.ts";
import { STATEMENT_VENDOR_WINDOW_DAYS } from "./statement-config.ts";

// Server-side lookups for the duplicate warnings. `client` is the caller's own session in the app
// (RLS scopes every read to their receipts) and every query also filters on user_id, so a mistake
// elsewhere could never widen it. Relative imports only, so the database test can run this exact
// code. If the file_sha256 column isn't there yet (migration 0056 not applied) the lookups return
// nothing rather than failing - scanning a receipt must keep working either way.

const SUMMARY_COLUMNS = "id, merchant_name, transaction_date, total_amount";
const DAY_MS = 86_400_000;

function isoDay(dayNum: number): string {
  return new Date(dayNum * DAY_MS).toISOString().slice(0, 10);
}

// Receipts of this owner scanned from a file with exactly this hash, newest first.
export async function findReceiptsByFileHash(
  client: SupabaseClient<Database>,
  userId: string,
  hash: string | null | undefined,
): Promise<DuplicateSummary[]> {
  if (!isSha256Hex(hash)) return [];
  const { data, error } = await client
    .from("receipts")
    .select(SUMMARY_COLUMNS)
    .eq("user_id", userId)
    .eq("file_sha256", hash)
    .order("created_at", { ascending: false })
    .limit(MAX_DUPLICATE_MATCHES);
  if (error) return [];
  return (data ?? []) as DuplicateSummary[];
}

// Should a scan stop before any upload or Gemini call? Only when its file hash matches one of the
// owner's receipts AND they haven't already chosen "Continue anyway" (`force`).
export async function checkExactFile(
  client: SupabaseClient<Database>,
  userId: string,
  hash: string | null | undefined,
  force: boolean,
): Promise<{ stop: boolean; matches: DuplicateSummary[] }> {
  if (force || !isSha256Hex(hash)) return { stop: false, matches: [] };
  const matches = await findReceiptsByFileHash(client, userId, hash);
  return { stop: matches.length > 0, matches };
}

// The same merchant, total and a date within two days: read by total and date in the database,
// compared by merchant in code (the merchant rule isn't expressible in SQL).
export async function findSimilarReceipts(
  client: SupabaseClient<Database>,
  userId: string,
  candidate: SimilarCandidate,
): Promise<DuplicateSummary[]> {
  if (!(candidate.total > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(candidate.date)) return [];
  const day = Math.round(new Date(`${candidate.date}T00:00:00Z`).getTime() / DAY_MS);
  const { data, error } = await client
    .from("receipts")
    .select("*")
    .eq("user_id", userId)
    .eq("total_amount", Math.round(candidate.total * 100) / 100)
    .gte("transaction_date", isoDay(day - DUPLICATE_WINDOW_DAYS))
    .lte("transaction_date", isoDay(day + DUPLICATE_WINDOW_DAYS));
  if (error) return [];
  return similarReceipts(candidate, data ?? []);
}

// Statement-created expenses that ALREADY have a receipt attached and look like the same charge
// (same vendor and amount within 30 days): scanning the invoice again would count it twice.
export async function findAttachedStatementExpenses(
  client: SupabaseClient<Database>,
  userId: string,
  candidate: SimilarCandidate,
): Promise<AttachedSummary[]> {
  if (!(candidate.total > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(candidate.date)) return [];
  const day = Math.round(new Date(`${candidate.date}T00:00:00Z`).getTime() / DAY_MS);
  const { data, error } = await client
    .from("receipts")
    .select("*")
    .eq("user_id", userId)
    .eq("from_statement", true)
    .eq("no_receipt", false)
    .eq("total_amount", Math.round(candidate.total * 100) / 100)
    .gte("transaction_date", isoDay(day - STATEMENT_VENDOR_WINDOW_DAYS))
    .lte("transaction_date", isoDay(day + STATEMENT_VENDOR_WINDOW_DAYS));
  if (error) return [];
  return attachedStatementMatches(candidate, data ?? []);
}

// Saved expenses with the same invoice / receipt number and merchant. The database only narrows the
// search (this owner's numbered expenses whose number contains the key's characters in order - a
// superset, since normalising only removes characters; the partial index on (user_id,
// invoice_number) serves it); the exact number and merchant comparison is done in code, because the
// merchant rule isn't expressible in SQL. A blank number, or no usable merchant, checks nothing. If
// the invoice_number column isn't there yet (migration 0073 not applied) it answers nothing.
const INVOICE_LOOKUP_LIMIT = 200;

export async function findInvoiceNumberDuplicates(
  client: SupabaseClient<Database>,
  userId: string,
  candidate: InvoiceNumberCandidate,
): Promise<InvoiceNumberMatch[]> {
  const key = normalizeInvoiceNumber(candidate.invoice_number);
  if (key === null || vendorKey(candidate.merchant) === null) return [];
  const { data, error } = await client
    .from("receipts")
    .select(`${SUMMARY_COLUMNS}, invoice_number`)
    .eq("user_id", userId)
    .not("invoice_number", "is", null)
    .ilike("invoice_number", invoiceNumberLikePattern(key))
    .order("transaction_date", { ascending: false })
    .limit(INVOICE_LOOKUP_LIMIT);
  if (error) return [];
  return invoiceNumberMatches(candidate, data ?? []);
}

// All the soft checks together. The invoice-number match is the strongest and outranks the others:
// a receipt it found is shown once, under its own message, and removed from the other two answers.
// A receipt in BOTH of the other two is shown once, under the more specific "already has a receipt
// attached" message.
//
// `invoiceOnly` runs ONLY the invoice-number check (and reads nothing else): the manual expense
// dialog uses it, because a typed expense has no scan to compare and the merchant + total + date
// rule is for scans.
export async function findDuplicateChecks(
  client: SupabaseClient<Database>,
  userId: string,
  candidate: SimilarCandidate & { invoice_number?: string | null },
  options: { invoiceOnly?: boolean } = {},
): Promise<{ invoice: InvoiceNumberMatch[]; similar: DuplicateSummary[]; attached: AttachedSummary[] }> {
  if (options.invoiceOnly) {
    const invoice = await findInvoiceNumberDuplicates(client, userId, {
      merchant: candidate.merchant,
      invoice_number: candidate.invoice_number,
      total: candidate.total,
    });
    return { invoice, similar: [], attached: [] };
  }
  const [invoice, similar, attached] = await Promise.all([
    findInvoiceNumberDuplicates(client, userId, {
      merchant: candidate.merchant,
      invoice_number: candidate.invoice_number,
      total: candidate.total,
    }),
    findSimilarReceipts(client, userId, candidate),
    findAttachedStatementExpenses(client, userId, candidate),
  ]);
  const invoiceIds = new Set(invoice.map((i) => i.id));
  const attachedLeft = attached.filter((a) => !invoiceIds.has(a.id));
  const attachedIds = new Set(attachedLeft.map((a) => a.id));
  return {
    invoice,
    similar: similar.filter((s) => !invoiceIds.has(s.id) && !attachedIds.has(s.id)),
    attached: attachedLeft,
  };
}
