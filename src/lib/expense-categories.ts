import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { TAX_CATEGORIES } from "./tax-categories.ts";

// Owner-added categories are merged with the fixed TAX_CATEGORIES list at
// display time and never touch it - that list also feeds Gemini's response
// enum, the HST calculator and deductibleRate() (which special-cases "Meals"
// by name), so custom names are always extra choices on top, never a
// replacement. A custom category gets the default 100% deductible rate.
export function isDefaultCategory(name: string): boolean {
  const key = name.trim().toLowerCase();
  return TAX_CATEGORIES.some((c) => c.toLowerCase() === key);
}

// Defaults first (fixed order), then custom names alphabetically, skipping
// anything that collides with a default or an earlier custom name
// (case-insensitively).
export function mergeCategories(customNames: string[]): string[] {
  const seen = new Set<string>(TAX_CATEGORIES.map((c) => c.toLowerCase()));
  const extras: string[] = [];
  for (const name of [...customNames].sort((a, b) => a.localeCompare(b))) {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    extras.push(name.trim());
  }
  return [...TAX_CATEGORIES, ...extras];
}

// Server-side counterpart of the old `TAX_CATEGORIES.includes(x) ? x :
// "Other"` check in the receipts routes: a default passes through, so does
// any custom category this user owns (active or not - editing an old receipt
// whose category was later deactivated must keep it), anything else
// collapses to "Other".
export async function resolveCategory(
  supabase: SupabaseClient<Database>,
  userId: string,
  value: unknown,
): Promise<string> {
  if (typeof value !== "string" || !value.trim()) return "Other";
  const trimmed = value.trim();
  const defaultMatch = TAX_CATEGORIES.find((c) => c.toLowerCase() === trimmed.toLowerCase());
  if (defaultMatch) return defaultMatch;

  const { data } = await supabase
    .from("expense_categories")
    .select("name")
    .eq("user_id", userId);
  const custom = (data ?? []).find((c) => c.name.trim().toLowerCase() === trimmed.toLowerCase());
  return custom ? custom.name : "Other";
}
