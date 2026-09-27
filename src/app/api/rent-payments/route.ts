import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";

// paid_date is a plain `date` column, not timestamptz - from/to are plain
// inclusive "YYYY-MM-DD" strings (DateRange's own convention), same as
// getExpenseOverviewData's transaction_date filter, not
// rangeToUtcBounds()'s UTC-instant convention (that's only needed for a
// timestamptz column being compared against a bare date string).
export async function GET(request: Request) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const renterId = searchParams.get("renter_id");

  let query = result.supabase
    .from("rent_payments")
    .select("*, renter:renters(id, name)")
    .order("paid_date", { ascending: false });

  if (from) query = query.gte("paid_date", from);
  if (to) query = query.lte("paid_date", to);
  if (renterId) query = query.eq("renter_id", renterId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ payments: data });
}

// Rent payments themselves are never capped at any tier (see
// lib/plan-limits.ts) - only the renter they're logged against is, same
// shape as hour_entries vs. employees.
export async function POST(request: Request) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  const body = await request.json();
  const { renter_id, paid_date, amount } = body ?? {};

  if (!renter_id) {
    return NextResponse.json({ error: "renter_id is required." }, { status: 400 });
  }
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return NextResponse.json({ error: "amount must be a positive number." }, { status: 400 });
  }

  const { data: renter } = await supabase
    .from("renters")
    .select("id")
    .eq("id", renter_id)
    .eq("user_id", user.id)
    .single();
  if (!renter) return NextResponse.json({ error: "Renter not found." }, { status: 404 });

  const { data, error } = await supabase
    .from("rent_payments")
    .insert({
      user_id: user.id,
      renter_id,
      paid_date: paid_date || undefined,
      amount: numericAmount,
    })
    .select("*, renter:renters(id, name)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ payment: data }, { status: 201 });
}
