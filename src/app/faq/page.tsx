import type { Metadata } from "next";
import { FaqSection } from "@/components/landing/faq-section";
import { FinalCta } from "@/components/landing/final-cta";
import { FooterFaqLink } from "@/components/landing/footer-faq-link";
import { FooterLegalLinks } from "@/components/landing/footer-legal-links";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/support";
import { LandingHeader } from "@/components/landing/landing-header";
import { SITE_FAQ_ITEMS } from "@/lib/faq-items";
import { withVideoLinks } from "@/lib/how-to-videos-server";
import { pageMetadata, faqPageJsonLd } from "@/lib/seo";
import { JsonLd } from "@/components/seo/json-ld";

export const metadata: Metadata = pageMetadata({
  title: "TaxSnap FAQ — Receipts, Invoicing, Jobs & HST",
  description:
    "Answers about receipt scanning, invoices and estimates, jobs, site photos, reports and HST.",
  path: "/faq",
});

export default function FaqPage() {
  return (
    <main className="flex flex-1 flex-col bg-background">
      <LandingHeader />
      <JsonLd data={faqPageJsonLd(SITE_FAQ_ITEMS)} />
      <FaqSection items={withVideoLinks(SITE_FAQ_ITEMS)} />
      <FinalCta />
      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        <div className="mx-auto max-w-4xl space-y-3 px-4">
          <p>
            Have questions? Reach us anytime at{" "}
            <a
              href={supportMailto()}
              className="font-medium text-foreground underline hover:text-primary"
            >
              {SUPPORT_EMAIL}
            </a>
          </p>
          <FooterFaqLink />
          <FooterLegalLinks />
          <p className="pt-2 text-muted-foreground/80">
            © {new Date().getFullYear()} TaxSnap. All rights reserved.
          </p>
        </div>
      </footer>
    </main>
  );
}
