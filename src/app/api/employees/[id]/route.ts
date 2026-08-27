import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";
import { toTitleCase } from "@/lib/format-name";
import type { EmployeeUpdate } from "@/lib/database.types";

// Owner can edit or deactivate an employee (is_active = false) - there is
// no delete: employees are never removed, only deactivated, so historical
// hour entries always keep a real employee to point at.
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

  const body = await request.json();
  const { name, default_hourly_rate, is_active } = body ?? {};

  const update: EmployeeUpdate = {};
  if (name !== undefined) {
    if (!name?.trim()) {
      return NextResponse.json({ error: "Employee name is required." }, { status: 400 });
    }
    update.name = toTitleCase(name);
  }
  if (default_hourly_rate !== undefined) {
    update.default_hourly_rate = Number(default_hourly_rate) || 0;
  }
  if (is_active !== undefined) {
    update.is_active = !!is_active;
  }

  const { data, error } = await supabase
    .from("employees")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ employee: data });
}
