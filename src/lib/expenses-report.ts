import { cleanMerchantName, vendorKey } from "./merchant-name.ts";
import { TAX_CATEGORIES } from "./tax-categories.ts";

// The Reports "Expenses" tab: one set of receipts for the period, grouped by
// category (the default) or by vendor, with an optional vendor filter and an
// optional category filter that combine. Pure: the caller hands in the receipts
// already read for the date range (receipts and statement-imported expenses are
// the same table, so a deleted expense is simply not in the list - the same rows
// as the Expenses tab). Vendors are grouped with vendorKey, the one normalizer
// the duplicate check and the statement matcher use, so "HOME DEPOT #4521" and
// "Home Depot" are one vendor.

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface ExpenseInput {
  id: string;
  merchant_name: string;
  transaction_date: string;
  tax_category: string | null;
  total_amount: number;
  tax_amount: number;
}

export interface VendorExpenseRow {
  id: string;
  date: string;
  merchant: string;
  category: string;
  subtotal: number;
  tax: number;
  total: number;
}

export interface VendorRow {
  key: string;
  name: string;
  count: number;
  // total_amount minus tax_amount; the tax embedded in the price; total as paid.
  subtotal: number;
  tax: number;
  total: number;
  // Fraction (0.25 = 25%) of the report's total; 0 when that total is 0.
  share: number;
  expenses: VendorExpenseRow[];
}

export interface CategoryRow {
  category: string;
  count: number;
  // total_amount minus tax_amount, and total_amount as paid.
  preTax: number;
  total: number;
  // False for built-in categories; true for owner-added ones (shown with a
  // marker). Also true for a category whose custom definition was removed.
  isCustom: boolean;
}

export interface ExpensesReportFilters {
  // A vendor key (VendorRow.key / VendorOption.key), or null/undefined for all.
  vendor?: string | null;
  // A category name (matched case-insensitively), or null/undefined for all.
  category?: string | null;
}

export interface VendorOption {
  key: string;
  name: string;
}

export interface ExpensesReport {
  vendors: VendorRow[];
  categories: CategoryRow[];
  // Follows the filters, whichever grouping is shown.
  totals: { count: number; subtotal: number; tax: number; total: number };
  // Every vendor / category present in the period, BEFORE the filters, for the pickers.
  vendorOptions: VendorOption[];
  categoryOptions: string[];
}

export const NO_VENDOR_KEY = "__no_vendor__";
export const NO_VENDOR_NAME = "No vendor name";

function categoryKey(raw: string | null | undefined): string {
  return (raw?.trim() || "Other").toLowerCase();
}

function vendorKeyOf(merchant: string): string {
  return vendorKey(merchant) ?? NO_VENDOR_KEY;
}

// "Home Depot #4521" -> "Home Depot": the store number is part of the receipt,
// not of the vendor's name.
function displayFor(raw: string): string {
  const cleaned = cleanMerchantName(raw)
    .replace(/#\s*\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || raw.trim();
}

// Grouped case-insensitively onto the canonical spelling (a built-in's, else
// the custom category's) so "meals" and "Meals" never split into two rows. A
// category with spend always appears, even if it has since been removed.
export function buildCategoryRows(
  receipts: Pick<ExpenseInput, "tax_category" | "total_amount" | "tax_amount">[],
  customCategoryNames: string[] = [],
): CategoryRow[] {
  const canonical = new Map<string, string>();
  for (const c of TAX_CATEGORIES) canonical.set(c.toLowerCase(), c);
  for (const name of customCategoryNames) {
    const key = name.trim().toLowerCase();
    if (!canonical.has(key)) canonical.set(key, name.trim());
  }
  const grouped = new Map<string, CategoryRow>();
  for (const r of receipts) {
    const key = categoryKey(r.tax_category);
    const row = grouped.get(key) ?? {
      category: canonical.get(key) ?? (r.tax_category?.trim() || "Other"),
      count: 0,
      preTax: 0,
      total: 0,
      isCustom: !TAX_CATEGORIES.some((c) => c.toLowerCase() === key),
    };
    row.count += 1;
    row.preTax += r.total_amount - r.tax_amount;
    row.total += r.total_amount;
    grouped.set(key, row);
  }
  return [...grouped.values()]
    .map((r) => ({ ...r, preTax: round2(r.preTax), total: round2(r.total) }))
    .sort((a, b) => b.total - a.total);
}

export function buildExpensesReport(
  expenses: ExpenseInput[],
  filters: ExpensesReportFilters = {},
  customCategoryNames: string[] = [],
): ExpensesReport {
  // One display name per vendor, from ALL the period's expenses, so a filter
  // never renames a row. Most common spelling wins; ties go alphabetically.
  const spellings = new Map<string, Map<string, number>>();
  for (const e of expenses) {
    const key = vendorKeyOf(e.merchant_name);
    const shown = key === NO_VENDOR_KEY ? NO_VENDOR_NAME : displayFor(e.merchant_name);
    const tally = spellings.get(key) ?? new Map<string, number>();
    tally.set(shown, (tally.get(shown) ?? 0) + 1);
    spellings.set(key, tally);
  }
  const nameOf = new Map<string, string>();
  for (const [key, tally] of spellings) {
    nameOf.set(key, [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]);
  }
  const vendorOptions: VendorOption[] = [...nameOf.entries()]
    .map(([key, name]) => ({ key, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Canonical category spelling, same rule as the category rows.
  const canonicalCategory = new Map(
    buildCategoryRows(expenses, customCategoryNames).map((r) => [r.category.toLowerCase(), r.category]),
  );
  const categoryName = (raw: string | null | undefined) =>
    canonicalCategory.get(categoryKey(raw)) ?? (raw?.trim() || "Other");
  const categoryOptions = [...canonicalCategory.values()].sort((a, b) => a.localeCompare(b));

  const wantedVendor = filters.vendor || null;
  const wantedCategory = filters.category?.trim() ? filters.category.trim().toLowerCase() : null;
  const kept = expenses.filter(
    (e) =>
      (wantedVendor === null || vendorKeyOf(e.merchant_name) === wantedVendor) &&
      (wantedCategory === null || categoryKey(e.tax_category) === wantedCategory),
  );

  const groups = new Map<string, VendorExpenseRow[]>();
  for (const e of kept) {
    const key = vendorKeyOf(e.merchant_name);
    const rows = groups.get(key) ?? [];
    rows.push({
      id: e.id,
      date: e.transaction_date,
      merchant: e.merchant_name,
      category: categoryName(e.tax_category),
      subtotal: round2(e.total_amount - e.tax_amount),
      tax: round2(e.tax_amount),
      total: round2(e.total_amount),
    });
    groups.set(key, rows);
  }

  const grandTotal = round2(kept.reduce((s, e) => s + e.total_amount, 0));

  const vendors: VendorRow[] = [...groups.entries()].map(([key, rows]) => {
    const total = round2(rows.reduce((s, r) => s + r.total, 0));
    return {
      key,
      name: nameOf.get(key) ?? NO_VENDOR_NAME,
      count: rows.length,
      subtotal: round2(rows.reduce((s, r) => s + r.subtotal, 0)),
      tax: round2(rows.reduce((s, r) => s + r.tax, 0)),
      total,
      share: grandTotal === 0 ? 0 : Math.round((total / grandTotal) * 10000) / 10000,
      expenses: rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    };
  });
  vendors.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  return {
    vendors,
    categories: buildCategoryRows(kept, customCategoryNames),
    totals: {
      count: kept.length,
      subtotal: round2(vendors.reduce((s, v) => s + v.subtotal, 0)),
      tax: round2(vendors.reduce((s, v) => s + v.tax, 0)),
      total: grandTotal,
    },
    vendorOptions,
    categoryOptions,
  };
}
