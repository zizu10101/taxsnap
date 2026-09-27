import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { wouldExceedActiveLimit, limitReachedMessage } from "@/lib/plan-limits";
import type { RenterUpdate } from "@/lib/database.types";

// Owner can edit or deactivate a renter (is_active = false) - never
// deleted, so a past rent_payments row always keeps a real renter to
// point at (renter_id is on delete restrict).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;
  const { id } = await params;

  const body = await request.json();
  const { name, rental_rate, rate_cadence, is_active } = body ?? {};

  // Same reactivation-cap reasoning as services/[id], products/[id],
  // employees/[id] - only checked when this PATCH would increase the
  // active count.
  if (is_active === true) {
    const activeCheck = await wouldExceedActiveLimit(supabase, user.id, "renters", id);
    if (activeCheck.exceeded) {
      return NextResponse.json(
        { error: limitReachedMessage(activeCheck, "active renter"), code: "FREE_LIMIT_REACHED" },
        { status: 403 },
      );
    }
  }

  if (rate_cadence !== undefined && rate_cadence !== "weekly" && rate_cadence !== "monthly") {
    return NextResponse.json({ error: "rate_cadence must be weekly or monthly." }, { status: 400 });
  }

  const update: RenterUpdate = {};
  if (name !== undefined) {
    if (!name?.trim()) {
      return NextResponse.json({ error: "Renter name is required." }, { status: 400 });
    }
    update.name = name.trim();
  }
  if (rental_rate !== undefined) update.rental_rate = Number(rental_rate) || 0;
  if (rate_cadence !== undefined) update.rate_cadence = rate_cadence;
  if (is_active !== undefined) update.is_active = !!is_active;

  const { data, error } = await supabase
    .from("renters")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ renter: data });
}
