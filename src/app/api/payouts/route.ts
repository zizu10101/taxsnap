import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";
import type { Payout } from "@/lib/database.types";

// Batches a stylist's outstanding (unpaid, non-deleted) commission entries
// in a date range into a single payout. The sum + insert + linking of
// entries all happen inside the create_payout() Postgres function
// (0012_payouts.sql) so they're one transaction - postgrest itself can't
// span multiple statements across separate .from() calls, so a stored
// procedure is the only way to guarantee a payout's total_amount can never
// end up mismatched from the entries actually linked to it.
export async function POST(request: Request) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase } = result;

  const body = await request.json();
  const { stylist_id, range_start, range_end } = body ?? {};

  if (!stylist_id || !range_start || !range_end) {
    return NextResponse.json(
      { error: "stylist_id, range_start, and range_end are required." },
      { status: 400 },
    );
  }

  const { data, error } = await supabase.rpc("create_payout", {
    p_stylist_id: stylist_id,
    p_range_start: range_start,
    p_range_end: range_end,
  });

  if (error) {
    if (error.message.includes("STYLIST_NOT_FOUND")) {
      return NextResponse.json({ error: "Stylist not found." }, { status: 404 });
    }
    if (error.message.includes("NO_UNPAID_ENTRIES")) {
      return NextResponse.json(
        { error: "No unpaid entries in that date range." },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ payout: data as Payout }, { status: 201 });
}
