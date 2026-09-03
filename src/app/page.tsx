import Link from "next/link";
import { ArrowRight, Camera, FileSpreadsheet, Scissors, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InstallPromptCards } from "@/components/install-prompt-cards";
import { PricingSection } from "@/components/landing/pricing-section";

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

export default function Home() {
  return (
    <main className="flex flex-1 flex-col bg-background">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2 font-heading text-lg font-bold tracking-tight"
        >
          <img src="/logo-mark.png" alt="" className="h-7 w-7" />
          TaxSnap
        </Link>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/auth" />}
          >
            Sign in
          </Button>
          <Button size="sm" nativeButton={false} render={<Link href="/auth" />}>
            Get Started
          </Button>
        </div>
      </header>

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
            TaxSnap is built for painters, handymen, barbers, and every other
            self-employed trade contractor who&apos;d rather be working than
            doing bookkeeping.
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

      {/* Same bordered-card style as the pricing cards below, but a single
          full-card link rather than a Button - still understated enough
          not to compete with the real CTAs (Get started free / See
          pricing / each plan's Get started), just more visible than a
          plain text line. Sits right under the hero so a salon owner
          self-identifies before reading feature copy that's aimed at
          trade contractors. */}
      <section className="border-t border-border">
        <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8">
          <Link
            href="/salons"
            className="group flex items-center gap-4 rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary"
          >
            <Scissors className="h-8 w-8 shrink-0 text-primary" />
            <div className="flex-1">
              <h3 className="font-heading text-lg font-bold">
                Run a salon or barbershop?
              </h3>
              <p className="text-sm text-muted-foreground">
                Commission tracking and stylist payouts, built for the
                front counter.
              </p>
            </div>
            <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" />
          </Link>
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

      <PricingSection
        highlightTier="basic"
        tierTaglines={{
          pro: "See true profit per job — materials + labor, automatically.",
        }}
      />

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
