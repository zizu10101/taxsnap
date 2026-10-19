import type { BillingInterval, BillingTier } from "@/lib/stripe";
import { PLAN_LIMITS } from "@/lib/plan-limits";

export const FREE_SCAN_LIMIT = PLAN_LIMITS.free.scansPerMonth!;

// "$29 CAD/mo" / "$290 CAD/yr" - shared so the toggle's two price displays
// (and /billing's) can never drift into different formatting.
export function formatCadPrice(amount: number, interval: BillingInterval): string {
  const suffix = interval === "monthly" ? "/mo" : "/yr";
  return `$${amount} CAD${suffix}`;
}

// Every price is HST-exclusive; Stripe Tax adds it at checkout. Shown next
// to each price so nobody is surprised by the total on the payment page.
export const PLUS_HST_NOTE = "plus HST";

// The per-month equivalent of a yearly price, e.g. 120 -> "$10.00/mo",
// 290 -> "$24.17/mo" - shown next to the annual price so "2 months free"
// has a concrete monthly number to compare against the monthly plan's own
// price, not just a badge.
export function formatPerMonthEquivalent(yearlyAmount: number): string {
  return `$${(yearlyAmount / 12).toFixed(2)}/mo`;
}

// Shared between the homepage FAQ, /billing, and Settings' CurrentPlanCard
// so this can't drift into three different descriptions of the same
// policy. With Pro as the only paid plan, the only change a subscriber can
// make is the billing interval (or cancelling). Verified against real
// Stripe Customer Portal sessions (not direct Subscriptions API calls,
// which always apply immediately regardless of the portal configuration):
// monthly -> annual is invoiced and charged immediately; annual -> monthly
// (`shortening_interval`) is deferred via a Subscription Schedule to the
// end of the current period, the same timing cancellation uses.
export const BILLING_CHANGE_POLICY =
  "Switching from monthly to annual billing takes effect immediately, with a prorated charge right away. Switching from annual to monthly, or cancelling, takes effect at the end of your current billing period - you keep your plan and access until then.";

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
  // hardcoded price string can't support. yearlyPrice is exactly
  // 10x monthlyPrice ("2 months free").
  monthlyPrice: number;
  yearlyPrice: number;
  description: string;
  features: string[];
}[] = [
  {
    tier: "pro",
    name: "Pro",
    monthlyPrice: 29,
    yearlyPrice: 290,
    description: "No limits — full invoicing, job costing, and accountant tools.",
    features: [
      "Everything in Free",
      "Unlimited receipt scans",
      "Unlimited invoices, clients, jobs",
      "Job costing with Est. Profit",
      "Accountant export bundle",
      "Reports: revenue, expenses by category or vendor, HST",
      "No \"Created with TaxSnap\" footer on your invoices",
      "Priority support",
    ],
  },
];
