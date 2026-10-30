import { mergeCategories } from "./expense-categories.ts";
import { BANK_CHARGES_CATEGORY, canonicalCategory, mapsToBuiltInCategory } from "./tax-categories.ts";

// Categories a statement line can be filed under: the built-in list, the owner's own,
// and - for interest and fees - their "bank charges" category.
//
// "Bank Charges & Interest" is now a BUILT-IN category (tax-categories.ts), and the old custom
// "Bank charges" this file used to create is an alias of it: it is offered once, under the built-in
// name, and never created again. What follows still applies to an owner who has that custom row
// and RENAMED it to something of their own ("Bank fees"): it stays their category and import keeps
// finding it by key. (The notes below describe how that row used to work.)
//
// That one is special. It is an ordinary custom category of the owner's (they can rename
// it, remove it, see it in reports) but statement import has to find it again on every
// import. It used to do that BY NAME, so renaming it to "Bank fees" made the next import
// create a second "Bank charges", and removing it made the next import bring it back.
// Now the row is found by a stable key (expense_categories.system_key = 'bank_charges',
// migration 0055), so what the owner calls it is up to them:
//   - renamed  -> the import keeps using it, under its new name;
//   - removed  -> respected: nothing is suggested for fees and interest, and the import
//                 never recreates or reactivates it (Restore in Settings brings it back);
//   - never created yet -> offered under the default name and created, keyed, the first
//                 time a saved statement actually uses it.
//

export const BANK_CHARGES_KEY = "bank_charges";
export const BANK_CHARGES_DEFAULT_NAME = "Bank charges";

export interface CategoryRow {
  name: string;
  is_active: boolean;
  /** Absent until migration 0055 is applied; then 'bank_charges' on the one keyed row. */
  system_key?: string | null;
}

export type BankChargesState =
  /** Exists and is in use. `keyed` is false for a row found only by its default name. */
  | { state: "active"; name: string; keyed: boolean }
  /** Doesn't exist yet: offered under the default name, created when first used. */
  | { state: "virtual"; name: string }
  /** The owner removed it: never suggested, never recreated. */
  | { state: "removed" };

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// A row still named "Bank charges" IS the built-in now; a renamed one keeps its own name.
const shownName = (name: string) => (mapsToBuiltInCategory(name) ? canonicalCategory(name) : name.trim());

export function resolveBankCharges(rows: CategoryRow[]): BankChargesState {
  // By key first: it survives a rename. A same-named decoy the owner made after
  // renaming the real one is just an ordinary category.
  const keyed = rows.find((r) => r.system_key === BANK_CHARGES_KEY);
  if (keyed) return keyed.is_active ? { state: "active", name: shownName(keyed.name), keyed: true } : { state: "removed" };

  // No keyed row (not migrated yet, or created by hand): adopt a category with the
  // default name, so an existing owner isn't given a duplicate.
  const named = rows.find((r) => sameName(r.name, BANK_CHARGES_DEFAULT_NAME));
  if (named) return named.is_active ? { state: "active", name: shownName(named.name), keyed: false } : { state: "removed" };

  // Nothing of the owner's: the built-in, which needs no row (so nothing is created for it).
  return { state: "virtual", name: BANK_CHARGES_CATEGORY };
}

/** The category interest and fees are suggested under, or null if there isn't one to suggest. */
export function bankChargesSuggestion(state: BankChargesState): string | null {
  return state.state === "removed" ? null : state.name;
}

// Built-ins, the owner's ACTIVE custom categories, and the default bank-charges name
// when that category doesn't exist yet. A removed one is not offered.
export function statementCategoryOptions(rows: CategoryRow[]): string[] {
  const merged = mergeCategories(rows.filter((r) => r.is_active).map((r) => r.name));
  const bank = resolveBankCharges(rows);
  if (bank.state === "virtual" && !merged.some((c) => sameName(c, bank.name))) merged.push(bank.name);
  return merged;
}

// The canonical spelling of `value` from `options`, or null if it isn't one.
export function resolveStatementCategory(value: unknown, options: string[]): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const key = value.trim().toLowerCase();
  return options.find((o) => o.toLowerCase() === key) ?? null;
}
