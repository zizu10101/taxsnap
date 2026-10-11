import { cleanMerchantName, vendorKey } from "./merchant-name.ts";

// Expenses by vendor. Pure: the caller hands in the receipts already read for
// the period (receipts and statement-imported expenses are the same table, so a
// deleted expense is simply not in the list - same rows as the Expenses tab).
// Vendors are grouped with vendorKey, the one normalizer the duplicate check
// and the statement matcher use, so "HOME DEPOT #4521" and "Home Depot" are one.

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface VendorExpenseInput {
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

export interface VendorReport {
  vendors: VendorRow[];
  totals: { count: number; subtotal: number; tax: number; total: number };
  // Every category present in the period (before the category filter), for the picker.
  categories: string[];
}

export const NO_VENDOR_KEY = "__no_vendor__";
export const NO_VENDOR_NAME = "No vendor name";

function categoryName(raw: string | null | undefined): string {
  return raw?.trim() || "Other";
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

export function buildVendorReport(
  expenses: VendorExpenseInput[],
  category?: string | null,
): VendorReport {
  const categoryByKey = new Map<string, string>();
  for (const e of expenses) {
    const name = categoryName(e.tax_category);
    const k = name.toLowerCase();
    if (!categoryByKey.has(k)) categoryByKey.set(k, name);
  }
  const categories = [...categoryByKey.values()].sort((a, b) => a.localeCompare(b));

  const wanted = category?.trim() ? category.trim().toLowerCase() : null;
  const kept = expenses.filter(
    (e) => wanted === null || categoryName(e.tax_category).toLowerCase() === wanted,
  );

  const groups = new Map<string, { names: Map<string, number>; rows: VendorExpenseRow[] }>();
  for (const e of kept) {
    const key = vendorKey(e.merchant_name) ?? NO_VENDOR_KEY;
    const group = groups.get(key) ?? { names: new Map<string, number>(), rows: [] as VendorExpenseRow[] };
    const shown = key === NO_VENDOR_KEY ? NO_VENDOR_NAME : displayFor(e.merchant_name);
    group.names.set(shown, (group.names.get(shown) ?? 0) + 1);
    group.rows.push({
      id: e.id,
      date: e.transaction_date,
      merchant: e.merchant_name,
      category: categoryName(e.tax_category),
      subtotal: round2(e.total_amount - e.tax_amount),
      tax: round2(e.tax_amount),
      total: round2(e.total_amount),
    });
    groups.set(key, group);
  }

  const grandTotal = round2(kept.reduce((s, e) => s + e.total_amount, 0));

  const vendors: VendorRow[] = [...groups.entries()].map(([key, g]) => {
    // Most common spelling wins; ties go to the alphabetically first.
    const name = [...g.names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    const total = round2(g.rows.reduce((s, r) => s + r.total, 0));
    return {
      key,
      name,
      count: g.rows.length,
      subtotal: round2(g.rows.reduce((s, r) => s + r.subtotal, 0)),
      tax: round2(g.rows.reduce((s, r) => s + r.tax, 0)),
      total,
      share: grandTotal === 0 ? 0 : Math.round((total / grandTotal) * 10000) / 10000,
      expenses: g.rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    };
  });
  vendors.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  return {
    vendors,
    totals: {
      count: kept.length,
      subtotal: round2(vendors.reduce((s, v) => s + v.subtotal, 0)),
      tax: round2(vendors.reduce((s, v) => s + v.tax, 0)),
      total: grandTotal,
    },
    categories,
  };
}
