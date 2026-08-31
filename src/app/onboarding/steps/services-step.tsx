"use client";

import { Button } from "@/components/ui/button";
import { ServiceList } from "@/components/commission/service-list";
import { OnboardingStepShell } from "../onboarding-step-shell";
import { ProLockCard } from "../pro-lock-card";
import type { Service } from "@/lib/database.types";

export function ServicesStep({
  isPro,
  initialServices,
  onNext,
}: {
  isPro: boolean;
  initialServices: Service[];
  onNext: () => void;
}) {
  return (
    <OnboardingStepShell
      stepNumber={4}
      title="Add your services"
      description="What you offer, and the price stylists log commission against. Add as many as you like - you can always add more later from Services."
      onSkip={onNext}
    >
      {isPro ? (
        <>
          <ServiceList initialServices={initialServices} showNav={false} />
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
