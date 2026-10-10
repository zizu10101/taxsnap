import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { wouldExceedActiveLimit, limitReachedMessage } from "./plan-limits.ts";
import { normalizeUnit, readLineLabels, unitError } from "./line-format.ts";

export interface LineItemResult {
  status: number;
  body: Record<string, unknown>;
}

export const QUANTITY_MESSAGE = "Quantity must be greater than 0.";

/**
 * Reads the optional `quantity` of a request body. `undefined` means "not
 * sent" (the column's default of 1 applies); anything else must be a number
 * above zero.
 */
export function parseQuantity(value: unknown): { quantity?: number } | { error: string } {
  if (value === undefined || value === null || value === "") return {};
  const q = Number(value);
  if (!Number.isFinite(q) || q <= 0) return { error: QUANTITY_MESSAGE };
  return { quantity: Math.round(q * 100) / 100 };
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
    quantity?: unknown;
  };
  const { unit_price, quantity: rawQuantity } = input;

  // An older caller that sends only `description` is read as name = description (same as an old row).
  const labels = readLineLabels(input);
  if (!labels) {
    return { status: 400, body: { error: "Item name is required." } };
  }
  const unitProblem = unitError(input.unit);
  if (unitProblem) return { status: 400, body: { error: unitProblem } };

  const parsed = parseQuantity(rawQuantity);
  if ("error" in parsed) return { status: 400, body: { error: parsed.error } };

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

  // Needs migrations 0059 (line_items.quantity) and 0061 (name, unit), applied BEFORE this ships.
  const { data, error } = await supabase
    .from("line_items")
    .insert({ ...row, ...(parsed.quantity !== undefined ? { quantity: parsed.quantity } : {}) })
    .select()
    .single();

  if (error) return { status: 500, body: { error: error.message } };
  return { status: 201, body: { lineItem: data } };
}
