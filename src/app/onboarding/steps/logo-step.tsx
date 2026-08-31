"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { BusinessLogoUpload } from "@/components/invoices/business-logo";
import { OnboardingStepShell } from "../onboarding-step-shell";
import { ProLockCard } from "../pro-lock-card";

export function LogoStep({
  isPro,
  initialLogoPath,
  onNext,
}: {
  isPro: boolean;
  initialLogoPath: string | null;
  onNext: () => void;
}) {
  // BusinessLogoUpload (existing component, unmodified) auto-saves to
  // /api/profile/logo the moment a file is picked - there's no separate
  // "save" step here, just "move on" once they're done (or never started).
  const [logoPath, setLogoPath] = useState(initialLogoPath);

  return (
    <OnboardingStepShell
      stepNumber={1}
      title="Add your logo"
      description="Shown on every invoice, estimate, and commission report you create."
      onSkip={onNext}
    >
      {isPro ? (
        <>
          <BusinessLogoUpload logoPath={logoPath} onLogoChange={setLogoPath} />
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
