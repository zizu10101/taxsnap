import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Briefcase,
  CheckCircle2,
  FileArchive,
  FileText,
  Landmark,
  Receipt,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { InstallPromptCards } from "@/components/install-prompt-cards";
import { LandingHeader } from "@/components/landing/landing-header";

export const metadata: Metadata = {
  title: "TaxSnap Features — Expenses, Invoicing, Job Costing & HST",
};

// Same shell/conventions as the general homepage (src/app/page.tsx) - a
// standalone overview of every capability, for a visitor who lands here
// directly (nav link, shared link, search) rather than scrolling the
// homepage's own shorter feature highlights.
const FEATURES = [
  {
    icon: Receipt,
    title: "Automated Expense Tracking",
    description:
      "Snap a photo of any receipt or vendor invoice. TaxSnap reads it, categorizes it, and keeps a digital copy on file — no manual entry, no lost paper.",
    href: "/features/expense-tracking",
  },
  {
    icon: FileText,
    title: "Invoicing & Estimates",
    description:
      "Build a professional estimate, convert it to an invoice once approved, and record payments as they come in — cash, card, e-transfer, whatever the client used.",
    href: "/features/invoicing",
  },
  {
    icon: Briefcase,
    title: "Job Costing",
    description:
      "Track profitability per job. Log materials, assign labor hours, link the invoice — see your real margin on every project, not just a guess.",
    href: "/features/job-costing",
  },
  {
    icon: Landmark,
    title: "HST-Ready, Automatically",
    description:
      "Every receipt and invoice maps to the right CRA line items, so your HST return estimate is always current. No spreadsheets, no manual math — though we always recommend a licensed accountant for final filing.",
    href: "/features/hst-mapping",
  },
  {
    icon: FileArchive,
    title: "One-Click Accountant Export",
    description:
      "Bundle receipts, invoices, and a period summary into one download — everything your accountant needs, ready to go.",
    href: "/features/accountant-export",
  },
];

export default function FeaturesPage() {
  return (
    <main className="flex flex-1 flex-col bg-background">
      <LandingHeader />

      <section className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8 lg:py-16">
        <h1 className="max-w-2xl font-heading text-4xl leading-[0.95] font-extrabold tracking-tight sm:text-5xl">
          What TaxSnap <span className="text-primary">Does</span>
        </h1>
        <p className="mt-6 max-w-2xl text-base text-muted-foreground sm:text-lg">
          TaxSnap is built for contractors, tradespeople, and small business
          owners who&apos;d rather be working than doing bookkeeping. It
          handles the paperwork automatically — from a snapped receipt to a
          tax-ready return estimate.
        </p>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-8">
          <div className="grid gap-4 sm:grid-cols-2">
            {FEATURES.map((feature) => (
              <Link
                key={feature.title}
                href={feature.href}
                className="group flex flex-col gap-3 rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary"
              >
                <feature.icon className="h-5 w-5 text-primary" />
                <h2 className="font-heading text-lg font-bold">
                  {feature.title}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {feature.description}
                </p>
                <span className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary">
                  Learn more
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-4 px-4 py-12 text-center sm:px-8">
          <CheckCircle2 className="h-8 w-8 text-primary" />
          <h2 className="font-heading text-2xl font-bold">
            Ready to leave the paperwork behind?
          </h2>
          <div className="flex flex-wrap justify-center gap-3">
            <Button size="lg" nativeButton={false} render={<Link href="/auth" />}>
              Get started free
            </Button>
            <Button
              size="lg"
              variant="outline"
              nativeButton={false}
              render={<Link href="/#pricing" />}
            >
              See pricing
            </Button>
          </div>
        </div>
      </section>

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
