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
  description: "Test the scanner.",
  features: [
    `${PLAN_LIMITS.free.scansPerMonth} receipt scans/mo (no credit card required)`,
    "AI categorization + Ontario HST estimate",
    `${PLAN_LIMITS.free.invoicesPerMonth} invoices/mo + unlimited estimates`,
    `${PLAN_LIMITS.free.clients} clients`,
    `${PLAN_LIMITS.free.jobs} job + ${PLAN_LIMITS.free.employees} employee for job costing`,
    `${PLAN_LIMITS.free.activeServices} active service + ${PLAN_LIMITS.free.activeStylists} active stylist (salons)`,
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
    description: "More room to grow.",
    features: [
      "Unlimited receipt scans",
      "AI auto-categorization",
      "Maps to CRA Lines 101, 103 & 106",
      "CSV export for tax season",
      `${PLAN_LIMITS.basic.invoicesPerMonth} invoices/mo + unlimited estimates`,
      `${PLAN_LIMITS.basic.clients} clients`,
      `${PLAN_LIMITS.basic.jobs} jobs + ${PLAN_LIMITS.basic.employees} employees for job costing`,
      `${PLAN_LIMITS.basic.activeServices} active services + ${PLAN_LIMITS.basic.activeStylists} active stylists (salons)`,
    ],
  },
  {
    tier: "pro",
    name: "Pro",
    price: "$29 CAD/mo",
    description: "No limits, ever.",
    features: [
      "Everything in Basic",
      "Unlimited invoices, clients, jobs & employees",
      "Unlimited active services & stylists",
      "Deposits & partial payments",
      "Send via email, WhatsApp, or SMS",
      "Invoice status & payment tracking",
      "Priority support",
    ],
  },
];
