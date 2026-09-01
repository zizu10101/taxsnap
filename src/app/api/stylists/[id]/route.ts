import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { toTitleCase } from "@/lib/format-name";
import { STYLIST_PUBLIC_COLUMNS } from "@/lib/stylist-columns";
import { wouldExceedFreeTierActiveLimit } from "@/lib/free-tier-limits";
import type { StylistUpdate } from "@/lib/database.types";

// Owner can edit or deactivate a stylist (is_active = false) - never
// hard-deleted, so historical commission_entries always keep a real
// stylist to point at (same reasoning as employees.is_active).
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
  const { name, pay_type, commission_rate, is_active } = body ?? {};

  // Same reactivation-cap reasoning as services/[id] - only checked when
  // this PATCH would increase the active count.
  if (is_active === true) {
    if (await wouldExceedFreeTierActiveLimit(supabase, user.id, "stylists", id)) {
      return NextResponse.json(
        {
          error: "Free accounts can have 1 active stylist. Upgrade to Pro to add more.",
          code: "FREE_LIMIT_REACHED",
        },
        { status: 403 },
      );
    }
  }

  const update: StylistUpdate = {};
  if (name !== undefined) {
    if (!name?.trim()) {
      return NextResponse.json({ error: "Stylist name is required." }, { status: 400 });
    }
    update.name = toTitleCase(name);
  }
  // Commission-only for now (see api/stylists/route.ts POST) - the DB
  // column still allows 'hourly'/'salary' for forward-compat, but there's
  // no client UI or payout logic behind them, so this rejects any attempt
  // to set a value other than the one real option.
  if (pay_type !== undefined) {
    if (pay_type !== "commission") {
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
    .select(STYLIST_PUBLIC_COLUMNS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ stylist: data });
}
