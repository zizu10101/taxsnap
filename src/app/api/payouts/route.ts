import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";
import type { Payout, PayoutStatus } from "@/lib/database.types";

const PAYOUT_STATUSES: PayoutStatus[] = ["active", "voided"];

// Lists payouts directly (not derived from commission_entries) - needed so
// a voided payout stays visible in Reports even though void_payout()
// deliberately nulls out every linked entry's payout_id, severing the only
// link the entries-driven Paid view would otherwise have to it.
export async function GET(request: Request) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase } = result;

  const { searchParams } = new URL(request.url);
  const stylistId = searchParams.get("stylist_id");
  const status = searchParams.get("status"); // "active" | "voided" | null
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let query = supabase.from("payouts").select("*").order("paid_at", { ascending: false });

  if (stylistId) query = query.eq("stylist_id", stylistId);
  if (status && PAYOUT_STATUSES.includes(status as PayoutStatus)) {
    query = query.eq("status", status as PayoutStatus);
  }
  // from/to are full UTC instants (see GET /api/commission-entries for why
  // - same timestamptz-vs-bare-date pitfall applies to paid_at here).
  if (from) query = query.gte("paid_at", from);
  if (to) query = query.lt("paid_at", to);

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ payouts: data as Payout[] });
}

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
  const { stylist_id, range_start, range_end, start_ts, end_ts } = body ?? {};

  if (!stylist_id || !range_start || !range_end || !start_ts || !end_ts) {
    return NextResponse.json(
      {
        error:
          "stylist_id, range_start, range_end, start_ts, and end_ts are required.",
      },
      { status: 400 },
    );
  }

  // range_start/range_end are shop-local calendar dates, stored on the
  // payout purely for display. start_ts/end_ts are the actual UTC instant
  // boundaries create_payout() filters commission_entries.created_at
  // against - computed client-side (see MarkAsPaidDialog) since the server
  // has no way to know the shop's local UTC offset.
  const { data, error } = await supabase.rpc("create_payout", {
    p_stylist_id: stylist_id,
    p_range_start: range_start,
    p_range_end: range_end,
    p_start_ts: start_ts,
    p_end_ts: end_ts,
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
    if (error.message.includes("NEGATIVE_PAYOUT_TOTAL")) {
      return NextResponse.json(
        {
          error:
            "This payout would be negative due to an outstanding adjustment - wait for more entries to accrue or review the adjustment first.",
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ payout: data as Payout }, { status: 201 });
}
