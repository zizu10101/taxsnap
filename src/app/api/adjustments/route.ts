import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";
import type { Adjustment } from "@/lib/database.types";

// Lists a stylist's adjustments - used to surface pending (unapplied) ones
// on the Unpaid view and in the Mark-as-Paid breakdown. Not date-filtered:
// create_payout() folds in *every* unapplied adjustment for a stylist
// regardless of the range being paid out, since an adjustment corrects a
// past payout rather than being tied to a service date, so the listing
// that powers "what would folding one in add right now" mirrors that.
export async function GET(request: Request) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase } = result;

  const { searchParams } = new URL(request.url);
  const stylistId = searchParams.get("stylist_id");
  const applied = searchParams.get("applied"); // "false" | "true" | null

  if (!stylistId) {
    return NextResponse.json({ error: "stylist_id is required." }, { status: 400 });
  }

  let query = supabase
    .from("adjustments")
    .select("*")
    .eq("stylist_id", stylistId)
    .order("created_at", { ascending: false });

  if (applied === "false") query = query.is("applied_payout_id", null);
  if (applied === "true") query = query.not("applied_payout_id", "is", null);

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ adjustments: data as Adjustment[] });
}

// Wraps create_adjustment() (0016_adjustments.sql) - the only way an
// adjustment is ever created, so this route just validates the request
// shape and maps the function's exceptions to clear responses. Never
// applied immediately: applied_payout_id stays null until the stylist's
// next create_payout() call folds it in.
export async function POST(request: Request) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase } = result;

  const body = await request.json();
  const { stylist_id, related_payout_id, amount, reason } = body ?? {};

  if (!stylist_id || !related_payout_id) {
    return NextResponse.json(
      { error: "stylist_id and related_payout_id are required." },
      { status: 400 },
    );
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount === 0) {
    return NextResponse.json(
      { error: "Enter a non-zero adjustment amount." },
      { status: 400 },
    );
  }
  if (typeof reason !== "string" || !reason.trim()) {
    return NextResponse.json({ error: "A reason is required." }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("create_adjustment", {
    p_stylist_id: stylist_id,
    p_related_payout_id: related_payout_id,
    p_amount: amount,
    p_reason: reason.trim(),
  });

  if (error) {
    if (error.message.includes("STYLIST_NOT_FOUND")) {
      return NextResponse.json({ error: "Stylist not found." }, { status: 404 });
    }
    if (error.message.includes("REASON_REQUIRED")) {
      return NextResponse.json({ error: "A reason is required." }, { status: 400 });
    }
    if (error.message.includes("PAYOUT_NOT_FOUND")) {
      return NextResponse.json({ error: "Payout not found." }, { status: 404 });
    }
    if (error.message.includes("PAYOUT_NOT_CONFIRMED")) {
      return NextResponse.json(
        {
          error:
            "Adjustments can only be added to a payout the stylist has confirmed. Use Void instead for an unconfirmed or voided payout.",
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ adjustment: data as Adjustment }, { status: 201 });
}
