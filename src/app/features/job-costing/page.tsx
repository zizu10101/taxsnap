import type { Metadata } from "next";
import { Briefcase } from "lucide-react";
import { FeatureDetail } from "@/components/landing/feature-detail";

export const metadata: Metadata = {
  title: "Job Costing — TaxSnap",
};

export default function JobCostingPage() {
  return (
    <FeatureDetail
      icon={Briefcase}
      title="Job Costing"
      tagline="Track profitability per job. Log materials, assign labor hours, link the invoice — see your real margin on every project, not just a guess."
      note="Available on the Pro plan."
      mobileSrc="/screenshots/job-mobile-framed.webp"
      desktopSrc="/screenshots/job-desktop.webp"
      screenshotAlt="A job cost breakdown in TaxSnap, showing materials, labor, revenue, and estimated profit"
      paragraphs={[
        "Tag any receipt to a job while you're scanning it, and log employee hours against that same job as work happens. TaxSnap adds up materials and labor automatically, so you always know a job's true cost — not just what you quoted for it.",
        "Revenue is counted from payments you've actually received on invoices linked to that job, pro-rated for deposits — not the full invoice total the moment it's sent. That means your estimated profit reflects money in hand, not money you're still waiting on.",
        "Job costing is kept completely separate from your tax tracking — labor cost never touches your HST return or write-off totals. It's here purely to answer one question: was this job actually worth it?",
      ]}
    />
  );
}
