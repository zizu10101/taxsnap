import type { BillingInterval, BillingTier } from "@/lib/stripe";
import { PLAN_LIMITS } from "@/lib/plan-limits";

export const FREE_SCAN_LIMIT = PLAN_LIMITS.free.scansPerMonth!;

// "$12 CAD/mo" / "$120 CAD/yr" - shared so the toggle's two price displays
// (and /billing's) can never drift into different formatting.
export function formatCadPrice(amount: number, interval: BillingInterval): string {
  const suffix = interval === "monthly" ? "/mo" : "/yr";
  return `$${amount} CAD${suffix}`;
}

// The per-month equivalent of a yearly price, e.g. 120 -> "$10.00/mo",
// 290 -> "$24.17/mo" - shown next to the annual price so "2 months free"
// has a concrete monthly number to compare against the monthly plan's own
// price, not just a badge.
export function formatPerMonthEquivalent(yearlyAmount: number): string {
  return `$${(yearlyAmount / 12).toFixed(2)}/mo`;
}

// Shared between the homepage FAQ, /billing, and Settings' CurrentPlanCard
// so this can't drift into three different descriptions of the same
// policy. Verified against real Stripe Customer Portal sessions (not
// assumed, and not just direct Subscriptions API calls, which always
// apply immediately regardless of this account's portal configuration):
// an upgrade (a pricier plan, or a longer billing interval on the same
// plan) is invoiced and charged immediately. A downgrade (a cheaper plan
// - Plus<->Pro included, despite them being separate Stripe Products - or
// a shorter/cheaper interval on the same plan) instead gets deferred via
// a Stripe Subscription Schedule to the end of the current billing
// period, with no charge now and the current plan/price untouched until
// then - the same timing cancellation already uses. An earlier version of
// this comment claimed cross-tier (Plus<->Pro) changes could never defer,
// reasoning from Stripe's documented "same Product only" restriction on
// the portal's scheduling feature - a real portal-driven test (Pro yearly
// -> Plus yearly) contradicted that directly: `schedule_at_period_end`'s
// `decreasing_item_amount`/`shortening_interval` conditions do defer a
// cross-product downgrade too. Don't trust that doc claim over a real
// test again.
export const BILLING_CHANGE_POLICY =
  "Switching to a pricier plan or a longer billing interval takes effect immediately, with a prorated charge right away. Switching to a cheaper plan or a shorter interval, or cancelling, all take effect at the end of your current billing period - you keep your current plan and access until then.";

// Every tier gets every feature now (receipt scanning, HST estimate,
// invoicing/estimates, jobs, employees, commission) - only the usage caps
// differ (see src/lib/plan-limits.ts, the single source these numbers are
// read from so this copy can't drift out of sync with what the API
// actually enforces). Estimates are always unlimited/free at every tier -
// only converting one to an invoice counts against the invoice cap, so
// that's called out explicitly rather than left implicit.
export const FREE_PLAN = {
  name: "Free",
  price: "$0",
  description: `Try every feature — ${PLAN_LIMITS.free.scansPerMonth} scans/mo, ${PLAN_LIMITS.free.invoicesPerMonth} invoices/mo, ${PLAN_LIMITS.free.clients} clients, ${PLAN_LIMITS.free.jobs} job.`,
  features: [
    `${PLAN_LIMITS.free.scansPerMonth} receipt scans/month`,
    "Unlimited estimates",
    `${PLAN_LIMITS.free.invoicesPerMonth} invoices/month`,
    `${PLAN_LIMITS.free.clients} clients, ${PLAN_LIMITS.free.jobs} job`,
    "HST return estimate",
  ],
};

export const PRICING_PLANS: {
  tier: BillingTier;
  name: string;
  // Raw CAD amounts, not display strings - the Monthly/Annual toggle
  // needs to derive four different strings from these two numbers (see
  // formatCadPrice/formatPerMonthEquivalent above), which a single
  // hardcoded price string can't support. yearlyPrice is always exactly
  // 10x monthlyPrice ("2 months free") for both tiers today.
  monthlyPrice: number;
  yearlyPrice: number;
  description: string;
  features: string[];
}[] = [
  {
    tier: "basic",
    name: "Plus",
    monthlyPrice: 12,
    yearlyPrice: 120,
    description: `More room to grow — unlimited scans, ${PLAN_LIMITS.basic.invoicesPerMonth} invoices/mo, ${PLAN_LIMITS.basic.clients} clients, ${PLAN_LIMITS.basic.jobs} jobs.`,
    features: [
      "Everything in Free",
      "Unlimited receipt scans",
      `${PLAN_LIMITS.basic.invoicesPerMonth} invoices/month`,
      `${PLAN_LIMITS.basic.clients} clients, ${PLAN_LIMITS.basic.jobs} jobs`,
      "CSV export",
    ],
  },
  {
    tier: "pro",
    name: "Pro",
    monthlyPrice: 29,
    yearlyPrice: 290,
    description: "No limits — full invoicing, job costing, and accountant tools.",
    features: [
      "Everything in Plus",
      "Unlimited invoices, clients, jobs",
      "Job costing with Est. Profit",
      "Accountant export bundle",
      "Priority support",
    ],
  },
];
