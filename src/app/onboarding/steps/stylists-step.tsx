"use client";

import { Button } from "@/components/ui/button";
import { StylistList } from "@/components/commission/stylist-list";
import { OnboardingStepShell } from "../onboarding-step-shell";
import { ProLockCard } from "../pro-lock-card";
import type { StylistPublic } from "@/lib/database.types";

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
      description="Who logs commission against those services. Add as many as you like - you can always add more later from Stylists. Payout PINs can be set anytime from Edit Stylist."
      onSkip={onNext}
    >
      {isPro ? (
        <>
          <StylistList initialStylists={initialStylists} showNav={false} />
          <Button className="w-full" onClick={onNext}>
            Continue
          </Button>
        </>
      ) : (
        <ProLockCard />
      )}
    </OnboardingStepShell>
  );
}
