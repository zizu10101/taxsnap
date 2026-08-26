import Link from "next/link";
import { Camera, Check, FileSpreadsheet, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InstallPromptCards } from "@/components/install-prompt-cards";
import { FREE_PLAN, PRICING_PLANS } from "@/lib/pricing-plans";

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
    description: "See exactly what goes on Lines 101, 103 & 109 - no guesswork.",
  },
];

export default function Home() {
  return (
    <main className="flex flex-1 flex-col bg-background">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5 sm:px-8">
        <span className="flex items-center gap-2 font-heading text-lg font-bold tracking-tight">
          <img src="/logo-mark.png" alt="" className="h-7 w-7" />
          TaxSnap
        </span>
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href="/auth" />}
        >
          Sign in
        </Button>
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
        <div className="flex justify-center lg:justify-end">
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

      <section id="pricing" className="border-t border-border">
        <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-8">
          <h2 className="font-heading text-2xl font-bold">Pricing</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Start free. Upgrade whenever you need more.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
              <h3 className="font-heading text-lg font-bold">{FREE_PLAN.name}</h3>
              <p className="text-sm text-muted-foreground">
                {FREE_PLAN.description}
              </p>
              <p className="text-3xl font-bold">{FREE_PLAN.price}</p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {FREE_PLAN.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button
                variant="outline"
                className="mt-auto"
                nativeButton={false}
                render={<Link href="/auth" />}
              >
                Get started free
              </Button>
            </div>
            {PRICING_PLANS.map((plan) => (
              <div
                key={plan.tier}
                className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5"
              >
                <h3 className="font-heading text-lg font-bold">{plan.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {plan.description}
                </p>
                <p className="text-3xl font-bold">{plan.price}</p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-auto"
                  nativeButton={false}
                  render={<Link href="/auth" />}
                >
                  Get started
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <InstallPromptCards />
    </main>
  );
}
