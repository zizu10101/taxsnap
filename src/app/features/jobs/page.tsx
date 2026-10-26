import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { MapPin } from "lucide-react";
import { FeatureDetail } from "@/components/landing/feature-detail";

const DESCRIPTION =
  "Pick a client once and it follows the job. Add the job site. Private internal notes on every estimate and invoice never reach the client.";

export const metadata: Metadata = pageMetadata({
  title: "Jobs with Client and Location, Plus Private Notes — TaxSnap",
  description: DESCRIPTION,
  path: "/features/jobs",
});

export default function JobsPage() {
  return (
    <FeatureDetail
      featureHref="/features/jobs"
      icon={MapPin}
      eyebrow="Jobs"
      title="Jobs with Client and Location, Plus Private Notes"
      tagline="Pick a client once and it follows the job. Add the job site. Private internal notes on every estimate and invoice never reach the client."
      hideScreenshot
      benefits={[
        {
          title: "Pick the client once",
          description:
            "Attach a client to the job and it fills in on the estimates and invoices you make for it.",
        },
        {
          title: "Know where the work is",
          description:
            "Add the job site to the job, and it's filled in as the place of work on new estimates and invoices.",
        },
        {
          title: "Private notes on every document",
          description:
            "Every estimate and invoice has internal notes that only you see. They never reach the client, the PDF or any shared page.",
        },
      ]}
      howItWorks={[
        {
          title: "Create the job",
          description: "Give it a name, the job site and the client.",
        },
        {
          title: "Make an estimate or invoice",
          description: "Choose the job and the client and place of work come along.",
        },
        {
          title: "Add private notes to the document",
          description:
            "Jot down gate codes, reminders or pricing thoughts on the estimate or invoice. Your client's copy stays clean.",
        },
        {
          title: "Tag costs to the job",
          description:
            "Receipts and hours land on the same job, so you can see what it really made you.",
        },
      ]}
      paragraphs={[
        "Most of your paperwork is about a job. Set the client and the location once and stop retyping them on every document.",
        "Private internal notes on every estimate and invoice are for you alone. They never appear on the PDF, the shared link or anything your client can open.",
      ]}
    />
  );
}
