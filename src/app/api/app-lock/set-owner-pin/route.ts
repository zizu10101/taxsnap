import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Sets or resets the owner's app-lock PIN. Hashing happens inside
// set_owner_pin() (0017_app_lock.sql), not here - this route only validates
// the request shape before forwarding, so the raw PIN is never hashed or
// stored anywhere in JS.
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

  const { error } = await supabase.rpc("set_owner_pin", { p_pin: pin });

  if (error) {
    if (error.message.includes("INVALID_PIN")) {
      return NextResponse.json({ error: "PIN must be 4 digits." }, { status: 400 });
    }
    if (error.message.includes("PIN_CONFLICT")) {
      return NextResponse.json(
        {
          error: "That PIN is already used for staff mode. Choose a different one.",
          code: "PIN_CONFLICT",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
