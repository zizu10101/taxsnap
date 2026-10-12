import Link from "next/link";
import fs from "node:fs";
import path from "node:path";
import {
  BarChart3,
  Briefcase,
  Camera,
  Clock,
  FileSignature,
  FileSpreadsheet,
  HandCoins,
  Images,
  Layers,
  Receipt,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FinalCta } from "@/components/landing/final-cta";
import { FooterFaqLink } from "@/components/landing/footer-faq-link";
import { LandingHeader } from "@/components/landing/landing-header";
import { PricingSection, type ComparisonRow } from "@/components/landing/pricing-section";
import { FaqSection } from "@/components/landing/faq-section";
import { HOME_FAQ_ITEMS } from "@/lib/faq-items";
import { PLAN_LIMITS, formatPlanCap } from "@/lib/plan-limits";
import { ScreenShowcase, type ShowcaseTab } from "@/components/landing/screen-showcase";

// Phone screens live in public/screens/<id>.png. Until those exist, a tab
// falls back to a matching old screenshot (`fallback`); the png wins as soon as
// it is added. A tab with neither is dropped (checked on the server) so the
// section never shows a broken image. Drop the `fallback` lines once all five
// pngs are in.
const SHOWCASE_TABS: ShowcaseTab[] = ([
  {
    id: "receipts",
    label: "Receipts",
    title: "Snap it, done",
    description: "Every scanned receipt in one place, with merchant, tax and write-off category filled in.",
    src: "/screens/receipts.png",
    fallback: "/screenshots/expenses-mobile.webp",
  },
  {
    id: "jobs",
    label: "Jobs",
    title: "Know every job's real profit",
    description: "Materials, labor and payments received, netted out for each job.",
    src: "/screens/jobs.png",
    fallback: "/screenshots/jobs-mobile.webp",
  },
  {
    id: "invoices",
    label: "Invoices",
    title: "Bill clients from your phone",
    description: "Send invoices and estimates, record deposits, and see what's still owed.",
    src: "/screens/invoices.png",
    fallback: "/screenshots/invoices-mobile.webp",
  },
  {
    id: "photos",
    label: "Photos",
    title: "Site photos on every job",
    description: "Snap before and after photos and keep them with the job. Private to you.",
    src: "/screens/photos.png",
  },
  {
    id: "reports",
    label: "Reports",
    title: "Your numbers, any time",
    description: "Revenue, expenses and your HST position for any date range.",
    src: "/screens/reports.png",
  },
] as (ShowcaseTab & { fallback?: string })[])
  .map(({ fallback, ...tab }) => {
    const exists = (src: string) => fs.existsSync(path.join(process.cwd(), "public", src));
    const src = exists(tab.src) ? tab.src : fallback && exists(fallback) ? fallback : null;
    return src ? { ...tab, src } : null;
  })
  .filter((tab): tab is ShowcaseTab => tab !== null);

// Behind the homepage pricing section's "See all features" toggle - a flat
// list (not QuickBooks' collapsible categories), matching this app's much
// smaller feature surface. Every tier gets every feature under the
// capped-forever-freemium model (see src/lib/plan-limits.ts), so this is
// no longer a has-it/doesn't-have-it matrix - a capped resource is one row
// showing all three tiers' actual numbers (e.g. "3/mo, 10/mo, Unlimited")
// via ComparisonCell's string variant, pulled from PLAN_LIMITS so these
// can't drift from what the API enforces (same source pricing-plans.ts
// reads from). A feature with no numeric cap (it either exists or it
// doesn't, at every tier alike, or - priority support - is a real Pro-only
// perk) stays a plain boolean row.
const COMPARISON_ROWS: ComparisonRow[] = [
  { feature: "Receipt scanning & AI categorization", free: true, basic: true, pro: true },
  {
    feature: "Receipt scans",
    free: formatPlanCap(PLAN_LIMITS.free.scansPerMonth, "/mo"),
    basic: formatPlanCap(PLAN_LIMITS.basic.scansPerMonth, "/mo"),
    pro: formatPlanCap(PLAN_LIMITS.pro.scansPerMonth, "/mo"),
  },
  { feature: "Ontario HST return estimate", free: true, basic: true, pro: true },
  { feature: "Maps to CRA Lines 101, 103 & 106", free: true, basic: true, pro: true },
  { feature: "CSV export for tax season", free: true, basic: true, pro: true },
  { feature: "Client invoicing", free: true, basic: true, pro: true },
  {
    feature: "Invoices",
    free: formatPlanCap(PLAN_LIMITS.free.invoicesPerMonth, "/mo"),
    basic: formatPlanCap(PLAN_LIMITS.basic.invoicesPerMonth, "/mo"),
    pro: formatPlanCap(PLAN_LIMITS.pro.invoicesPerMonth, "/mo"),
  },
  {
    feature: "Estimates",
    free: formatPlanCap(null),
    basic: formatPlanCap(null),
    pro: formatPlanCap(null),
  },
  {
    feature: "Clients",
    free: formatPlanCap(PLAN_LIMITS.free.clients),
    basic: formatPlanCap(PLAN_LIMITS.basic.clients),
    pro: formatPlanCap(PLAN_LIMITS.pro.clients),
  },
  {
    feature: "Jobs",
    free: formatPlanCap(PLAN_LIMITS.free.jobs),
    basic: formatPlanCap(PLAN_LIMITS.basic.jobs),
    pro: formatPlanCap(PLAN_LIMITS.pro.jobs),
  },
  {
    feature: "Employees",
    free: formatPlanCap(PLAN_LIMITS.free.employees),
    basic: formatPlanCap(PLAN_LIMITS.basic.employees),
    pro: formatPlanCap(PLAN_LIMITS.pro.employees),
  },
  {
    feature: "Active services (salon)",
    free: formatPlanCap(PLAN_LIMITS.free.activeServices),
    basic: formatPlanCap(PLAN_LIMITS.basic.activeServices),
    pro: formatPlanCap(PLAN_LIMITS.pro.activeServices),
  },
  {
    feature: "Active stylists (salon)",
    free: formatPlanCap(PLAN_LIMITS.free.activeStylists),
    basic: formatPlanCap(PLAN_LIMITS.basic.activeStylists),
    pro: formatPlanCap(PLAN_LIMITS.pro.activeStylists),
  },
  { feature: "Deposits & partial payments", free: true, basic: true, pro: true },
  { feature: "Send via email, WhatsApp, or SMS", free: true, basic: true, pro: true },
  { feature: "Job costing (materials + labor)", free: true, basic: true, pro: true },
  { feature: "Job profitability (Est. Profit)", free: true, basic: true, pro: true },
  { feature: "Priority support", free: false, basic: false, pro: true },
];

const STEPS = [
  {
    icon: Camera,
    title: "Snap it",
    description: "Point your phone at any receipt. That's the whole job.",
  },
  {
    icon: Sparkles,
    title: "AI reads it",
    description: "Merchant, total, tax, and write-off category, filled in.",
  },
  {
    icon: FileSpreadsheet,
    title: "Ready for your HST return",
    description: "See exactly what you owe — no spreadsheets, no guessing.",
  },
];

// Boxed feature row under the step columns - the same card treatment as
// /salons' "Built for the front counter" grid, for general-business
// strengths the three steps above don't cover (steps explain the
// receipt-to-HST flow; these are the rest of the product).
const GENERAL_FEATURES: {
  icon: LucideIcon;
  title: string;
  description: string;
  href?: string;
}[] = [
  {
    icon: Receipt,
    title: "Job & overhead expenses",
    description:
      "Tag costs to a job or file them as overhead, then export a QuickBooks-ready CSV.",
    href: "/features/expense-tracking",
  },
  {
    icon: TrendingUp,
    title: "Real profit per job",
    description:
      "Materials, labor, and the payments you've actually received, netted out for every job.",
    href: "/features/job-costing",
  },
  {
    icon: Images,
    title: "Site photos on every job",
    description:
      "Snap before and after photos on the job. Everything stays private to you, organized by job.",
  },
  {
    icon: Layers,
    title: "Progress billing",
    description:
      "Bill a job in draws and see what's invoiced, received, and still owed against the contract.",
    href: "/features/progress-billing",
  },
  {
    icon: HandCoins,
    title: "Deposits & partial payments",
    description:
      "Record deposits and partial payments as they arrive. TaxSnap counts them for HST in the period you actually got paid.",
    href: "/features/invoicing",
  },
  {
    icon: FileSignature,
    title: "E-signatures on estimates",
    description:
      "Clients approve estimates by signing online, and the estimate turns into an invoice the moment they do.",
    href: "/features/invoicing",
  },
  {
    icon: BarChart3,
    title: "Reports",
    description:
      "Revenue by client, expenses by category or vendor, and your HST position. Export when tax time comes.",
  },
  {
    icon: Clock,
    title: "Employee clock-in",
    description:
      "Your crew clocks in and out from their own phone with a personal PIN. No accounts to set up and nothing for you to type in, and the hours land on the right job.",
    href: "/features/employee-clock-in",
  },
  {
    icon: Briefcase,
    title: "Jobs with client, location and notes",
    description:
      "Pick a client once and it follows the job. Keep private notes that never reach the client.",
    href: "/features/job-costing",
  },
];


export default function Home() {
  return (
    <main className="flex flex-1 flex-col bg-background">
      <LandingHeader />

      <section className="mx-auto grid w-full max-w-5xl flex-1 items-center gap-10 px-4 py-8 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:py-16">
        <div className="flex flex-col items-start gap-6">
          <h1 className="font-heading text-5xl leading-[0.95] font-extrabold tracking-tight sm:text-6xl">
            Snap it.
            <br />
            Sort it.
            <br />
            <span className="text-primary">Write it off.</span>
          </h1>
          <p className="max-w-md text-base text-muted-foreground sm:text-lg">
            Built for contractors, salons and the self-employed who&apos;d
            rather be working than doing bookkeeping.
          </p>
          <p className="max-w-md text-sm font-medium text-foreground">
            No accounting degree required. Snap a receipt, send an invoice, see
            what you owe.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button size="lg" nativeButton={false} render={<Link href="/auth" />}>
              Get started free
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
          <p className="text-xs text-muted-foreground">
            No credit card required &middot; tracks Ontario HST from your first receipt
          </p>
        </div>

        {/* Signature element: a mocked-up receipt, the actual unit of work
            this product is built around, rather than a generic icon. */}
        <div className="flex flex-col items-center gap-2 lg:items-end">
          <div
            className="w-full max-w-[300px] -rotate-2 rounded-sm border border-border bg-card p-5 font-mono text-[13px] shadow-xl"
            style={{
              borderTop: "3px dashed color-mix(in oklch, var(--border), var(--foreground) 15%)",
            }}
          >
            <p className="font-heading text-base font-bold tracking-tight">
              HARBOR HARDWARE &amp; SUPPLY
            </p>
            <p className="mt-0.5 text-muted-foreground">Aug 20 &middot; Mississauga, ON</p>
            <div className="mt-3 space-y-1 text-muted-foreground">
              <p>Interior latex paint&nbsp;&nbsp;&nbsp;&nbsp;38.99</p>
              <p>Paint brush set&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;12.50</p>
              <p>Drop cloth 9x12&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;9.99</p>
            </div>
            <div className="my-3 border-t border-dashed border-border" />
            <div className="flex items-center justify-between text-muted-foreground">
              <span>HST (13%)</span>
              <span>$7.99</span>
            </div>
            <div className="mt-1 flex items-center justify-between font-semibold">
              <span>TOTAL</span>
              <span>$69.47</span>
            </div>
            <Badge className="mt-3 border-transparent bg-success text-success-foreground">
              ✓ Job Materials
            </Badge>
          </div>
          <p className="max-w-[300px] text-center text-xs text-muted-foreground">
            Built by a small business owner, for small business owners.
          </p>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto w-full max-w-5xl divide-y divide-border px-4 sm:divide-y-0 sm:px-8">
          <div className="grid gap-8 py-10 sm:grid-cols-3 sm:gap-6">
            {STEPS.map((step, i) => (
              <div key={step.title} className="flex gap-4">
                <span className="font-mono text-sm text-muted-foreground">
                  0{i + 1}
                </span>
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <step.icon className="h-4 w-4 text-primary" />
                    <h2 className="font-heading text-lg font-bold">
                      {step.title}
                    </h2>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-8">
          <h2 className="font-heading text-2xl font-bold">
            Everything a one-person business needs, nothing it doesn&apos;t.
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {GENERAL_FEATURES.map((feature) => {
              const body = (
                <>
                  <feature.icon className="h-5 w-5 text-primary" />
                  <h3 className="font-heading text-lg font-bold">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {feature.description}
                  </p>
                </>
              );
              const cardClass =
                "flex flex-col gap-3 rounded-lg border border-border bg-card p-5";
              return feature.href ? (
                <Link
                  key={feature.title}
                  href={feature.href}
                  className={`${cardClass} transition-colors hover:border-primary`}
                >
                  {body}
                </Link>
              ) : (
                <div key={feature.title} className={cardClass}>
                  {body}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <ScreenShowcase tabs={SHOWCASE_TABS} />

      <PricingSection
        highlightTier="basic"
        tierTaglines={{
          pro: "See true profit per job — materials + labor, automatically.",
        }}
        comparisonRows={COMPARISON_ROWS}
      />

      <FaqSection items={HOME_FAQ_ITEMS} seeAllHref="/faq" />

      <FinalCta />

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
          <FooterFaqLink />
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
