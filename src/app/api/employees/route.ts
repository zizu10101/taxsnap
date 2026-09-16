import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { toTitleCase } from "@/lib/format-name";
import { wouldExceedActiveLimit, limitReachedMessage } from "@/lib/plan-limits";

export async function GET() {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { data, error } = await result.supabase
    .from("employees")
    .select("*")
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ employees: data });
}

export async function POST(request: Request) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  const body = await request.json();
  const { name, default_hourly_rate, default_billable_rate } = body ?? {};

  if (!name?.trim()) {
    return NextResponse.json({ error: "Employee name is required." }, { status: 400 });
  }

  // Every tier gets a capped number of active employees (see
  // src/lib/plan-limits.ts) - a new employee always inserts as active
  // (there's no is_active input on create), same shape as
  // services/stylists' active-row caps.
  const activeCheck = await wouldExceedActiveLimit(supabase, user.id, "employees");
  if (activeCheck.exceeded) {
    return NextResponse.json(
      { error: limitReachedMessage(activeCheck, "active employee"), code: "FREE_LIMIT_REACHED" },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from("employees")
    .insert({
      user_id: user.id,
      name: toTitleCase(name),
      default_hourly_rate: Number(default_hourly_rate) || 0,
      default_billable_rate: Number(default_billable_rate) || 0,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ employee: data }, { status: 201 });
}
