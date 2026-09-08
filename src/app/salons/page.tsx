import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, History, ShieldCheck, Users, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InstallPromptCards } from "@/components/install-prompt-cards";
import { LandingHeader } from "@/components/landing/landing-header";
import { PricingSection, type ComparisonRow } from "@/components/landing/pricing-section";

export const metadata: Metadata = {
  title: "TaxSnap for Salons — Commission Tracking & Payouts",
};

const PAIN_POINTS = [
  "Still tracking commissions on paper or in your head?",
  "Paying stylists in cash with no record either of you can trust?",
  "Staff can't log a sale unless you're standing there?",
];

// Behind this page's "See all features" toggle - Free/Pro only, no Basic
// (this page's PricingSection call passes tiers={["pro"]}, so the Basic
// column never renders regardless of the `basic` value here; it's set to
// false throughout purely to satisfy ComparisonRow's shape).
const COMPARISON_ROWS: ComparisonRow[] = [
  { feature: "Commission logging (3-tap flow)", free: true, basic: false, pro: true },
  { feature: "Receipt scanning & HST return estimate", free: true, basic: false, pro: true },
  { feature: "5 free scans per month", free: true, basic: false, pro: false },
  { feature: "Unlimited receipt scans", free: false, basic: false, pro: true },
  { feature: "Unlimited services & stylists", free: false, basic: false, pro: true },
  { feature: "Stylist payouts with PIN confirmation", free: false, basic: false, pro: true },
  { feature: "Void, adjustments & full payout history", free: false, basic: false, pro: true },
  { feature: "PDF commission reports", free: false, basic: false, pro: true },
  { feature: "Payment method & tax tracking per sale", free: false, basic: false, pro: true },
  { feature: "Professional invoicing & payment tracking", free: false, basic: false, pro: true },
  { feature: "Priority support", free: false, basic: false, pro: true },
];

const FEATURES = [
  {
    icon: Zap,
    title: "3-tap logging",
    description: "Service, stylist, done. No fumbling at the counter.",
  },
  {
    icon: ShieldCheck,
    title: "Payouts your stylists can trust",
    description: "Every payout gets confirmed with a PIN, right on the spot.",
  },
  {
    icon: History,
    title: "Nothing gets lost",
    description: "Every edit is tracked. Every payout is on record.",
  },
  {
    icon: Users,
    title: "Staff can log too",
    description:
      "A separate staff mode lets your team log sales without full access to your books.",
  },
];

// Same shell/conventions as the general homepage (src/app/page.tsx) -
// this is the salon-specific entry point for the exact same signup flow,
// not a separate product. ?business=salon on every "Get Started" link
// here defaults business_type to salon wherever it's actually asked
// during signup (still changeable - see lib/auth-redirect.ts's
// PENDING_BUSINESS_TYPE_COOKIE for the Google-specific piece of that).
export default function SalonsLanding() {
  return (
    <main className="flex flex-1 flex-col bg-background">
      <LandingHeader getStartedHref="/auth?business=salon" />

      {/* Hero */}
      <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-start gap-6 px-4 py-8 sm:px-8 lg:py-16">
        <h1 className="max-w-2xl font-heading text-5xl leading-[0.95] font-extrabold tracking-tight sm:text-6xl">
          Commission tracking and payouts,{" "}
          <span className="text-primary">built for your shop.</span>
        </h1>
        <p className="max-w-md text-base text-muted-foreground sm:text-lg">
          Log every haircut in seconds. Pay your stylists with confirmation
          built in. No more paper logs, no more guessing.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            size="lg"
            nativeButton={false}
            render={<Link href="/auth?business=salon" />}
          >
            Get Started Free
          </Button>
          <Button
            size="lg"
            variant="outline"
            nativeButton={false}
            render={<Link href="#pricing" />}
          >
            See pricing
          </Button>
        </div>
      </section>

      {/* Pain points */}
      <section className="border-t border-border">
        <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-8">
          <ul className="grid gap-4 sm:grid-cols-3">
            {PAIN_POINTS.map((point) => (
              <li key={point} className="flex items-start gap-3">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <p className="text-sm font-medium text-foreground sm:text-base">
                  {point}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Feature highlights */}
      <section className="border-t border-border">
        <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-8">
          <h2 className="font-heading text-2xl font-bold">
            Built for the front counter, not the back office.
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5"
              >
                <feature.icon className="h-5 w-5 text-primary" />
                <h3 className="font-heading text-lg font-bold">
                  {feature.title}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <PricingSection
        tiers={["pro"]}
        highlightTier="pro"
        freeDescription="Try it before you commit."
        tierDescriptions={{
          pro: "Everything your shop needs.",
        }}
        freeTagline="1 service, 1 stylist, unlimited logging — see how commission tracking works in your shop."
        tierTaglines={{
          pro: "Unlimited stylists, full payout history, PDF reports, plus client invoicing.",
        }}
        freeFeatures={[
          "1 service, 1 stylist",
          "Full commission logging",
          "5 free receipt scans per month",
          "HST return estimate",
        ]}
        tierFeatures={{
          pro: [
            "Everything in Free",
            "Unlimited receipt scans & HST tracking",
            "Unlimited services & stylists",
            "Stylist payouts with PIN confirmation",
            "Void, adjustments & full payout history",
            "PDF commission reports",
            "Track payment method & tax per sale",
            "Professional invoicing & payment tracking",
            "Priority support",
          ],
        }}
        extraAuthParams={{ business: "salon" }}
        comparisonRows={COMPARISON_ROWS}
      />

      <InstallPromptCards />

      {/* Footer CTA */}
      <section className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-4 px-4 py-12 text-center sm:px-8">
          <CheckCircle2 className="h-8 w-8 text-primary" />
          <h2 className="font-heading text-2xl font-bold">
            Ready to leave the paper log behind?
          </h2>
          <Button
            size="lg"
            nativeButton={false}
            render={<Link href="/auth?business=salon" />}
          >
            Get Started Free
          </Button>
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        <div className="mx-auto max-w-4xl space-y-3 px-4">
          <p>
            Have questions? Reach us anytime at{" "}
            <a
              href="mailto:info@gettaxsnap.ca"
              className="font-medium text-foreground underline hover:text-primary"
            >
              info@gettaxsnap.ca
            </a>
          </p>
          <p className="mx-auto max-w-2xl text-[11px] leading-relaxed text-muted-foreground/80">
            TaxSnap is a division of Edge Digital Business Solutions.
            TaxSnap is an independent expense-tracking and bookkeeping
            tool, not affiliated with, endorsed by, or an official product
            of the CRA or any government tax authority. TaxSnap does not
            file or submit anything on your behalf, and does not provide
            professional tax or accounting advice — consult a licensed
            professional for guidance specific to your situation.
          </p>
          <p className="pt-2 text-muted-foreground/80">
            © {new Date().getFullYear()} TaxSnap. All rights reserved.
          </p>
        </div>
      </footer>
    </main>
  );
}
