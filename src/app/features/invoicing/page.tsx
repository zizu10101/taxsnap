import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { FeatureDetail } from "@/components/landing/feature-detail";

export const metadata: Metadata = {
  title: "Invoicing & Estimates — TaxSnap",
};

export default function InvoicingPage() {
  return (
    <FeatureDetail
      icon={FileText}
      title="Invoicing & Estimates"
      tagline="Build a professional estimate, convert it to an invoice once approved, and record payments as they come in — cash, card, e-transfer, whatever the client used."
      note="Available on the Pro plan."
      mobileSrc="/screenshots/invoice-mobile-framed.webp"
      desktopSrc="/screenshots/invoice-desktop.webp"
      screenshotAlt="A paid invoice in TaxSnap, showing itemized line items and HST calculated automatically"
      paragraphs={[
        "Create a professional, itemized estimate in a few taps — pick a client, add line items, and TaxSnap calculates HST and totals for you. Once your client approves, convert it into an invoice with one click, no retyping anything.",
        "Log payments as they come in — a deposit, a partial payment, or paid in full — in whatever form the client actually used. Invoice status (draft, sent, partially paid, paid) updates automatically based on what's been recorded, and every invoice's PDF carries your business logo and details.",
        "Share a PDF straight from your phone's share sheet (WhatsApp, Messages, email, and more) on mobile, or email or download it directly on desktop — whichever works for how you run your business.",
      ]}
    />
  );
}
