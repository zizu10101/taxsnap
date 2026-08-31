import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Marks the salon onboarding flow (/onboarding) done for the current
// account, whether every step was actually completed or skipped - either
// way there's nothing left to show, and the account lands on the normal
// dashboard from here on. Not Pro-gated (unlike /api/services, /api/stylists,
// /api/profile/logo, which individual onboarding steps call directly) -
// the flow itself must always be dismissible regardless of subscription
// tier, even if some of its steps aren't usable on Free.
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
    .update({ onboarding_completed: true })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
