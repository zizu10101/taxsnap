import type { Metadata } from "next";
import { Layers } from "lucide-react";
import { FeatureDetail } from "@/components/landing/feature-detail";

const DESCRIPTION =
  "Bill large jobs in draws against a contract value, log change orders, track retainage, and keep a running received/remaining ledger — no spreadsheets.";

export const metadata: Metadata = {
  title: "Progress Billing — TaxSnap",
  description: DESCRIPTION,
  openGraph: {
    title: "Progress Billing — TaxSnap",
    description: DESCRIPTION,
    type: "website",
  },
};

export default function ProgressBillingPage() {
  return (
    <FeatureDetail
      icon={Layers}
      eyebrow="Progress Billing"
      title="Progress Billing"
      tagline="Bill large jobs in draws against a contract value, track retainage, and keep a running received/remaining ledger — no spreadsheets, no manual math."
      note="Available on the Pro plan."
      screenshotAlt="The Progress Billing summary in TaxSnap, showing contract value, draws, and a running received/remaining ledger"
      howItWorks={[
        {
          title: "Set a contract value",
          description: "Start the job with the total contract amount you agreed to.",
        },
        {
          title: "Bill draws as work progresses",
          description:
            "Create sequential, numbered draws against the contract using the same invoice builder as any other invoice.",
        },
        {
          title: "Log change orders when scope changes",
          description:
            "Adjust the contract value up or down when a client approves added or removed work, and bill it on its own draw.",
        },
        {
          title: "Track and collect retainage",
          description:
            "Set a retainage rate to see what's expected on each draw before the client's holdback, then bill it once the contract is fully invoiced.",
        },
      ]}
      paragraphs={[
        "Large jobs rarely get paid in one shot. Progress Billing lets you invoice a contract in numbered draws as work is completed, instead of billing the whole thing up front or waiting until the very end.",
        "Client approved extra work? Log it as a change order and it adjusts the contract value automatically — bill it on its own draw, or fold it into the next one.",
        "If you hold back a percentage as retainage, TaxSnap tracks it per draw and tells you exactly what's expected up front versus what's withheld, so you can bill the retained amount once the contract is fully invoiced.",
        "A running ledger shows contract value, invoiced-to-date, received-to-date, and remaining balance at a glance — built from the same payment records the rest of TaxSnap already tracks, not a separate spreadsheet you have to keep in sync by hand.",
      ]}
    />
  );
}
