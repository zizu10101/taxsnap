import type { BillingTier } from "@/lib/stripe";

export const FREE_SCAN_LIMIT = 5;

export const FREE_PLAN = {
  name: "Free",
  price: "$0",
  description: "Test the scanner.",
  features: [
    `${FREE_SCAN_LIMIT} free receipt scans (no credit card required)`,
    "AI categorization",
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
    description: "Complete CRA expense tracking.",
    features: [
      "Unlimited receipt scans",
      "AI auto-categorization",
      "Maps to CRA Lines 101, 103 & 106",
      "CSV export for tax season",
    ],
  },
  {
    tier: "pro",
    name: "Pro",
    price: "$29 CAD/mo",
    description: "Expenses + client invoicing.",
    features: [
      "Everything in Basic",
      "Professional PDF client invoicing",
      "Deposits & partial payments",
      "Send via email, WhatsApp, or SMS",
      "Invoice status & payment tracking",
      "Priority support",
    ],
  },
];
