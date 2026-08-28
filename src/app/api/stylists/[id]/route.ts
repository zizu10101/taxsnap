import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";
import { toTitleCase } from "@/lib/format-name";
import type { PayType, StylistUpdate } from "@/lib/database.types";

const PAY_TYPES: PayType[] = ["commission", "hourly", "salary"];

// Owner can edit or deactivate a stylist (is_active = false) - never
// hard-deleted, so historical commission_entries always keep a real
// stylist to point at (same reasoning as employees.is_active).
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
  const { name, pay_type, commission_rate, is_active } = body ?? {};

  const update: StylistUpdate = {};
  if (name !== undefined) {
    if (!name?.trim()) {
      return NextResponse.json({ error: "Stylist name is required." }, { status: 400 });
    }
    update.name = toTitleCase(name);
  }
  if (pay_type !== undefined) {
    if (!PAY_TYPES.includes(pay_type)) {
      return NextResponse.json({ error: "Invalid pay type." }, { status: 400 });
    }
    update.pay_type = pay_type;
  }
  if (commission_rate !== undefined) update.commission_rate = Number(commission_rate) || 0;
  if (is_active !== undefined) update.is_active = !!is_active;

  const { data, error } = await supabase
    .from("stylists")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ stylist: data });
}
