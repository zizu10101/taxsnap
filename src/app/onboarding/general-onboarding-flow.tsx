"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Employee } from "@/lib/database.types";
import { LogoStep } from "./steps/logo-step";
import { BusinessInfoStep } from "./steps/business-info-step";
import { StaffStep } from "./steps/staff-step";

// General-business counterpart to OnboardingFlow (salon) - same wizard
// shell/skip pattern, different 3-step sequence: Logo, Business info,
// Staff. Unlike the salon flow's Owner/Staff PIN steps, none of these
// three have an "already satisfied, skip outright" case to compute up
// front (Business info and Staff both show their current saved state
// normally on revisit, unlike a PIN field which can't), so this is just a
// plain 0/1/2 cursor.
export function GeneralOnboardingFlow({
  isPro,
  initialLogoPath,
  initialProfile,
  initialEmployees,
}: {
  isPro: boolean;
  initialLogoPath: string | null;
  initialProfile: {
    business_name: string | null;
    business_address: string | null;
    business_phone: string | null;
    business_email: string | null;
  };
  initialEmployees: Employee[];
}) {
  const router = useRouter();
  const [cursor, setCursor] = useState(0);

  function goToNextOrFinish() {
    if (cursor === 2) finish();
    else setCursor((c) => c + 1);
  }

  async function finish() {
    try {
      await fetch("/api/onboarding/complete", { method: "POST" });
    } finally {
      router.push("/dashboard");
    }
  }

  switch (cursor) {
    case 0:
      return (
        <LogoStep
          initialLogoPath={initialLogoPath}
          onNext={goToNextOrFinish}
          totalSteps={3}
          description="Shown on every invoice and estimate you create."
        />
      );
    case 1:
      return (
        <BusinessInfoStep
          isPro={isPro}
          initialProfile={initialProfile}
          onNext={goToNextOrFinish}
        />
      );
    case 2:
      return (
        <StaffStep isPro={isPro} initialEmployees={initialEmployees} onNext={goToNextOrFinish} />
      );
    default:
      return null;
  }
}
