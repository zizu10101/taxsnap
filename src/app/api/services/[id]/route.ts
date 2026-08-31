import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { wouldExceedFreeTierActiveLimit } from "@/lib/free-tier-limits";
import type { ServiceUpdate } from "@/lib/database.types";

// Owner can edit or deactivate a service (is_active = false) - never
// hard-deleted, so historical commission_entries (which snapshot their own
// service_name/price_charged) keep a real service to point at.
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
  const { name, default_price, color, is_active } = body ?? {};

  // Only checked when this PATCH would *increase* the active count
  // (reactivating a previously-deactivated service) - editing name/price/
  // color, or deactivating, never needs the cap. Without this, a free
  // account could exceed the 1-active limit by deactivating then
  // reactivating rows instead of ever using the "add" flow twice.
  if (is_active === true) {
    if (await wouldExceedFreeTierActiveLimit(supabase, user.id, "services", id)) {
      return NextResponse.json(
        {
          error: "Free accounts can have 1 active service. Upgrade to Pro to add more.",
          code: "FREE_LIMIT_REACHED",
        },
        { status: 403 },
      );
    }
  }

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
