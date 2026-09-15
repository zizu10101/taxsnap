import type { BillingTier } from "@/lib/stripe";
import { PLAN_LIMITS } from "@/lib/plan-limits";

export const FREE_SCAN_LIMIT = PLAN_LIMITS.free.scansPerMonth!;

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
  price: string;
  description: string;
  features: string[];
}[] = [
  {
    tier: "basic",
    name: "Basic",
    price: "$12 CAD/mo",
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
    price: "$29 CAD/mo",
    description: "No limits — full invoicing, job costing, and accountant tools.",
    features: [
      "Everything in Basic",
      "Unlimited invoices, clients, jobs",
      "Job costing with Est. Profit",
      "Accountant export bundle",
      "Priority support",
    ],
  },
];
