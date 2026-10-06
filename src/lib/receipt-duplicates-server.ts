import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { isSha256Hex } from "./file-hash.ts";
import {
  attachedStatementMatches,
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

// Both soft checks together. A receipt in BOTH answers is shown once, under the more specific
// "already has a receipt attached" message.
export async function findDuplicateChecks(
  client: SupabaseClient<Database>,
  userId: string,
  candidate: SimilarCandidate,
): Promise<{ similar: DuplicateSummary[]; attached: AttachedSummary[] }> {
  const [similar, attached] = await Promise.all([
    findSimilarReceipts(client, userId, candidate),
    findAttachedStatementExpenses(client, userId, candidate),
  ]);
  const attachedIds = new Set(attached.map((a) => a.id));
  return { similar: similar.filter((s) => !attachedIds.has(s.id)), attached };
}
