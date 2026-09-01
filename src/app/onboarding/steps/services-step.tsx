"use client";

import { Button } from "@/components/ui/button";
import { ServiceList } from "@/components/commission/service-list";
import { OnboardingStepShell } from "../onboarding-step-shell";
import type { Service } from "@/lib/database.types";

// Not Pro-gated - free-tier salon accounts get this step too, capped at 1
// active service same as the real Services tab (enforced server-side, see
// lib/free-tier-limits.ts; ServiceDialog surfaces a 2nd add attempt as the
// same upgrade-toast prompt used everywhere else).
export function ServicesStep({
  initialServices,
  onNext,
}: {
  initialServices: Service[];
  onNext: () => void;
}) {
  return (
    <OnboardingStepShell
      stepNumber={4}
      title="Add your services"
      description="What you offer, and the price stylists log commission against. You can always add more later from Services."
      onSkip={onNext}
    >
      <ServiceList initialServices={initialServices} showNav={false} />
      <Button className="w-full" onClick={onNext}>
        Continue
      </Button>
    </OnboardingStepShell>
  );
}
