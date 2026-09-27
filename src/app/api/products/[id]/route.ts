import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { wouldExceedActiveLimit, limitReachedMessage } from "@/lib/plan-limits";
import type { ProductUpdate } from "@/lib/database.types";

// Owner can edit or deactivate a product (is_active = false) - never
// hard-deleted, so a past sale's own register_transaction_products row
// (which snapshots product_name/price_charged) keeps a real product to
// point at. Same pattern as PATCH /api/services/[id].
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
  const { name, default_price, is_active } = body ?? {};

  // Only checked when this PATCH would *increase* the active count
  // (reactivating a previously-deactivated product) - same reasoning as
  // the services route's own check.
  if (is_active === true) {
    const activeCheck = await wouldExceedActiveLimit(supabase, user.id, "products", id);
    if (activeCheck.exceeded) {
      return NextResponse.json(
        {
          error: limitReachedMessage(activeCheck, "active product"),
          code: "FREE_LIMIT_REACHED",
        },
        { status: 403 },
      );
    }
  }

  const update: ProductUpdate = {};
  if (name !== undefined) {
    if (!name?.trim()) {
      return NextResponse.json({ error: "Product name is required." }, { status: 400 });
    }
    update.name = name.trim();
  }
  if (default_price !== undefined) update.default_price = Number(default_price) || 0;
  if (is_active !== undefined) update.is_active = !!is_active;

  const { data, error } = await supabase
    .from("products")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ product: data });
}
