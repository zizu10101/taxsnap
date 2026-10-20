import type { Metadata } from "next";
import { FaqSection } from "@/components/landing/faq-section";
import { FinalCta } from "@/components/landing/final-cta";
import { FooterFaqLink } from "@/components/landing/footer-faq-link";
import { FooterLegalLinks } from "@/components/landing/footer-legal-links";
import { LandingHeader } from "@/components/landing/landing-header";
import { SITE_FAQ_ITEMS } from "@/lib/faq-items";
import { withVideoLinks } from "@/lib/how-to-videos-server";

export const metadata: Metadata = {
  title: "TaxSnap FAQ — Receipts, Invoicing, Jobs & HST",
  description:
    "Answers about receipt scanning, invoices and estimates, jobs, site photos, reports and HST.",
};

const FAQ_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: SITE_FAQ_ITEMS.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: { "@type": "Answer", text: item.answer },
  })),
};

export default function FaqPage() {
  return (
    <main className="flex flex-1 flex-col bg-background">
      <LandingHeader />
      <script
        type="application/ld+json"
        // Escape "<" so an answer can never close the script tag.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(FAQ_JSON_LD).replace(/</g, "\\u003c"),
        }}
      />
      <FaqSection items={withVideoLinks(SITE_FAQ_ITEMS)} />
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
          <FooterLegalLinks />
          <p className="pt-2 text-muted-foreground/80">
            © {new Date().getFullYear()} TaxSnap. All rights reserved.
          </p>
        </div>
      </footer>
    </main>
  );
}
