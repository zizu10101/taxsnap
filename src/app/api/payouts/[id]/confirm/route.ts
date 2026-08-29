import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";

// Deliberately its own endpoint rather than a generic PATCH /api/payouts/[id]
// - no stylist login exists (see CLAUDE.md), so this is the owner recording
// that the stylist confirmed receipt some other way (verbally, text, etc.).
// Calls the confirm_payout() security-definer function rather than a direct
// table update - payouts has no update RLS policy at all (0012_payouts.sql),
// so a plain .from("payouts").update() would always fail here, and even if
// it were allowed it could let a client rewrite total_amount/status too,
// not just the confirmation fields this endpoint intends to expose.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase } = result;
  const { id } = await params;

  const { data, error } = await supabase.rpc("confirm_payout", { p_payout_id: id });

  if (error) {
    if (error.message.includes("PAYOUT_NOT_FOUND")) {
      return NextResponse.json({ error: "Payout not found." }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ payout: data });
}
