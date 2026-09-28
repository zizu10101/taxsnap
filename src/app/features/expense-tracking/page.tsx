import type { Metadata } from "next";
import { Receipt } from "lucide-react";
import { FeatureDetail } from "@/components/landing/feature-detail";

const DESCRIPTION =
  "Snap a photo of any receipt or vendor invoice and let AI fill in the merchant, total, tax, and write-off category automatically — no manual entry, no lost paper.";

export const metadata: Metadata = {
  title: "Automated Expense Tracking — TaxSnap",
  description: DESCRIPTION,
  openGraph: {
    title: "Automated Expense Tracking — TaxSnap",
    description: DESCRIPTION,
    type: "website",
  },
};

export default function ExpenseTrackingPage() {
  return (
    <FeatureDetail
      icon={Receipt}
      eyebrow="Expense Tracking"
      title="Automated Expense Tracking"
      tagline="Snap a photo of any receipt or vendor invoice. TaxSnap reads it, categorizes it, and keeps a digital copy on file — no manual entry, no lost paper."
      mobileSrc="/screenshots/receipt-mobile-framed.webp"
      desktopSrc="/screenshots/receipt-desktop.webp"
      screenshotAlt="A parsed receipt in TaxSnap, showing merchant, items, and total filled in automatically"
      howItWorks={[
        {
          title: "Snap or upload a receipt",
          description:
            "Use your phone's camera, or upload a photo of a vendor invoice from your computer.",
        },
        {
          title: "AI reads and categorizes it",
          description:
            "Merchant, date, line items, subtotal, tax, and a suggested write-off category are filled in for you.",
        },
        {
          title: "Review and save",
          description:
            "Double-check the details, tap save, and the original image is kept on file for later.",
        },
      ]}
      paragraphs={[
        "Point your phone's camera at a receipt, or upload a photo of a vendor invoice, and TaxSnap's AI reads it for you — merchant name, date, line items, subtotal, tax, and a suggested write-off category, all filled in automatically. Review it, tap save, and move on with your day.",
        "The original image is kept on file too, so you always have a digital copy if you ever need to look one up — no shoebox of paper receipts, no folder of blurry phone photos you can't find later.",
        "Meals & entertainment purchases are flagged automatically, since the CRA only allows a 50% input tax credit on those — one less rule you have to remember to apply by hand.",
        "The Free plan includes 5 receipt scans a month at no cost, so you can try it before committing. Plus and Pro plans include unlimited scans.",
      ]}
    />
  );
}
