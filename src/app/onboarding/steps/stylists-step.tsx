"use client";

import { Button } from "@/components/ui/button";
import { StylistList } from "@/components/commission/stylist-list";
import { OnboardingStepShell } from "../onboarding-step-shell";
import type { StylistPublic } from "@/lib/database.types";

// Not Pro-gated - free-tier salon accounts get this step too, capped at 1
// active stylist same as the real Stylists tab (enforced server-side, see
// lib/free-tier-limits.ts; StylistDialog surfaces a 2nd add attempt as the
// same upgrade-toast prompt used everywhere else). `isPro` is only threaded
// through to StylistList/StylistDialog to gate the payout PIN section on
// Edit - it doesn't otherwise change what this step shows.
export function StylistsStep({
  isPro,
  initialStylists,
  onNext,
}: {
  isPro: boolean;
  initialStylists: StylistPublic[];
  onNext: () => void;
}) {
  return (
    <OnboardingStepShell
      stepNumber={5}
      title="Add your stylists"
      description="Who logs commission against those services. You can always add more later from Stylists. Payout PINs can be set anytime from Edit Stylist."
      onSkip={onNext}
    >
      <StylistList initialStylists={initialStylists} isPro={isPro} showNav={false} />
      <Button className="w-full" onClick={onNext}>
        Continue
      </Button>
    </OnboardingStepShell>
  );
}
