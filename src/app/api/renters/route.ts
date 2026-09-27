import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { wouldExceedActiveLimit, limitReachedMessage } from "@/lib/plan-limits";

export async function GET() {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { data, error } = await result.supabase
    .from("renters")
    .select("*")
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ renters: data });
}

export async function POST(request: Request) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  const body = await request.json();
  const { name, rental_rate, rate_cadence } = body ?? {};

  if (!name?.trim()) {
    return NextResponse.json({ error: "Renter name is required." }, { status: 400 });
  }
  if (rate_cadence !== undefined && rate_cadence !== "weekly" && rate_cadence !== "monthly") {
    return NextResponse.json({ error: "rate_cadence must be weekly or monthly." }, { status: 400 });
  }

  // Every tier gets a capped number of active renters (see
  // src/lib/plan-limits.ts), same shape as employees/services/products - a
  // new renter always inserts as active.
  const activeCheck = await wouldExceedActiveLimit(supabase, user.id, "renters");
  if (activeCheck.exceeded) {
    return NextResponse.json(
      { error: limitReachedMessage(activeCheck, "active renter"), code: "FREE_LIMIT_REACHED" },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from("renters")
    .insert({
      user_id: user.id,
      name: name.trim(),
      rental_rate: Number(rental_rate) || 0,
      rate_cadence: rate_cadence ?? "monthly",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ renter: data }, { status: 201 });
}
