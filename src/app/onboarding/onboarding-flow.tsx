"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Service, StylistPublic } from "@/lib/database.types";
import { LogoStep } from "./steps/logo-step";
import { PinStep } from "./steps/pin-step";
import { ServicesStep } from "./steps/services-step";
import { StylistsStep } from "./steps/stylists-step";

export function OnboardingFlow({
  isPro,
  initialLogoPath,
  hasOwnerPin,
  hasStaffPin,
  initialServices,
  initialStylists,
}: {
  isPro: boolean;
  initialLogoPath: string | null;
  hasOwnerPin: boolean;
  hasStaffPin: boolean;
  initialServices: Service[];
  initialStylists: StylistPublic[];
}) {
  const router = useRouter();

  // The wizard's own position is never persisted - abandoning mid-flow
  // just means landing back on /onboarding next time (dashboard/page.tsx's
  // redirect is still true) and starting over from here. Logo/Services/
  // Stylists steps naturally show whatever's already there since they read
  // live initial state either way, but the PIN steps have no such "already
  // done" display of their own (PinSetupFlow always starts blank) - a
  // resumed session would otherwise re-prompt for a PIN already set in an
  // earlier attempt, so those two steps are skipped outright here instead
  // of being redundantly re-shown.
  const visibleSteps = useMemo(() => {
    const all = [0, 1, 2, 3, 4];
    return all.filter((s) => {
      if (s === 1) return !hasOwnerPin;
      if (s === 2) return !hasStaffPin;
      return true;
    });
    // Deliberately computed once from the initial server-fetched values,
    // not kept in sync with what happens later in this same session -
    // once a step is passed it's never revisited, so a stale read after
    // that point can't matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [cursor, setCursor] = useState(0);
  const step = visibleSteps[cursor];

  function goToNextOrFinish() {
    if (cursor === visibleSteps.length - 1) {
      finish();
    } else {
      setCursor((c) => c + 1);
    }
  }

  async function finish() {
    try {
      await fetch("/api/onboarding/complete", { method: "POST" });
    } finally {
      // Best-effort: even if the request fails, there's nothing more
      // useful to do than let them into the app - they'd just land back
      // on /onboarding next time and can finish (or skip through) again.
      router.push("/dashboard");
    }
  }

  // Step numbers shown to the user are each step's fixed identity (1-5),
  // not a renumbering of visibleSteps - if step 2 is skipped, the
  // progress label goes from "Step 1 of 5" straight to "Step 3 of 5"
  // rather than fabricating a shrunk total.
  switch (step) {
    case 0:
      return <LogoStep initialLogoPath={initialLogoPath} onNext={goToNextOrFinish} />;
    case 1:
      return (
        <PinStep
          stepNumber={2}
          title="Set an owner PIN"
          description="Unlocks the full app on a shared device. You can change or add this later from Settings."
          endpoint="/api/app-lock/set-owner-pin"
          savedMessage="Owner PIN saved"
          isPro={isPro}
          onNext={goToNextOrFinish}
        />
      );
    case 2:
      return (
        <PinStep
          stepNumber={3}
          title="Set a staff PIN"
          description="Unlocks a restricted view - Commission Log only, nothing else. You can change or add this later from Settings."
          endpoint="/api/app-lock/set-staff-pin"
          savedMessage="Staff PIN saved"
          isPro={isPro}
          onNext={goToNextOrFinish}
        />
      );
    case 3:
      return <ServicesStep initialServices={initialServices} onNext={goToNextOrFinish} />;
    case 4:
      return (
        <StylistsStep isPro={isPro} initialStylists={initialStylists} onNext={goToNextOrFinish} />
      );
    default:
      // Unreachable: 0, 3, and 4 are never filtered out of visibleSteps,
      // so `step` always matches one of the cases above for any valid
      // cursor. Only here to satisfy the switch's exhaustiveness on a
      // plain `number`.
      return null;
  }
}
