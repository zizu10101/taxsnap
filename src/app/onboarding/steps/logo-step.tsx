"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { BusinessLogoUpload } from "@/components/invoices/business-logo";
import { OnboardingStepShell } from "../onboarding-step-shell";

// Not Pro-gated - free-tier salon accounts get this step too, since a logo
// set now is already in place the moment they upgrade to Pro (see
// api/profile/logo/route.ts). It's only actually *used* on invoices/
// commission-report PDFs, both Pro-only, so it's a no-op for Free beyond
// having it ready.
export function LogoStep({
  initialLogoPath,
  onNext,
  totalSteps = 5,
  description = "Shown on every invoice, estimate, and commission report you create.",
}: {
  initialLogoPath: string | null;
  onNext: () => void;
  // Shared with the general-business flow (3 steps) below via
  // GeneralOnboardingFlow - defaults to the salon flow's 5.
  totalSteps?: number;
  description?: string;
}) {
  // BusinessLogoUpload (existing component, unmodified) auto-saves to
  // /api/profile/logo the moment a file is picked - there's no separate
  // "save" step here, just "move on" once they're done (or never started).
  const [logoPath, setLogoPath] = useState(initialLogoPath);

  return (
    <OnboardingStepShell
      stepNumber={1}
      totalSteps={totalSteps}
      title="Add your logo"
      description={description}
      onSkip={onNext}
    >
      <BusinessLogoUpload logoPath={logoPath} onLogoChange={setLogoPath} />
      <Button className="w-full" onClick={onNext}>
        Continue
      </Button>
    </OnboardingStepShell>
  );
}
