import { mergeCategories } from "./expense-categories.ts";
import { BANK_CHARGES_CATEGORY } from "./statement-lines.ts";

// Categories a statement line can be filed under: the built-in list, the
// owner's own, and "Bank charges" for interest and fees.
//
// "Bank charges" is deliberately NOT added to the global TAX_CATEGORIES list
// while the import is allowlist-only - that list feeds the receipt scanner's
// category enum for every user. Instead it is offered here, and committing a
// statement that uses it creates it as one of the owner's own categories (see
// the commit route), which is also what keeps resolveCategory() from turning it
// into "Other" the next time the expense is edited.
export function statementCategoryOptions(customNames: string[]): string[] {
  const merged = mergeCategories(customNames);
  const has = merged.some((c) => c.toLowerCase() === BANK_CHARGES_CATEGORY.toLowerCase());
  return has ? merged : [...merged, BANK_CHARGES_CATEGORY];
}

// The canonical spelling of `value` from `options`, or null if it isn't one.
export function resolveStatementCategory(value: unknown, options: string[]): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const key = value.trim().toLowerCase();
  return options.find((o) => o.toLowerCase() === key) ?? null;
}
