import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";

// Sibling action route rather than DELETE /api/payouts/[id] - the payout
// row is never removed, only marked voided (and kept visible in Reports),
// so DELETE's usual "the resource is gone" implication would be wrong here.
// Same pattern as /confirm: calls the void_payout() security-definer
// function rather than a direct table update, since payouts has no update
// RLS policy at all (0012_payouts.sql).
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

  const { data, error } = await supabase.rpc("void_payout", { p_payout_id: id });

  if (error) {
    if (error.message.includes("PAYOUT_NOT_FOUND")) {
      return NextResponse.json({ error: "Payout not found." }, { status: 404 });
    }
    if (error.message.includes("PAYOUT_ALREADY_CONFIRMED")) {
      return NextResponse.json(
        { error: "This payout was already confirmed by the stylist and can't be voided." },
        { status: 400 },
      );
    }
    if (error.message.includes("PAYOUT_ALREADY_VOIDED")) {
      return NextResponse.json({ error: "This payout is already voided." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ payout: data });
}
