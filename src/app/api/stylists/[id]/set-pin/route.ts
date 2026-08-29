import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";

// Sets or resets a stylist's 4-digit PIN. Hashing happens inside
// set_stylist_pin() (0013_stylist_pin.sql), not here - this route only
// validates the request shape before forwarding, so the raw PIN is never
// hashed or stored anywhere in JS.
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

  const { error } = await supabase.rpc("set_stylist_pin", {
    p_stylist_id: id,
    p_pin: pin,
  });

  if (error) {
    if (error.message.includes("STYLIST_NOT_FOUND")) {
      return NextResponse.json({ error: "Stylist not found." }, { status: 404 });
    }
    if (error.message.includes("INVALID_PIN")) {
      return NextResponse.json({ error: "PIN must be 4 digits." }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
