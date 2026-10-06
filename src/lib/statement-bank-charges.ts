import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import {
  BANK_CHARGES_KEY,
  resolveBankCharges,
  type BankChargesState,
  type CategoryRow,
} from "./statement-categories.ts";

// Server-side half of the "bank charges" category (see statement-categories.ts):
// reading the owner's categories, and making sure the keyed row exists when a saved
// statement is about to use it. Relative imports only, so the database test can run
// this exact code. `client` is the caller's own session in the app (RLS scopes it).

// 42703 = "column does not exist": migration 0055 (system_key) isn't applied yet, so
// fall back to the name-only behaviour rather than failing.
function isMissingColumn(error: { code?: string } | null): boolean {
  return error?.code === "42703";
}

export async function loadCategoryRows(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<CategoryRow[]> {
  const withKey = await client
    .from("expense_categories")
    .select("name, is_active, system_key")
    .eq("user_id", userId);
  if (!withKey.error) return (withKey.data ?? []) as CategoryRow[];
  if (!isMissingColumn(withKey.error)) return [];

  const plain = await client.from("expense_categories").select("name, is_active").eq("user_id", userId);
  return (plain.data ?? []) as CategoryRow[];
}

export type EnsureOutcome = "created" | "keyed" | "none";

// Called before a statement is saved, with the categories its expenses will use.
//  - removed:  never touched. The owner removed it; saving a statement must not bring it back.
//  - virtual:  created (and keyed) only if a line actually uses it - never speculatively.
//  - active:   an unkeyed one found by its default name gets the key, so it survives a rename.
export async function ensureBankChargesCategory(
  client: SupabaseClient<Database>,
  userId: string,
  usedCategories: (string | null)[],
): Promise<{ outcome: EnsureOutcome; state: BankChargesState }> {
  const rows = await loadCategoryRows(client, userId);
  const state = resolveBankCharges(rows);
  const used = (name: string) => usedCategories.some((c) => c?.trim().toLowerCase() === name.trim().toLowerCase());

  if (state.state === "virtual" && used(state.name)) {
    let { error } = await client
      .from("expense_categories")
      .insert({ user_id: userId, name: state.name, system_key: BANK_CHARGES_KEY });
    if (isMissingColumn(error)) {
      ({ error } = await client.from("expense_categories").insert({ user_id: userId, name: state.name }));
    }
    // 23505: it appeared in the meantime (another tab saving at the same moment) - fine.
    if (error && error.code !== "23505") throw error;
    return { outcome: "created", state };
  }

  if (state.state === "active" && !state.keyed && used(state.name)) {
    const { error } = await client
      .from("expense_categories")
      .update({ system_key: BANK_CHARGES_KEY })
      .eq("user_id", userId)
      .ilike("name", state.name.trim());
    if (error && !isMissingColumn(error) && error.code !== "23505") throw error;
    return { outcome: error ? "none" : "keyed", state };
  }

  return { outcome: "none", state };
}
