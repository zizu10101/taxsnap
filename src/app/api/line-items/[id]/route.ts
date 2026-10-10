import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { wouldExceedActiveLimit, limitReachedMessage } from "@/lib/plan-limits";
import type { LineItemUpdate } from "@/lib/database.types";
import { parseQuantity } from "@/lib/line-items-server";
import { normalizeUnit, readLineLabels, unitError } from "@/lib/line-format";

// Owner can edit or deactivate a saved item (is_active = false) - never
// hard-deleted, same reasoning/shape as PATCH /api/services/[id]: a
// deactivated item just stops being offered in the invoice builder's
// picker without losing it, and can be reactivated later.
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
  const { name, description, unit, unit_price, quantity: rawQuantity, is_active } = body ?? {};

  // Only checked when this PATCH would *increase* the active count
  // (reactivating a previously-deactivated item) - editing description/
  // price, or deactivating, never needs the cap. Same reasoning as
  // services' own PATCH: without this, a free account could exceed its
  // 1-active limit by deactivating then reactivating instead of ever
  // using the "add" flow twice.
  if (is_active === true) {
    const activeCheck = await wouldExceedActiveLimit(supabase, user.id, "lineItems", id);
    if (activeCheck.exceeded) {
      return NextResponse.json(
        {
          error: limitReachedMessage(activeCheck, "active saved item"),
          code: "FREE_LIMIT_REACHED",
        },
        { status: 403 },
      );
    }
  }

  const update: LineItemUpdate = {};
  // The editor always sends name + description together (a saved item is edited as a whole); an older
  // caller that sends only `description` is read as name = description.
  if (name !== undefined || description !== undefined) {
    const labels = readLineLabels({ name, description });
    if (!labels) {
      return NextResponse.json({ error: "Item name is required." }, { status: 400 });
    }
    update.name = labels.name;
    update.description = labels.description;
  }
  if (unit !== undefined) {
    const problem = unitError(unit);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    update.unit = normalizeUnit(unit);
  }
  if (unit_price !== undefined) update.unit_price = Number(unit_price) || 0;
  if (is_active !== undefined) update.is_active = !!is_active;

  const parsedQuantity = parseQuantity(rawQuantity);
  if ("error" in parsedQuantity) {
    return NextResponse.json({ error: parsedQuantity.error }, { status: 400 });
  }
  // Needs migration 0059 (line_items.quantity), applied BEFORE this ships.
  if (parsedQuantity.quantity !== undefined) update.quantity = parsedQuantity.quantity;

  const { data, error } = await supabase
    .from("line_items")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lineItem: data });
}
