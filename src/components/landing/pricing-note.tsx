import Link from "next/link";

// The one-line plan note under a feature page's tagline. Numbers (scans, jobs,
// employees...) live in the Pricing section only, so a page points there instead
// of repeating them and drifting.
export function PricingNote({ lead = "Included on every plan, with limits." }: { lead?: string }) {
  return (
    <>
      {lead}{" "}
      <Link href="/#pricing" className="underline underline-offset-2 hover:text-primary/80">
        See Pricing
      </Link>
      .
    </>
  );
}
