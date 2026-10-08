import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { wouldExceedActiveLimit, limitReachedMessage } from "./plan-limits.ts";

export interface LineItemResult {
  status: number;
  body: Record<string, unknown>;
}

// The body of POST /api/line-items, taking the caller's own (RLS-scoped)
// client so it runs the same in the route and in the real-database test
// (same shape as handleBulkCategory).
export async function createLineItem(
  supabase: SupabaseClient<Database>,
  userId: string,
  body: unknown,
): Promise<LineItemResult> {
  const { description, unit_price } = (body ?? {}) as {
    description?: string;
    unit_price?: unknown;
  };

  if (!description?.trim()) {
    return { status: 400, body: { error: "Item description is required." } };
  }

  // Every tier gets a capped number of active saved items (see
  // src/lib/plan-limits.ts) - a new item always inserts as active, so
  // this is checked unconditionally here, same as services' own POST.
  const activeCheck = await wouldExceedActiveLimit(supabase, userId, "lineItems");
  if (activeCheck.exceeded) {
    return {
      status: 403,
      body: {
        error: limitReachedMessage(activeCheck, "active saved item"),
        code: "FREE_LIMIT_REACHED",
      },
    };
  }

  const { data, error } = await supabase
    .from("line_items")
    .insert({
      user_id: userId,
      description: description.trim(),
      unit_price: Number(unit_price) || 0,
    })
    .select()
    .single();

  if (error) return { status: 500, body: { error: error.message } };
  return { status: 201, body: { lineItem: data } };
}
