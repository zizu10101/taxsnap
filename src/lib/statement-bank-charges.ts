import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import {
  BANK_CHARGES_KEY,
  resolveBankCharges,
  type BankChargesState,
  type CategoryRow,
} from "./statement-categories.ts";
import { mapsToBuiltInCategory } from "./tax-categories.ts";

// Server-side half of the "bank charges" category (see statement-categories.ts):
// reading the owner's categories, and making sure the keyed row exists when a saved
// statement is about to use it. Relative imports only, so the database test can run
// this exact code. `client` is the caller's own session in the app (RLS scopes it).

export async function loadCategoryRows(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<CategoryRow[]> {
  const { data, error } = await client
    .from("expense_categories")
    .select("name, is_active, system_key")
    .eq("user_id", userId);
  return error ? [] : ((data ?? []) as CategoryRow[]);
}

export type EnsureOutcome = "created" | "keyed" | "none";

// Called before a statement is saved, with the categories its expenses will use.
//  - removed:  never touched. The owner removed it; saving a statement must not bring it back.
//  - virtual:  the built-in "Bank Charges & Interest" - there is no row to create any more.
//  - active:   an unkeyed custom row (not the built-in's own name) gets the key, so it survives a rename.
export async function ensureBankChargesCategory(
  client: SupabaseClient<Database>,
  userId: string,
  usedCategories: (string | null)[],
): Promise<{ outcome: EnsureOutcome; state: BankChargesState }> {
  const rows = await loadCategoryRows(client, userId);
  const state = resolveBankCharges(rows);
  const used = (name: string) => usedCategories.some((c) => c?.trim().toLowerCase() === name.trim().toLowerCase());

  // A row that is just the built-in under its old name ("Bank charges") needs no key: it can not drift.
  if (state.state === "active" && !state.keyed && !mapsToBuiltInCategory(state.name) && used(state.name)) {
    const { error } = await client
      .from("expense_categories")
      .update({ system_key: BANK_CHARGES_KEY })
      .eq("user_id", userId)
      .ilike("name", state.name.trim());
    if (error && error.code !== "23505") throw error;
    return { outcome: error ? "none" : "keyed", state };
  }

  return { outcome: "none", state };
}
