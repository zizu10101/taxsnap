import type { Metadata } from "next";
import { Clock } from "lucide-react";
import { FeatureDetail } from "@/components/landing/feature-detail";
import { PLAN_LIMITS } from "@/lib/plan-limits";
import { everyPlanCapNote } from "@/lib/plan-cap-copy";

export const metadata: Metadata = {
  title: "Employee Clock-In — TaxSnap",
};

export default function EmployeeClockInPage() {
  return (
    <FeatureDetail
      icon={Clock}
      title="Employee Clock-In"
      tagline="Your crew logs their own hours, and you get accurate labor cost on every job without typing a number."
      note={everyPlanCapNote("employee", {
        free: PLAN_LIMITS.free.employees,
        basic: PLAN_LIMITS.basic.employees,
        pro: PLAN_LIMITS.pro.employees,
      })}
      // No real screenshots yet - the whole block is skipped (no placeholder).
      // When they exist: drop hideScreenshot and pass mobileSrc, desktopSrc
      // and screenshotAlt, like the other feature pages.
      hideScreenshot
      howItWorks={[
        {
          title: "One link for the whole crew",
          description: "Share the sign-in link once.",
        },
        {
          title: "A personal PIN for each person",
          description: "Each person picks their name and enters their own 4-digit PIN.",
        },
        {
          title: "Clock in, clock out",
          description:
            "They pick a job and tap Clock in, then Clock out when they're done. TaxSnap records the times and works out the hours.",
        },
        {
          title: "Hours land on the job",
          description:
            "The hours show up on your Hours page and on the job's cost, ready to review.",
        },
      ]}
      paragraphs={[
        "Employees see only their own recent hours, with no access to invoices, receipts, other employees or settings.",
        "You see who's clocked in right now. A forgotten clock-out is flagged, and you can close it, correct either time, or delete a session.",
        "Anything you change is marked, so edited sessions stay easy to tell apart.",
      ]}
    />
  );
}
