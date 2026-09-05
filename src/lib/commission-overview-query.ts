import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface CommissionOverviewData {
  totalSales: number;
  totalCommissionOwed: number;
  ownersCut: number;
  commissionPaid: number;
  commissionUnpaid: number;
  trendPoints: { createdAt: string; priceCharged: number; commissionOwed: number }[];
  // Reference/reporting only (0024_commission_payment_tax.sql) - not fed
  // into the real HST Return Helper. paymentMethodTotals is revenue
  // (price_charged) summed per method, in descending order; entries logged
  // without a payment method (pre-feature, or the field left unset) are
  // grouped under "Unspecified" rather than silently dropped.
  paymentMethodTotals: { method: string; count: number; total: number }[];
  totalTaxCollected: number;
}

// Shop-wide rollup across every stylist, shared between GET
// /api/commission/overview and the Overview page's own initial server
// render, so the two call sites can't drift. RLS alone scopes every query
// to the caller's own data (commission_entries has its own user_id
// column; payouts/adjustments are scoped through their parent stylist's
// user_id), same as every sibling route - no explicit ownership filter
// needed here either. Caller is responsible for its own auth/tier check
// (requireProUser for the API route, the page's own profile fetch for
// SSR) - this assumes it's already authorized.
export async function getCommissionOverviewData(
  supabase: SupabaseClient<Database>,
  from: string | null,
  to: string | null,
): Promise<CommissionOverviewData> {
  // Total Sales and Total Commission Owed both come from this query -
  // accrued means every non-deleted entry in range regardless of
  // payout_id, so there's deliberately no status filter here.
  let entriesQuery = supabase
    .from("commission_entries")
    .select("created_at, price_charged, commission_owed, payout_id, payment_method, tax_amount")
    .eq("is_deleted", false)
    .order("created_at", { ascending: true });
  if (from) entriesQuery = entriesQuery.gte("created_at", from);
  if (to) entriesQuery = entriesQuery.lt("created_at", to);

  // Commission Paid - filters on paid_at, not range_start/range_end; a
  // payout's own range can predate or postdate when it was actually paid
  // out, and this figure is asking "what left the till in this window,"
  // not "what work does this payout cover."
  let payoutsQuery = supabase.from("payouts").select("total_amount").eq("status", "active");
  if (from) payoutsQuery = payoutsQuery.gte("paid_at", from);
  if (to) payoutsQuery = payoutsQuery.lt("paid_at", to);

  // Unapplied-adjustments half of Outstanding. Adjustments have no
  // service date of their own (0016_adjustments.sql - they correct a past
  // confirmed payout, not a date range), so "in range" here means
  // created_at, same as everywhere else.
  let adjustmentsQuery = supabase
    .from("adjustments")
    .select("amount")
    .is("applied_payout_id", null);
  if (from) adjustmentsQuery = adjustmentsQuery.gte("created_at", from);
  if (to) adjustmentsQuery = adjustmentsQuery.lt("created_at", to);

  const [{ data: entries }, { data: payouts }, { data: adjustments }] = await Promise.all([
    entriesQuery,
    payoutsQuery,
    adjustmentsQuery,
  ]);

  const totalSales = round2((entries ?? []).reduce((sum, e) => sum + e.price_charged, 0));
  const totalCommissionOwed = round2(
    (entries ?? []).reduce((sum, e) => sum + e.commission_owed, 0),
  );
  const commissionPaid = round2((payouts ?? []).reduce((sum, p) => sum + p.total_amount, 0));

  const unpaidEntriesTotal = (entries ?? [])
    .filter((e) => e.payout_id === null)
    .reduce((sum, e) => sum + e.commission_owed, 0);
  const unappliedAdjustmentsTotal = (adjustments ?? []).reduce((sum, a) => sum + a.amount, 0);
  // Not clamped to 0 - a large negative adjustment can genuinely put this
  // below zero, and hiding that behind a floor would misrepresent the
  // real number.
  const commissionUnpaid = round2(unpaidEntriesTotal + unappliedAdjustmentsTotal);

  const methodMap = new Map<string, { count: number; total: number }>();
  for (const e of entries ?? []) {
    const key = e.payment_method ?? "Unspecified";
    const row = methodMap.get(key) ?? { count: 0, total: 0 };
    row.count += 1;
    row.total += e.price_charged;
    methodMap.set(key, row);
  }
  const paymentMethodTotals = [...methodMap.entries()]
    .map(([method, row]) => ({ method, count: row.count, total: round2(row.total) }))
    .sort((a, b) => b.total - a.total);

  const totalTaxCollected = round2(
    (entries ?? []).reduce((sum, e) => sum + (e.tax_amount ?? 0), 0),
  );

  return {
    totalSales,
    totalCommissionOwed,
    ownersCut: round2(totalSales - totalCommissionOwed),
    commissionPaid,
    commissionUnpaid,
    // Minimal per-entry points for the trend chart - not the full
    // stylist/service-joined shape GET /api/commission-entries returns,
    // since Overview never displays individual entries, only sums them
    // into day/week/month buckets client-side (see lib/commission-overview.ts).
    trendPoints: (entries ?? []).map((e) => ({
      createdAt: e.created_at,
      priceCharged: e.price_charged,
      commissionOwed: e.commission_owed,
    })),
    paymentMethodTotals,
    totalTaxCollected,
  };
}
