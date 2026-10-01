import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, CheckCircle2, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LandingHeader } from "@/components/landing/landing-header";
import { FeatureScreenshotToggle } from "@/components/landing/feature-screenshot-toggle";
import { InstallPromptCards } from "@/components/install-prompt-cards";

export interface FeatureHowItWorksStep {
  title: string;
  description: string;
}

export interface FeatureDetailProps {
  icon: LucideIcon;
  /** Small uppercase label above the H1, e.g. "EXPENSE TRACKING" - omit if not needed. */
  eyebrow?: string;
  title: string;
  tagline: string;
  /** Short note shown under the tagline, e.g. plan availability - omit if not needed. */
  note?: string;
  /** Numbered "How it works" steps, shown right under the screenshot - omit if not needed. */
  howItWorks?: FeatureHowItWorksStep[];
  paragraphs: string[];
  /** Omit when no real screenshot exists yet - renders a placeholder instead. */
  mobileSrc?: string;
  /** Omit when no real screenshot exists yet - renders a placeholder instead. */
  desktopSrc?: string;
  /** Required whenever the screenshot block is shown. */
  screenshotAlt?: string;
  /**
   * Skip the screenshot section entirely (no placeholder) - for a page whose
   * real screenshots aren't ready yet. Flip it off and pass the src props
   * once they exist.
   */
  hideScreenshot?: boolean;
}

// Shared shell for every /features/<slug> detail page - same header/CTA/
// footer as the /features index, plus a single-screen Mobile/Desktop
// toggle (FeatureScreenshotToggle, wrapping the same PhoneMockup/
// BrowserMockup the homepage's ScreenShowcase carousel uses) sized the
// same height-driven way so it never overflows its box, just without the
// carousel/wheel-scroll machinery since there's only one screen here, not
// six. Stays a Server Component (unlike the toggle) so it can take a
// plain Lucide icon component as a prop.
export function FeatureDetail({
  icon: Icon,
  eyebrow,
  title,
  tagline,
  note,
  howItWorks,
  paragraphs,
  mobileSrc,
  desktopSrc,
  screenshotAlt = "",
  hideScreenshot = false,
}: FeatureDetailProps) {
  return (
    <main className="flex flex-1 flex-col bg-background">
      <LandingHeader />

      <section className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8 lg:py-16">
        <Link
          href="/features"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          All features
        </Link>
        {eyebrow && (
          <p className="mt-6 text-xs font-semibold tracking-wide text-primary uppercase">
            {eyebrow}
          </p>
        )}
        <div className={`flex items-center gap-3 ${eyebrow ? "mt-2" : "mt-6"}`}>
          <Icon className="h-8 w-8 shrink-0 text-primary" />
          <h1 className="font-heading text-4xl leading-[0.95] font-extrabold tracking-tight sm:text-5xl">
            {title}
          </h1>
        </div>
        <p className="mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
          {tagline}
        </p>
        {note && (
          <p className="mt-2 text-sm font-medium text-primary">{note}</p>
        )}
      </section>

      {!hideScreenshot && (
        <section className="border-t border-border">
          <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-8">
            <FeatureScreenshotToggle
              mobileSrc={mobileSrc}
              desktopSrc={desktopSrc}
              alt={screenshotAlt}
              placeholderIcon={<Icon className="h-8 w-8 text-muted-foreground/60" />}
            />
          </div>
        </section>
      )}

      {howItWorks && howItWorks.length > 0 && (
        <section className="border-t border-border">
          <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-8">
            <h2 className="font-heading text-2xl font-bold">How it works</h2>
            <ol className="mt-6 space-y-5">
              {howItWorks.map((step, i) => (
                <li key={step.title} className="flex gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                    {i + 1}
                  </span>
                  <div>
                    <p className="font-heading font-bold">{step.title}</p>
                    <p className="text-sm text-muted-foreground">{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      <section className="border-t border-border">
        <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-10 sm:px-8">
          {paragraphs.map((paragraph) => (
            <p key={paragraph} className="leading-relaxed text-muted-foreground">
              {paragraph}
            </p>
          ))}
          <Link
            href="/#faq"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <HelpCircle className="h-4 w-4" />
            Have more questions? See our FAQ
          </Link>
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
