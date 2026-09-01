import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Manual re-entry point for the onboarding wizard (Settings -> "Redo
// Setup"), so an account can revisit /onboarding without deleting and
// recreating it. Works for both business types - /onboarding itself
// branches to OnboardingFlow (salon) or GeneralOnboardingFlow (general).
// Only flips onboarding_completed back to false - nothing else is reset,
// so whatever's already set (Logo/PINs/Services/Stylists for salon;
// Logo/Business info/Staff for general) stays exactly as it is; salon's
// OnboardingFlow additionally skips its two PIN steps outright if already
// set (see visibleSteps in onboarding-flow.tsx), since PinSetupFlow can't
// otherwise display "already set" the way the other steps do.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("profiles")
    .update({ onboarding_completed: false })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
