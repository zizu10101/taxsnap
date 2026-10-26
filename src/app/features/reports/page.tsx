import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { BarChart3 } from "lucide-react";
import { FeatureDetail } from "@/components/landing/feature-detail";
import { PricingNote } from "@/components/landing/pricing-note";

const DESCRIPTION =
  "Revenue by client, expenses by category or vendor, and your HST position for any date range. Export your data when tax time comes.";

export const metadata: Metadata = pageMetadata({
  title: "Reports — TaxSnap",
  description: DESCRIPTION,
  path: "/features/reports",
});

export default function ReportsPage() {
  return (
    <FeatureDetail
      featureHref="/features/reports"
      icon={BarChart3}
      eyebrow="Reports"
      title="Reports"
      tagline="Your numbers, any time. Revenue, expenses and your HST position for any date range."
      note={<PricingNote lead="Available on the Pro plan." />}
      hideScreenshot
      benefits={[
        {
          title: "Who pays you",
          description: "See revenue by client, built from the payments you've actually received.",
        },
        {
          title: "Where it goes",
          description: "See expenses by category, or switch to vendor to spot your biggest costs.",
        },
        {
          title: "What you owe",
          description: "Your HST position for the same dates, so there are no surprises at filing time.",
        },
      ]}
      howItWorks={[
        {
          title: "Open Reports and pick your dates",
          description: "Choose a month, a quarter, a year or your own range.",
        },
        {
          title: "Read revenue by client",
          description: "Open a client to see the payments behind the total.",
        },
        {
          title: "Check your expenses",
          description: "Group them by category or by vendor.",
        },
        {
          title: "Open the HST Return Helper",
          description: "See what you owe or can claim for the period.",
        },
        {
          title: "Export your data",
          description: "Download your numbers as a file when tax time comes.",
        },
      ]}
      paragraphs={[
        "Reports pull from the same receipts and payments as the rest of TaxSnap, so the numbers match everywhere you look. Change the dates and every view follows.",
        "The HST figures are a planning estimate, not a filing. Confirm your final numbers with a licensed professional.",
      ]}
    />
  );
}
