import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { wouldExceedActiveLimit, limitReachedMessage } from "./plan-limits.ts";
import { normalizeUnit, readLineLabels, unitError } from "./line-format.ts";

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
  const input = (body ?? {}) as {
    name?: unknown;
    description?: unknown;
    unit?: unknown;
    unit_price?: unknown;
  };
  // A `quantity` in the body (an old tab) is ignored: a saved item never stores one.
  const { unit_price } = input;

  // An older caller that sends only `description` is read as name = description (same as an old row).
  const labels = readLineLabels(input);
  if (!labels) {
    return { status: 400, body: { error: "Item name is required." } };
  }
  const unitProblem = unitError(input.unit);
  if (unitProblem) return { status: 400, body: { error: unitProblem } };

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

  const row = {
    user_id: userId,
    name: labels.name,
    description: labels.description,
    unit: normalizeUnit(input.unit),
    unit_price: Number(unit_price) || 0,
  };

  // Needs migration 0061 (name, unit), applied BEFORE this ships. quantity is never written (the
  // 0059 column keeps its default of 1 / old values, which nothing reads).
  const { data, error } = await supabase
    .from("line_items")
    .insert(row)
    .select()
    .single();

  if (error) return { status: 500, body: { error: error.message } };
  return { status: 201, body: { lineItem: data } };
}
