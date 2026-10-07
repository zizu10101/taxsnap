import type { StatementCtx } from "@/lib/statement-server";
import type { StatementLine } from "@/lib/database.types";
import { computeLineCandidates, isMatchable, type LineCandidates } from "@/lib/statement-candidates";
import { dayNumber } from "@/lib/statement-lines";
import type { MatchRow } from "@/lib/statement-matching";
import { STATEMENT_VENDOR_WINDOW_DAYS } from "@/lib/statement-config";
import type { Stopwatch } from "@/lib/statement-timing";

// Gathers the receipts a statement's lines could match (read through the
// caller's session, so RLS scopes them) and runs the pure matcher.

const DAY_MS = 86_400_000;
// The widest gap any match can have: a same-vendor, same-amount bill (30 days), plus a day of slack.
const WINDOW_PADDING_DAYS = STATEMENT_VENDOR_WINDOW_DAYS + 1;

export interface ReceiptBrief {
  id: string;
  merchant_name: string;
  transaction_date: string;
  total_amount: number;
  tax_category: string;
}

function isoDay(dayNum: number): string {
  return new Date(dayNum * DAY_MS).toISOString().slice(0, 10);
}

export async function loadMatchPool(
  ctx: StatementCtx,
  lines: StatementLine[],
  timer?: Stopwatch,
): Promise<{ pool: MatchRow[]; briefs: Map<string, ReceiptBrief>; claimedBy: Map<string, string> }> {
  const briefs = new Map<string, ReceiptBrief>();
  const claimedBy = new Map<string, string>();

  // Receipts any line (in any import of this user) already claims.
  const { data: claims } = await ctx.supabase
    .from("statement_lines")
    .select("id, matched_receipt_id")
    .not("matched_receipt_id", "is", null);
  for (const c of claims ?? []) {
    if (c.matched_receipt_id) claimedBy.set(c.matched_receipt_id, c.id);
  }
  timer?.lap("match_claims");
  timer?.note("match_claims_rows", claims?.length ?? 0);

  const matchable = lines.filter((l) => isMatchable({ ...l }) || l.resolution === "matched");
  if (matchable.length === 0) return { pool: [], briefs, claimedBy };

  const days = matchable.map((l) => dayNumber(l.txn_date));
  const lo = isoDay(Math.min(...days) - WINDOW_PADDING_DAYS);
  const hi = isoDay(Math.max(...days) + WINDOW_PADDING_DAYS);

  const { data: receipts } = await ctx.supabase
    .from("receipts")
    .select("*")
    .eq("user_id", ctx.user.id)
    .gte("transaction_date", lo)
    .lte("transaction_date", hi)
    .limit(5000);
  // The window query is the one whose cost grows with the owner's receipts: log how many came back.
  timer?.lap("match_receipts");
  timer?.note("match_receipts_rows", receipts?.length ?? 0);

  const pool: MatchRow[] = [];
  for (const rc of receipts ?? []) {
    // Statement-created expenses are the other side of a match, not candidates
    // for one; a refund-shaped (non-positive) row can't back a charge.
    if (rc.from_statement || rc.total_amount <= 0) continue;
    pool.push({ id: rc.id, date: rc.transaction_date, amount: rc.total_amount, vendor: rc.merchant_name });
    briefs.set(rc.id, {
      id: rc.id,
      merchant_name: rc.merchant_name,
      transaction_date: rc.transaction_date,
      total_amount: rc.total_amount,
      tax_category: rc.tax_category,
    });
  }

  // Briefs for receipts already matched by this import's lines (they may fall
  // outside the window above if the user matched them by hand).
  const matchedIds = lines
    .map((l) => l.matched_receipt_id)
    .filter((id): id is string => !!id && !briefs.has(id));
  if (matchedIds.length > 0) {
    const { data: matched } = await ctx.supabase
      .from("receipts")
      .select("*")
      .eq("user_id", ctx.user.id)
      .in("id", matchedIds);
    for (const rc of matched ?? []) {
      briefs.set(rc.id, {
        id: rc.id,
        merchant_name: rc.merchant_name,
        transaction_date: rc.transaction_date,
        total_amount: rc.total_amount,
        tax_category: rc.tax_category,
      });
    }
  }

  timer?.lap("match_pool");
  timer?.note("match_pool_size", pool.length);
  return { pool, briefs, claimedBy };
}

export async function candidatesForLines(
  ctx: StatementCtx,
  lines: StatementLine[],
  timer?: Stopwatch,
): Promise<LineCandidates & { briefs: Map<string, ReceiptBrief> }> {
  const { pool, briefs, claimedBy } = await loadMatchPool(ctx, lines, timer);
  const result = computeLineCandidates(lines, pool, claimedBy);
  timer?.lap("match_compute");
  timer?.note("match_lines", lines.length);
  return { ...result, briefs };
}

// Accepts the unambiguous matches right after extraction. Never overwrites a
// decision the user already made (the update only touches lines still undecided)
// and quietly skips a receipt that another line claimed in the meantime.
export async function applyAutoMatches(ctx: StatementCtx, importId: string, timer?: Stopwatch): Promise<number> {
  const { data: lines } = await ctx.supabase
    .from("statement_lines")
    .select("*")
    .eq("import_id", importId)
    .eq("user_id", ctx.user.id);
  timer?.lap("auto_lines");
  if (!lines || lines.length === 0) return 0;

  const { auto } = await candidatesForLines(ctx, lines, timer);
  let applied = 0;
  for (const [lineId, receiptId] of auto) {
    const { error, count } = await ctx.admin
      .from("statement_lines")
      .update({ resolution: "matched", matched_receipt_id: receiptId }, { count: "exact" })
      .eq("id", lineId)
      .eq("user_id", ctx.user.id)
      .is("resolution", null);
    if (!error && (count ?? 0) > 0) applied += 1;
  }
  timer?.lap("auto_apply");
  return applied;
}
