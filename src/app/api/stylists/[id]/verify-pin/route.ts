import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";

// Verifies a 4-digit PIN against the stylist's stored hash. The comparison
// happens entirely inside verify_stylist_pin() (0013_stylist_pin.sql) -
// pin_hash is never selectable from this route (blocked at the column
// level too), so there's nothing here that could compare it in JS.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase } = result;
  const { id } = await params;

  const body = await request.json();
  const { pin } = body ?? {};

  if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) {
    return NextResponse.json({ error: "PIN must be 4 digits." }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("verify_stylist_pin", {
    p_stylist_id: id,
    p_pin: pin,
  });

  if (error) {
    if (error.message.includes("STYLIST_NOT_FOUND")) {
      return NextResponse.json({ error: "Stylist not found." }, { status: 404 });
    }
    if (error.message.includes("PIN_LOCKED")) {
      return NextResponse.json(
        {
          error:
            "Too many attempts. Try again in 15 minutes, or reset this stylist's PIN in settings.",
          code: "PIN_LOCKED",
        },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ valid: data === true });
}
