import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";
import type { ServiceUpdate } from "@/lib/database.types";

// Owner can edit or deactivate a service (is_active = false) - never
// hard-deleted, so historical commission_entries (which snapshot their own
// service_name/price_charged) keep a real service to point at.
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
  const { name, default_price, color, is_active } = body ?? {};

  const update: ServiceUpdate = {};
  if (name !== undefined) {
    if (!name?.trim()) {
      return NextResponse.json({ error: "Service name is required." }, { status: 400 });
    }
    update.name = name.trim();
  }
  if (default_price !== undefined) update.default_price = Number(default_price) || 0;
  if (color !== undefined) update.color = color;
  if (is_active !== undefined) update.is_active = !!is_active;

  const { data, error } = await supabase
    .from("services")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ service: data });
}
