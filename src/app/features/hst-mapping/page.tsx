import type { Metadata } from "next";
import { Landmark } from "lucide-react";
import { FeatureDetail } from "@/components/landing/feature-detail";

export const metadata: Metadata = {
  title: "HST-Ready, Automatically — TaxSnap",
};

export default function HstMappingPage() {
  return (
    <FeatureDetail
      icon={Landmark}
      title="HST-Ready, Automatically"
      tagline="Every receipt and invoice maps to the right CRA line items, so your HST return estimate is always current. No spreadsheets, no manual math."
      mobileSrc="/screenshots/hst-mobile-framed.webp"
      desktopSrc="/screenshots/hst-desktop.webp"
      screenshotAlt="The Ontario HST Return Helper in TaxSnap, showing a running estimate mapped to real CRA line numbers"
      paragraphs={[
        "Every expense you scan and every payment you receive is mapped automatically to the actual line numbers on the Ontario GST/HST return — Line 101 (total sales), Line 103 (HST collected), and Line 106 (input tax credits) — so your running total is built from real numbers, not a rough guess.",
        "Invoiced revenue counts payments as they're actually received, pro-rated for deposits, the same way job costing does — so a deposit on a large invoice counts toward the right period even if the invoice isn't fully paid until later. Meals and entertainment purchases are automatically limited to the 50% input tax credit the CRA allows, rather than a flat pass-through of every dollar spent.",
        "This is a planning estimate to help you stay ahead of what you'll owe, not a filing service — TaxSnap doesn't submit anything to the CRA on your behalf. Always verify the final numbers with a bookkeeper or accountant before filing.",
      ]}
    />
  );
}
