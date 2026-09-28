import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { FeatureDetail } from "@/components/landing/feature-detail";

const DESCRIPTION =
  "Build a professional estimate, get it approved with a client e-signature, convert it to an invoice with one click, and log payments as they come in.";

export const metadata: Metadata = {
  title: "Invoicing & Estimates — TaxSnap",
  description: DESCRIPTION,
  openGraph: {
    title: "Invoicing & Estimates — TaxSnap",
    description: DESCRIPTION,
    type: "website",
  },
};

export default function InvoicingPage() {
  return (
    <FeatureDetail
      icon={FileText}
      eyebrow="Invoicing & Estimates"
      title="Invoicing & Estimates"
      tagline="Build a professional estimate, get it e-signed by your client, convert it to an invoice once approved, and record payments as they come in — cash, card, e-transfer, whatever the client used."
      note="Available on the Pro plan."
      mobileSrc="/screenshots/invoice-mobile-framed.webp"
      desktopSrc="/screenshots/invoice-desktop.webp"
      screenshotAlt="The invoice builder in TaxSnap, with a live preview that updates as client details and line items are filled in"
      howItWorks={[
        {
          title: "Build the estimate",
          description:
            "Pick a client, add line items, and TaxSnap calculates HST and totals for you.",
        },
        {
          title: "Send a signature link",
          description:
            "Email it directly, or copy the link and share it however you like — text, WhatsApp, whatever the client actually uses.",
        },
        {
          title: "Client types their name to approve",
          description:
            "No app or account needed on their end — they review the estimate, type their name, and confirm. It's timestamped the moment they sign.",
        },
        {
          title: "Convert to invoice and log payments",
          description:
            "One click turns the signed estimate into an invoice. Record deposits, partial payments, or paid-in-full as money comes in.",
        },
      ]}
      paragraphs={[
        "Create a professional, itemized estimate in a few taps — pick a client, add line items, and TaxSnap calculates HST and totals for you. Once your client approves, convert it into an invoice with one click, no retyping anything.",
        "When an estimate is ready for approval, send your client a signature link by email, or copy it to share however you like. They review the estimate and type their name to confirm — no app or account required on their side — and the estimate is timestamped the moment they sign.",
        "Log payments as they come in — a deposit, a partial payment, or paid in full — in whatever form the client actually used. Invoice status (draft, sent, partially paid, paid) updates automatically based on what's been recorded, and every invoice's PDF carries your business logo and details.",
        "Share a PDF straight from your phone's share sheet (WhatsApp, Messages, email, and more) on mobile, or email or download it directly on desktop — whichever works for how you run your business.",
      ]}
    />
  );
}
