import { NextResponse } from "next/server";
import { requireStatementUser } from "@/lib/statement-server";
import { dayNumber, isIsoDate } from "@/lib/statement-lines";
import { pickPreselect, rankCandidates } from "@/lib/statement-matching";
import { browseExpenses } from "@/lib/statement-browse";
import { STATEMENT_BROWSE_LIMIT, STATEMENT_VENDOR_WINDOW_DAYS } from "@/lib/statement-config";

export const runtime = "nodejs";

const DAY_MS = 86_400_000;
// The widest gap a candidate can have (a same-vendor bill, 30 days) plus a day of slack.
const WINDOW_DAYS = STATEMENT_VENDOR_WINDOW_DAYS + 1;
// The picker ranks in memory; this bounds what it reads for one request.
const BROWSE_FETCH_LIMIT = 2000;

function isoDay(dayNum: number): string {
  return new Date(dayNum * DAY_MS).toISOString().slice(0, 10);
}

// "Is this freshly scanned receipt the one a statement import already created an
// expense for?" Looks only at expenses still waiting for a receipt (no_receipt) -
// anything that already has a receipt is excluded - using the matcher's rules:
// same vendor and amount within 30 days, or same amount within a few days.
//
//   GET ?total=&date=&merchant=            -> the candidates, best first, and
//                                             `preselect_id`: the nearest one when it
//                                             is clearly nearest (a tie, or only a
//                                             close-amount guess, preselects nothing),
//                                             and `waiting_count`: how many statement
//                                             expenses are waiting for a receipt AT ALL,
//                                             which is what decides whether the manual
//                                             picker is offered.
//   GET ?mode=browse&date=&total=&merchant=&q=&offset=
//                                          -> the manual picker: EVERY waiting
//                                             expense, ranked, searchable, 100 a page.
//
// Nothing is attached here; candidates are only ever offered. If the receipts
// columns from migration 0053 aren't there the query fails; that is reported as
// "no candidates" so scanning a receipt keeps working.
export async function GET(request: Request) {
  const auth = await requireStatementUser();
  if ("response" in auth) return auth.response;
  const { ctx } = auth;

  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const merchant = url.searchParams.get("merchant")?.slice(0, 200) || null;
  const totalParam = url.searchParams.get("total");
  const total = totalParam === null || totalParam === "" ? null : Number(totalParam);
  if (!isIsoDate(date) || (total !== null && !Number.isFinite(total))) {
    return NextResponse.json({ candidates: [], preselect_id: null, waiting_count: 0 });
  }

  if (url.searchParams.get("mode") === "browse") {
    const { data, error } = await ctx.supabase
      .from("receipts")
      .select("*")
      .eq("user_id", ctx.user.id)
      .eq("no_receipt", true)
      .order("transaction_date", { ascending: false })
      .limit(BROWSE_FETCH_LIMIT);
    if (error) return NextResponse.json({ items: [], total: 0, hasMore: false, offset: 0, unavailable: true });

    const rows = (data ?? [])
      .filter((r) => r.total_amount > 0)
      .map((r) => ({
        id: r.id,
        date: r.transaction_date,
        amount: r.total_amount,
        merchant_name: r.merchant_name,
        tax_category: r.tax_category,
      }));
    const page = browseExpenses(
      rows,
      { date, total: total !== null && total > 0 ? total : null, merchant },
      {
        q: url.searchParams.get("q") ?? "",
        offset: Number(url.searchParams.get("offset") ?? 0) || 0,
        limit: STATEMENT_BROWSE_LIMIT,
      },
    );
    return NextResponse.json({
      ...page,
      // True when there may be more waiting expenses than were read.
      capped: (data ?? []).length >= BROWSE_FETCH_LIMIT,
    });
  }

  // Every waiting expense, whatever its date: the manual picker lists them all.
  const { count: waiting, error: waitingError } = await ctx.supabase
    .from("receipts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.user.id)
    .eq("no_receipt", true)
    .gt("total_amount", 0);
  const waitingCount = waitingError ? 0 : (waiting ?? 0);

  if (total === null || total <= 0) {
    return NextResponse.json({ candidates: [], preselect_id: null, waiting_count: waitingCount });
  }

  const center = dayNumber(date);
  const { data, error } = await ctx.supabase
    .from("receipts")
    .select("*")
    .eq("user_id", ctx.user.id)
    .eq("no_receipt", true)
    .gte("transaction_date", isoDay(center - WINDOW_DAYS))
    .lte("transaction_date", isoDay(center + WINDOW_DAYS));
  if (error) return NextResponse.json({ candidates: [], preselect_id: null, waiting_count: 0, unavailable: true });

  const placeholders = (data ?? []).filter((r) => r.total_amount > 0);
  const ranked = rankCandidates(
    { id: "scan", date, amount: total, vendor: merchant },
    placeholders.map((r) => ({
      id: r.id,
      date: r.transaction_date,
      amount: r.total_amount,
      vendor: r.merchant_name,
    })),
  );
  const byId = new Map(placeholders.map((r) => [r.id, r]));

  return NextResponse.json({
    candidates: ranked.map((c) => {
      const r = byId.get(c.id)!;
      return {
        ...c,
        receipt: {
          id: r.id,
          merchant_name: r.merchant_name,
          transaction_date: r.transaction_date,
          total_amount: r.total_amount,
          tax_category: r.tax_category,
        },
      };
    }),
    preselect_id: pickPreselect(ranked),
    waiting_count: waitingCount,
  });
}
