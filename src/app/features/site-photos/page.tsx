import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Images } from "lucide-react";
import { FeatureDetail } from "@/components/landing/feature-detail";

const DESCRIPTION =
  "Snap before and after photos on the job and keep them with it. Organized per job, in one Photos page, and private to you — never shown to clients.";

export const metadata: Metadata = pageMetadata({
  title: "Site Photos on Every Job — TaxSnap",
  description: DESCRIPTION,
  path: "/features/site-photos",
});

export default function SitePhotosPage() {
  return (
    <FeatureDetail
      featureHref="/features/site-photos"
      icon={Images}
      eyebrow="Site Photos"
      title="Site Photos on Every Job"
      tagline="Snap before and after photos on the job and keep them with it. Private to you, never shown to clients."
      hideScreenshot
      benefits={[
        {
          title: "Filed under the job",
          description:
            "Pick the job when you add photos, or save them as unsorted and sort them later.",
        },
        {
          title: "Quick to browse",
          description: "Scroll the thumbnails, then tap any photo to see it full size.",
        },
        {
          title: "Private to you",
          description:
            "Photos aren't shown to your clients and don't go on invoices or estimates.",
        },
      ]}
      howItWorks={[
        {
          title: "Take or upload photos",
          description:
            "Use your phone's camera, or choose pictures you already have. They're shrunk on your phone before they upload.",
        },
        {
          title: "Pick the job",
          description:
            "File them under a job, or save them as unsorted if you're in a hurry.",
        },
        {
          title: "Browse and open",
          description:
            "Find a job's photos on the job itself, or see everything in one Photos page.",
        },
        {
          title: "Clean up in bulk",
          description:
            "Select several photos to move them to a job or delete them at once.",
        },
      ]}
      paragraphs={[
        "Before and after shots settle arguments and show your work. TaxSnap keeps them on the job they belong to, so you're not scrolling through your camera roll to find one.",
        "Took a pile of photos on site and no time to sort them? Save them as unsorted and move them to the right job when you're back at your desk.",
      ]}
    />
  );
}
