import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { wouldExceedActiveLimit, limitReachedMessage } from "@/lib/plan-limits";

export async function GET() {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { data, error } = await result.supabase
    .from("line_items")
    .select("*")
    .order("description", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lineItems: data });
}

export async function POST(request: Request) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  const body = await request.json();
  const { description, unit_price } = body ?? {};

  if (!description?.trim()) {
    return NextResponse.json({ error: "Item description is required." }, { status: 400 });
  }

  // Every tier gets a capped number of active saved items (see
  // src/lib/plan-limits.ts) - a new item always inserts as active, so
  // this is checked unconditionally here, same as services' own POST.
  const activeCheck = await wouldExceedActiveLimit(supabase, user.id, "lineItems");
  if (activeCheck.exceeded) {
    return NextResponse.json(
      { error: limitReachedMessage(activeCheck, "active saved item"), code: "FREE_LIMIT_REACHED" },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from("line_items")
    .insert({
      user_id: user.id,
      description: description.trim(),
      unit_price: Number(unit_price) || 0,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lineItem: data }, { status: 201 });
}
