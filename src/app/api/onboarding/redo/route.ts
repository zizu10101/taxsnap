import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Manual re-entry point for the salon onboarding wizard (Settings ->
// "Redo Setup"), so a salon account can revisit /onboarding without
// deleting and recreating the account. Only flips onboarding_completed
// back to false - nothing else is reset, so Logo/PINs/Services/Stylists
// already set stay exactly as they are, and OnboardingFlow's own
// skip-already-satisfied-steps logic (visibleSteps in onboarding-flow.tsx)
// naturally shortens the wizard to whatever's still unset.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("business_type")
    .eq("id", user.id)
    .single();

  if (profile?.business_type !== "salon") {
    return NextResponse.json(
      { error: "Setup is only available for salon accounts" },
      { status: 400 },
    );
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
