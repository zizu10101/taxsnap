import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Manual re-entry point for the onboarding wizard (Settings -> "Redo
// Setup"), so an account can revisit /onboarding without deleting and
// recreating it. Only flips onboarding_completed back to false - nothing
// else is reset (business name, province and goal are simply asked again).
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
