import Link from "next/link";
import {
  Camera,
  Clock,
  FileSignature,
  FileSpreadsheet,
  HandCoins,
  Layers,
  Receipt,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InstallPromptCards } from "@/components/install-prompt-cards";
import { LandingHeader } from "@/components/landing/landing-header";
import { PricingSection, type ComparisonRow } from "@/components/landing/pricing-section";
import { FaqSection, type FaqItem } from "@/components/landing/faq-section";
import { PLAN_LIMITS, formatPlanCap } from "@/lib/plan-limits";
import { BILLING_CHANGE_POLICY } from "@/lib/pricing-plans";
import { ScreenShowcase, type ShowcaseGroup } from "@/components/landing/screen-showcase";

// Mobile and desktop screens are the user's own phone/laptop captures
// (public/screenshots/<slug>-mobile.webp and <slug>-desktop.webp).
const SHOWCASE_GROUPS: ShowcaseGroup[] = [
  {
    label: "Track everything automatically",
    screens: [
      {
        title: "Dashboard",
        description: "Scan a receipt, start an invoice, and see your estimated reclaimable HST and deductible spend at a glance.",
        mobileSrc: "/screenshots/dashboard-mobile.webp",
        desktopSrc: "/screenshots/dashboard-desktop.webp",
      },
      {
        title: "Expenses",
        description: "Every scanned receipt in one place, filtered by date range and job, with one-tap exports for your accountant.",
        mobileSrc: "/screenshots/expenses-mobile.webp",
        desktopSrc: "/screenshots/expenses-desktop.webp",
      },
      {
        title: "HST Summary Helper",
        description: "A running estimate of what you owe, mapped straight to the real CRA line numbers.",
        mobileSrc: "/screenshots/hst-mobile.webp",
        desktopSrc: "/screenshots/hst-desktop.webp",
      },
    ],
  },
  {
    label: "Run your whole business",
    screens: [
      {
        title: "Invoices",
        description: "See what you've billed and collected, and bill your clients directly from TaxSnap.",
        mobileSrc: "/screenshots/invoices-mobile.webp",
        desktopSrc: "/screenshots/invoices-desktop.webp",
      },
      {
        title: "New Invoice",
        description: "Pick a client and job, add line items, and switch between an estimate and an invoice in one form.",
        mobileSrc: "/screenshots/new-invoice-mobile.webp",
        desktopSrc: "/screenshots/new-invoice-desktop.webp",
      },
      {
        title: "Progress Billing",
        description: "Track draws against a job's contract value - invoiced to date, received, and what's still owed.",
        mobileSrc: "/screenshots/progress-billing-mobile.webp",
        desktopSrc: "/screenshots/progress-billing-desktop.webp",
      },
    ],
  },
];

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
const GENERAL_FEATURES = [
  {
    icon: Receipt,
    title: "Job & overhead expenses",
    description:
      "Tag costs to a job or file them as overhead, then export a QuickBooks-ready CSV or a full accountant bundle.",
  },
  {
    icon: TrendingUp,
    title: "Real profit per job",
    description:
      "Materials, labor, and the payments you've actually received, netted out for every job.",
  },
  {
    icon: Clock,
    title: "Employee clock-in",
    description:
      "Your crew clocks in and out from their own phone with a personal PIN. No accounts to set up and nothing for you to type in, and the hours land on the right job.",
  },
  {
    icon: Layers,
    title: "Progress billing",
    description:
      "Bill a job in draws and see what's invoiced, received, and still owed against the contract.",
  },
  {
    icon: HandCoins,
    title: "Deposits & partial payments",
    description:
      "Record deposits and partial payments as they arrive. TaxSnap counts them for HST in the period you actually got paid.",
  },
  {
    icon: FileSignature,
    title: "E-signatures on estimates",
    description:
      "Clients approve estimates by signing online, and the estimate turns into an invoice the moment they do.",
  },
];

// General-business question set - Jobs applies here (hidden entirely for
// salon accounts elsewhere in the app) and invoicing covers both Invoices
// and Estimates (also general-only). A salon FAQ would swap Jobs for
// Commission and drop Estimates from the invoicing answer - not built yet,
// scoped to this page only for now.
const FAQ_ITEMS: FaqItem[] = [
  {
    question: "How does the AI scanning work?",
    answer:
      "Snap or upload a photo of a receipt and TaxSnap's AI reads it automatically - merchant, date, total, tax, and a suggested write-off category are filled in for you to review before saving. No manual data entry.",
  },
  {
    question: "What happens after my free scans run out?",
    answer:
      "The Free plan includes 5 receipt scans per month at no cost. Once you hit that limit, upgrade to Plus for unlimited scans - or just wait, since the limit resets automatically at the start of each month either way.",
  },
  {
    question: "Can I use this on my computer, or only my phone?",
    answer:
      "Both. TaxSnap is a full web app that works in any browser on your computer, and it's also an installable app (PWA) you can add to your phone's home screen for a native-app-like experience - no app store required either way.",
  },
  {
    question: "Do I need to install any software?",
    answer:
      "No - TaxSnap is a Progressive Web App, so it works directly in any browser with nothing to download. If you'd like quicker access, you can optionally install it to your phone or computer's home screen, just like a native app - but it's never required.",
  },
  {
    question: "How does billing and cancellation work?",
    answer:
      `Plans are billed monthly or annually (2 months free) - your choice. Once you're subscribed, use Manage Subscription from Settings or Billing to switch plans or billing interval anytime, no need to contact support. ${BILLING_CHANGE_POLICY}`,
  },
  {
    question: "What does “HST mapping” mean?",
    answer:
      "TaxSnap automatically maps your income and expenses to the actual CRA line numbers on the Ontario GST/HST return (Lines 101, 103, and 106), so you get a running estimate of what you owe. It's a planning tool, not a filing service - always confirm final numbers with a bookkeeper or accountant.",
  },
  {
    question: "How do invoices and estimates work?",
    answer:
      `Create a professional invoice or estimate in a few taps - pick a client, add line items, and TaxSnap calculates HST and totals automatically. Estimates convert into invoices with one click once a client approves. Invoicing is included on every plan - Free covers ${PLAN_LIMITS.free.invoicesPerMonth} invoices a month, Plus ${PLAN_LIMITS.basic.invoicesPerMonth}, and Pro is unlimited. Estimates themselves are always unlimited, no matter your plan.`,
  },
  {
    question: "Can I share an estimate or invoice with a client?",
    answer:
      "Yes - share a PDF straight from your phone's share sheet (WhatsApp, Messages, email, and more) on mobile, or email or download it directly on desktop.",
  },
  {
    question: "Can I add my business logo?",
    answer:
      "Yes. Upload it once in Settings and it appears automatically on every invoice, estimate, and PDF report you generate.",
  },
  {
    question: "What are Jobs?",
    answer:
      `Jobs let you tag receipts to a specific project and track employee hours against it, so you can see the true cost of any job - materials plus labor - kept separate from your regular tax tracking. Every plan includes Jobs - Free covers ${PLAN_LIMITS.free.jobs} job and ${PLAN_LIMITS.free.employees} employee, Plus ${PLAN_LIMITS.basic.jobs} jobs and ${PLAN_LIMITS.basic.employees} employees, and Pro is unlimited.`,
  },
  {
    question: "Are there reports for sales and expenses?",
    answer:
      "Yes - your dashboard shows running totals for expenses, deductible spend, and estimated tax savings, plus the Ontario HST Return Helper for a real-time view of what you owe. Pro accounts also get an Overview page with trend charts over time.",
  },
  {
    question: "Can I export my reports, and how?",
    answer:
      "Yes. Export a plain CSV of your receipts anytime, or download a full accountant-ready package - CSV, receipt images, and invoice PDFs together - in one tap.",
  },
  {
    question: "Can I share reports with my accountant?",
    answer:
      "Yes - the accountant export bundle is built exactly for that: hand your accountant a single file with everything they need for tax season, no back-and-forth required.",
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
            TaxSnap is built for painters, handymen, barbers, owner-operator
            truck drivers, freelancers, and every other self-employed business
            owner who&apos;d rather be working than doing bookkeeping.
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
            {GENERAL_FEATURES.map((feature) => (
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

      <ScreenShowcase groups={SHOWCASE_GROUPS} />

      <PricingSection
        highlightTier="basic"
        tierTaglines={{
          pro: "See true profit per job — materials + labor, automatically.",
        }}
        comparisonRows={COMPARISON_ROWS}
      />

      <FaqSection items={FAQ_ITEMS} />

      <InstallPromptCards />

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
