import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Verifies a 4-digit PIN against the caller's own app_settings row and
// reports which role, if any, it matched. The comparison happens entirely
// inside verify_app_pin() (0017_app_lock.sql) - owner_pin_hash/staff_pin_hash
// are never selectable from this route (blocked at the column level too).
// Not run through requireProUser() - the app lock is a UI-level nav
// convenience independent of subscription tier, only real auth is required.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { pin } = body ?? {};

  if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) {
    return NextResponse.json({ error: "PIN must be 4 digits." }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("verify_app_pin", { p_pin: pin });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ role: (data as "owner" | "staff" | null) ?? null });
}
