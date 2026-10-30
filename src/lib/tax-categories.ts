// The built-in expense categories, their input-tax-credit defaults, and the ONE function
// (canonicalCategory) that maps any stored category name onto them.
//
// receipts.tax_category, expense_templates.default_tax_category and statement lines store the category
// as plain text, and rows saved before this list was simplified still carry the old names ("Job
// Materials", "Gas", "407", ...). Nothing rewrites them. Instead every place that groups, filters,
// defaults or exports by category calls canonicalCategory() first, so an old row and a new row for the
// same thing are always one category. Pure, with no imports, so it unit-tests directly.

export const MEALS_ITC_RESTRICTION_RATE = 0.5;

export const TAX_CATEGORIES = [
  "Materials & Supplies",
  "Inventory",
  "Subcontractors",
  "Tools & Equipment",
  "Capital Assets",
  "Vehicle & Fuel",
  "Travel & Accommodation",
  "Meals & Entertainment",
  "Rent & Utilities",
  "Phone & Internet",
  "Office & Admin",
  "Software & Website",
  "Advertising & Promotion",
  "Professional Fees",
  "Licenses, Permits & Training",
  "Insurance",
  "Wages & Payroll",
  "Bank Charges & Interest",
  "Other",
] as const;

export type TaxCategory = (typeof TAX_CATEGORIES)[number];

export const OTHER_CATEGORY: TaxCategory = "Other";
export const MEALS_CATEGORY: TaxCategory = "Meals & Entertainment";
export const BANK_CHARGES_CATEGORY: TaxCategory = "Bank Charges & Interest";

// How a built-in category is treated for tax. Same three words as the owner's tax-code picker
// (tax-codes.ts TAX_CODES: taxable = 13% fully claimable, meals = 13% with 50% claimable, none = no tax
// and no ITC). `null` = no default: the owner picks a code on the line ("Other").
export type CategoryCodeKey = "taxable" | "meals" | "none";

interface CategoryInfo {
  /**
   * Hidden bookkeeping account number. Never shown in the UI and not used by any export format yet.
   * BEST EFFORT, read off the accountant's guide: every number here needs his confirmation, and the
   * guide uses 6350 twice (here it is Travel & Accommodation; Vehicle & Fuel got 6353).
   */
  accountCode: string | null;
  defaultCode: CategoryCodeKey | null;
  /** Share of the sales tax in the price that is claimable when the row has no tax code of its own. */
  itcRate: number;
  /** Share of the expense that is deductible when the row has no tax code of its own. */
  deductibleRate: number;
}

const FULL = { defaultCode: "taxable", itcRate: 1, deductibleRate: 1 } as const;
// Insurance, wages and bank charges carry no HST, so there is no ITC to claim - but the spending is
// still fully deductible for income tax, which is why this only zeroes the ITC rate.
const NO_ITC = { defaultCode: "none", itcRate: 0, deductibleRate: 1 } as const;

export const CATEGORY_INFO: Record<TaxCategory, CategoryInfo> = {
  "Materials & Supplies": { accountCode: "5400", ...FULL },
  Inventory: { accountCode: null, ...FULL },
  Subcontractors: { accountCode: "5200", ...FULL },
  "Tools & Equipment": { accountCode: "5300", ...FULL },
  "Capital Assets": { accountCode: "1530", ...FULL },
  // NOTE for the accountant: ITC on a passenger vehicle, and on a vehicle that is also used
  // personally, can be limited (CCA/ITC restrictions, personal-use portion). This treats every
  // vehicle and fuel purchase as fully claimable until he confirms how it should be handled.
  "Vehicle & Fuel": { accountCode: "6353", ...FULL },
  "Travel & Accommodation": { accountCode: "6350", ...FULL },
  "Meals & Entertainment": {
    accountCode: "6300",
    defaultCode: "meals",
    itcRate: MEALS_ITC_RESTRICTION_RATE,
    deductibleRate: MEALS_ITC_RESTRICTION_RATE,
  },
  "Rent & Utilities": { accountCode: "6700", ...FULL },
  "Phone & Internet": { accountCode: "6800", ...FULL },
  "Office & Admin": { accountCode: "6600", ...FULL },
  "Software & Website": { accountCode: "6810", ...FULL },
  "Advertising & Promotion": { accountCode: "6500", ...FULL },
  "Professional Fees": { accountCode: "6900", ...FULL },
  "Licenses, Permits & Training": { accountCode: "5100", ...FULL },
  Insurance: { accountCode: "6910", ...NO_ITC },
  "Wages & Payroll": { accountCode: "5500", ...NO_ITC },
  "Bank Charges & Interest": { accountCode: "6930", ...NO_ITC },
  Other: { accountCode: null, defaultCode: null, itcRate: 1, deductibleRate: 1 },
};

// Old built-in names (and the stock custom "Bank charges") -> the category that replaced them.
// Keys are lower case; lookups are case-insensitive.
export const LEGACY_CATEGORY_ALIASES: Readonly<Record<string, TaxCategory>> = {
  "job materials": "Materials & Supplies",
  supplies: "Materials & Supplies",
  inventory: "Inventory",
  "tools & equipment": "Tools & Equipment",
  "vehicle/fuel": "Vehicle & Fuel",
  gas: "Vehicle & Fuel",
  "407": "Vehicle & Fuel",
  lease: "Rent & Utilities",
  rent: "Rent & Utilities",
  phone: "Phone & Internet",
  internet: "Phone & Internet",
  "office/admin": "Office & Admin",
  advertising: "Advertising & Promotion",
  meals: "Meals & Entertainment",
  insurance: "Insurance",
  other: "Other",
  // The custom category statement import used to create for interest and fees. It is now the built-in.
  "bank charges": "Bank Charges & Interest",
};

const BUILT_IN_BY_KEY = new Map<string, TaxCategory>(TAX_CATEGORIES.map((c) => [c.toLowerCase(), c]));

const keyOf = (name: string) => name.trim().toLowerCase();

// THE category normalizer. A built-in name (any case) or a legacy alias becomes the built-in's exact
// spelling; an empty value becomes "Other"; anything else - an owner's own custom category - comes back
// trimmed and otherwise untouched. Use this before grouping, filtering, comparing, defaulting or
// exporting by category; do not compare raw tax_category strings.
export function canonicalCategory(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return OTHER_CATEGORY;
  const key = keyOf(trimmed);
  return BUILT_IN_BY_KEY.get(key) ?? LEGACY_CATEGORY_ALIASES[key] ?? trimmed;
}

export function isBuiltInCategory(name: string): name is TaxCategory {
  return BUILT_IN_BY_KEY.has(keyOf(name));
}

// True for a built-in's own name or anything that maps onto one (old names, the stock "Bank charges").
export function mapsToBuiltInCategory(name: string): boolean {
  return isBuiltInCategory(canonicalCategory(name));
}

// Lower-case grouping key: two spellings of one category share it.
export function categoryGroupKey(name: string | null | undefined): string {
  return canonicalCategory(name).toLowerCase();
}

export function sameCategory(a: string | null | undefined, b: string | null | undefined): boolean {
  return categoryGroupKey(a) === categoryGroupKey(b);
}

function infoFor(name: string | null | undefined): CategoryInfo | null {
  const canonical = canonicalCategory(name);
  return isBuiltInCategory(canonical) ? CATEGORY_INFO[canonical] : null;
}

// What a row with no tax code of its own is read with. An owner's custom category is always 100%.
export function categoryItcRate(name: string | null | undefined): number {
  return infoFor(name)?.itcRate ?? 1;
}

export function categoryDeductibleRate(name: string | null | undefined): number {
  return infoFor(name)?.deductibleRate ?? 1;
}

export function categoryDefaultCode(name: string | null | undefined): CategoryCodeKey | null {
  return infoFor(name)?.defaultCode ?? null;
}

export function categoryAccountCode(name: string | null | undefined): string | null {
  return infoFor(name)?.accountCode ?? null;
}

export const isMealsCategory = (name: string | null | undefined) => canonicalCategory(name) === MEALS_CATEGORY;
