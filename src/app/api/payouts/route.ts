import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";
import type { Payout, PayoutStatus } from "@/lib/database.types";

const PAYOUT_STATUSES: PayoutStatus[] = ["active", "voided"];

function nextDayIso(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

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
  // from/to are date-only (YYYY-MM-DD) from the shared DateRangeFilter, but
  // paid_at is a timestamptz - same exclusive "< next day" upper bound as
  // GET /api/commission-entries, for the same reason (a bare upper-bound
  // date would exclude anything paid out later that same day).
  if (from) query = query.gte("paid_at", from);
  if (to) query = query.lt("paid_at", nextDayIso(to));

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
