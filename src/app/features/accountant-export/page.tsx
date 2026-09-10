import type { Metadata } from "next";
import { FileArchive } from "lucide-react";
import { FeatureDetail } from "@/components/landing/feature-detail";

export const metadata: Metadata = {
  title: "One-Click Accountant Export — TaxSnap",
};

export default function AccountantExportPage() {
  return (
    <FeatureDetail
      icon={FileArchive}
      title="One-Click Accountant Export"
      tagline="Bundle receipts, invoices, and a period summary into one download — everything your accountant needs, ready to go."
      mobileSrc="/screenshots/home-mobile-framed.webp"
      desktopSrc="/screenshots/home-desktop.webp"
      screenshotAlt="The TaxSnap dashboard, showing the Export CSV and For Accountant buttons above a list of receipts"
      paragraphs={[
        "When tax season rolls around, hand your accountant one file instead of a folder of paper or a pile of forwarded emails. TaxSnap bundles your receipt images, invoice PDFs, and a plain-language summary of the period into a single download.",
        "Prefer to keep your own books? Export a plain CSV of your receipts anytime — no bundle required — for whatever spreadsheet or software you already use.",
        "Either way, it's built from the same records TaxSnap already tracks automatically, so there's no separate step of compiling anything by hand before you send it off.",
      ]}
    />
  );
}
