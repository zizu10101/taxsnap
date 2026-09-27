import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface CommissionOverviewData {
  // Grand total across every sale, services + products - totalServiceRevenue
  // + totalProductRevenue. Kept as its own field (rather than derived
  // client-side) since it predates the products split and every existing
  // consumer already reads it as "the" sales total.
  totalSales: number;
  // Commission-eligible portion of totalSales - only services carry a
  // stylist/commission, so this equals the sum of every commission_entries
  // row's own price_charged, same as totalSales used to mean before
  // products existed.
  totalServiceRevenue: number;
  // Pure shop revenue with no stylist attribution - sum of every
  // register_transaction_products line item's price_charged.
  totalProductRevenue: number;
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
    .select(
      "created_at, price_charged, commission_owed, payout_id, payment_method, tax_amount, transaction_id",
    )
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

  // Register transactions in range, with their product line items nested -
  // the products split (item 5 of the multi-item Register feature) reads
  // straight off these rather than commission_entries, since product line
  // items never get their own commission_entries row (no stylist, no
  // commission - see 0036_register_transactions.sql). Also the source of
  // truth for payment-method counts on any multi-item sale: `subtotal` is
  // one checkout's whole pre-tax total (services + products together), so
  // grouping by transaction here - rather than by each of its individual
  // commission_entries/register_transaction_products rows - is what keeps
  // a 3-item cart counting as one sale instead of three.
  let transactionsQuery = supabase
    .from("register_transactions")
    .select(
      "payment_method, subtotal, register_transaction_products(price_charged, tax_amount, is_deleted)",
    )
    .order("created_at", { ascending: true });
  if (from) transactionsQuery = transactionsQuery.gte("created_at", from);
  if (to) transactionsQuery = transactionsQuery.lt("created_at", to);

  const [{ data: entries }, { data: payouts }, { data: adjustments }, { data: transactions }] =
    await Promise.all([entriesQuery, payoutsQuery, adjustmentsQuery, transactionsQuery]);

  const products = (transactions ?? []).flatMap((t) =>
    (t.register_transaction_products ?? []).filter((p) => !p.is_deleted),
  );

  const totalServiceRevenue = round2(
    (entries ?? []).reduce((sum, e) => sum + e.price_charged, 0),
  );
  const totalProductRevenue = round2(products.reduce((sum, p) => sum + p.price_charged, 0));
  const totalSales = round2(totalServiceRevenue + totalProductRevenue);
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

  // "count" here means number of sales, not number of line items - a
  // 2-service-and-a-product cart paid by one method is one sale, not
  // three. Pre-migration entries (transaction_id null) are still each
  // their own standalone sale, exactly as before; every entry logged as
  // part of a multi-item Register cart is represented once, via its
  // shared transaction's own subtotal/payment_method, instead of being
  // counted again per line item.
  const methodMap = new Map<string, { count: number; total: number }>();
  for (const e of entries ?? []) {
    if (e.transaction_id !== null) continue;
    const key = e.payment_method ?? "Unspecified";
    const row = methodMap.get(key) ?? { count: 0, total: 0 };
    row.count += 1;
    row.total += e.price_charged;
    methodMap.set(key, row);
  }
  for (const t of transactions ?? []) {
    const key = t.payment_method ?? "Unspecified";
    const row = methodMap.get(key) ?? { count: 0, total: 0 };
    row.count += 1;
    row.total += t.subtotal;
    methodMap.set(key, row);
  }
  const paymentMethodTotals = [...methodMap.entries()]
    .map(([method, row]) => ({ method, count: row.count, total: round2(row.total) }))
    .sort((a, b) => b.total - a.total);

  const totalTaxCollected = round2(
    (entries ?? []).reduce((sum, e) => sum + (e.tax_amount ?? 0), 0) +
      products.reduce((sum, p) => sum + (p.tax_amount ?? 0), 0),
  );

  return {
    totalSales,
    totalServiceRevenue,
    totalProductRevenue,
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
