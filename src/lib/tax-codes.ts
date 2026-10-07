// Tax codes for expenses created from a card statement (no receipt in hand yet).
//
// A tax code is THREE numbers, deliberately not merged:
//   tax_rate        how much tax is embedded in the price (13% Ontario HST, or 0)
//   itc_pct         the share of that tax that is claimable as an input tax credit (100, 50, 0)
//   deductible_pct  the share of the expense that is deductible (100, 50)
// Meals is the reason there are three: the tax in the price is still 13%, only half of it is
// claimable, so "meals 50%" cannot be a rate in `total * rate / (1 + rate)`. The tax is EXTRACTED at
// tax_rate, and the claim share is applied when the figures are read - exactly how `tax_amount`
// has always worked for scanned receipts (it stores the full tax printed on the receipt).
//
// "Calculated" vs "confirmed": a statement-created expense with no receipt attached
// (from_statement and no_receipt) carries a CALCULATED tax; anything else - a scanned receipt, an
// attached one, a manually typed expense - is CONFIRMED (the figure came from a document or from the
// owner). Attaching a receipt replaces the calculated figure with the actual one.
//
// A line with NO code calculates nothing: tax_amount stays 0 and it is flagged "needs a tax code".
// There is deliberately no fallback rate - a guess would overclaim. Until the owner's accountant
// supplies a category table, the only defaults are the clear no-tax ones (bank charges, interest and
// fees); everything else needs a code chosen on the line.
//
// Pure, with no imports, so it unit-tests directly and can be shared by the review screen, the
// commit step, the reports and bulk recategorize.

export const MEALS_ITC_RESTRICTION_RATE = 0.5;
export const ONTARIO_HST_RATE = 0.13;

export interface TaxCode {
  tax_rate: number;
  itc_pct: number;
  deductible_pct: number;
}

// The codes an owner can pick on a line. Ontario only for now: the rate is stored on every row, so
// adding provinces later is a new entry here, not a data migration.
export const TAX_CODES = {
  taxable: { tax_rate: ONTARIO_HST_RATE, itc_pct: 1, deductible_pct: 1 },
  meals: { tax_rate: ONTARIO_HST_RATE, itc_pct: MEALS_ITC_RESTRICTION_RATE, deductible_pct: MEALS_ITC_RESTRICTION_RATE },
  none: { tax_rate: 0, itc_pct: 0, deductible_pct: 1 },
} as const satisfies Record<string, TaxCode>;

export type TaxCodeKey = keyof typeof TAX_CODES;
export const TAX_CODE_KEYS = Object.keys(TAX_CODES) as TaxCodeKey[];

export const TAX_CODE_LABELS: Record<TaxCodeKey, string> = {
  taxable: "Taxable - 13% HST, fully claimable",
  meals: "Meals - 13% HST, 50% claimable",
  none: "No tax",
};

export function isTaxCodeKey(value: unknown): value is TaxCodeKey {
  return typeof value === "string" && (TAX_CODE_KEYS as string[]).includes(value);
}

// The named code a stored triple corresponds to (for showing it back), or null for anything else.
export function codeKeyOf(code: TaxCode | null | undefined): TaxCodeKey | null {
  if (!code) return null;
  return (
    TAX_CODE_KEYS.find((k) => {
      const c = TAX_CODES[k];
      return c.tax_rate === code.tax_rate && c.itc_pct === code.itc_pct && c.deductible_pct === code.deductible_pct;
    }) ?? null
  );
}

// Reads the three columns off a row (a receipt or a statement line); null unless ALL three are set
// (the database enforces all-or-none, this is the same rule on the app side).
export function codeFromRow(row: {
  tax_rate?: number | null;
  itc_pct?: number | null;
  deductible_pct?: number | null;
}): TaxCode | null {
  if (row.tax_rate == null || row.itc_pct == null || row.deductible_pct == null) return null;
  return { tax_rate: Number(row.tax_rate), itc_pct: Number(row.itc_pct), deductible_pct: Number(row.deductible_pct) };
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Tax-included: the price already contains the tax, so the tax is total * r / (1 + r). Signed like
// the total (a refund's tax is negative). A zero rate is exactly 0, never -0.
export function calculateTax(total: number, code: TaxCode): number {
  if (!(code.tax_rate > 0)) return 0;
  const sign = total < 0 ? -1 : 1;
  const tax = round2((Math.abs(total) * code.tax_rate) / (1 + code.tax_rate));
  return tax === 0 ? 0 : sign * tax;
}

// ---------------------------------------------------------------------------
// Which code applies to a statement line
// ---------------------------------------------------------------------------
//
// Precedence, most specific first:
//   line          the owner chose a code on this line
//   rule          a saved vendor rule (a later phase - the input is here so the order is fixed now)
//   foreign       a foreign-currency charge: the vendor most likely charged no GST/HST, so no tax
//                 (a vendor rule can still say otherwise, and it outranks this)
//   category      the category's default code (only the no-tax bank charges category is seeded)
//   kind          fees and interest are financial services: no tax
//   (nothing)     no code: calculate nothing, show "needs a tax code"
export type TaxSource = "line" | "rule" | "foreign_currency" | "category" | "kind";
export const TAX_SOURCES: readonly TaxSource[] = ["line", "rule", "foreign_currency", "category", "kind"];

export type CategoryDefaults = ReadonlyMap<string, TaxCode>;

const key = (name: string) => name.trim().toLowerCase();

// Category defaults. Today ONLY the owner's bank charges category (found by its stable key, so a
// rename is followed - see statement-categories.ts) is seeded, as no-tax. Everything else stays
// "no code set" until the accountant's table arrives.
export function buildCategoryDefaults(options: { bankChargesName: string | null }): CategoryDefaults {
  const map = new Map<string, TaxCode>();
  if (options.bankChargesName) map.set(key(options.bankChargesName), TAX_CODES.none);
  return map;
}

export interface ResolveInput {
  /** A code the owner picked on this line. */
  override?: TaxCode | null;
  /** A saved vendor rule's code. */
  rule?: TaxCode | null;
  foreignCurrency: boolean;
  category: string | null;
  kind: string;
  defaults: CategoryDefaults;
}

export interface Resolved {
  code: TaxCode;
  source: TaxSource;
}

export function resolveTaxCode(input: ResolveInput): Resolved | null {
  if (input.override) return { code: input.override, source: "line" };
  if (input.rule) return { code: input.rule, source: "rule" };
  if (input.foreignCurrency) return { code: TAX_CODES.none, source: "foreign_currency" };
  const byCategory = input.category ? input.defaults.get(key(input.category)) : undefined;
  if (byCategory) return { code: byCategory, source: "category" };
  if (input.kind === "fee" || input.kind === "interest") return { code: TAX_CODES.none, source: "kind" };
  return null;
}

export interface LineTax {
  /** The calculated tax (signed like the amount); 0 when there is no code. */
  tax_amount: number;
  code: TaxCode | null;
  source: TaxSource | null;
  /** No code applies, so nothing was calculated. */
  needs_code: boolean;
}

// What a line would be saved with. `manualTax` is a refund's HST the owner typed from the slip: it
// is kept as the figure (never overwritten by a calculation) and the resolved code, if any, still
// supplies the claim share.
export function taxForLine(amount: number, input: ResolveInput, manualTax: number | null = null): LineTax {
  const resolved = resolveTaxCode(input);
  if (manualTax !== null && manualTax !== 0) {
    return { tax_amount: manualTax, code: resolved?.code ?? null, source: resolved?.source ?? null, needs_code: false };
  }
  if (!resolved) return { tax_amount: 0, code: null, source: null, needs_code: true };
  return {
    tax_amount: calculateTax(amount, resolved.code),
    code: resolved.code,
    source: resolved.source,
    needs_code: false,
  };
}

// ---------------------------------------------------------------------------
// Reading an expense row (reports, HST helper, exports)
// ---------------------------------------------------------------------------

export interface TaxedRow {
  total_amount?: number;
  tax_amount: number;
  tax_category: string;
  tax_rate?: number | null;
  itc_pct?: number | null;
  deductible_pct?: number | null;
  from_statement?: boolean | null;
  no_receipt?: boolean | null;
}

// A row with no stored code (every receipt before tax codes, every scanned or typed one) behaves
// exactly as it always did: Meals 50%, everything else 100%.
const categoryRate = (category: string) => (category === "Meals" ? MEALS_ITC_RESTRICTION_RATE : 1);

export function itcPct(row: Pick<TaxedRow, "tax_category" | "itc_pct" | "deductible_pct">): number {
  return row.itc_pct ?? categoryRate(row.tax_category);
}

export function deductiblePct(row: Pick<TaxedRow, "tax_category" | "itc_pct" | "deductible_pct">): number {
  return row.deductible_pct ?? categoryRate(row.tax_category);
}

// "Calculated from statement": created by a statement import and no receipt attached yet.
export function isCalculated(row: Pick<TaxedRow, "from_statement" | "no_receipt">): boolean {
  return row.from_statement === true && row.no_receipt === true;
}

// Calculated, but no code was ever applied and no figure typed: nothing was calculated.
export function needsTaxCode(row: Pick<TaxedRow, "from_statement" | "no_receipt" | "tax_rate" | "tax_amount">): boolean {
  return isCalculated(row) && row.tax_rate == null && row.tax_amount === 0;
}

export type TaxBasis = "calculated" | "confirmed";
export const taxBasis = (row: Pick<TaxedRow, "from_statement" | "no_receipt">): TaxBasis =>
  isCalculated(row) ? "calculated" : "confirmed";

export const TAX_BASIS_LABELS: Record<TaxBasis, string> = {
  calculated: "Calculated from statement",
  confirmed: "Confirmed by receipt",
};

// The one line of wording for "what backs this ITC figure", shared by the Overview, the Expenses
// summary and the HST helper so they can't drift. Null when no statement expense is involved (then
// there is nothing to split and the figure needs no note).
export interface ItcSplit {
  estHstConfirmed: number;
  estHstCalculated: number;
  calculatedCount: number;
  needsTaxCodeCount: number;
}

export function itcSplitNote(s: ItcSplit, money: (n: number) => string): string | null {
  if (s.calculatedCount === 0) return null;
  const parts = [`${money(s.estHstConfirmed)} confirmed`, `${money(s.estHstCalculated)} calculated from statements`];
  if (s.needsTaxCodeCount > 0) {
    parts.push(`${s.needsTaxCodeCount} need${s.needsTaxCodeCount === 1 ? "s" : ""} a tax code`);
  }
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Changing a calculated expense's category (bulk recategorize, the expense drawer)
// ---------------------------------------------------------------------------
// Only a CALCULATED row (a statement expense with no receipt) whose code came from its category's
// default follows a category change: it is recomputed from the new category's default, or - if the
// new category has none - loses its code and its calculated tax (nothing is guessed). Everything
// else is left exactly as it is:
//   confirmed rows (a receipt or the owner's own figure) are never touched,
//   a code the owner picked on the line ('line'), a vendor rule's ('rule'), a fee/interest or a
//   foreign-currency default ('kind', 'foreign_currency') do not depend on the category.
export interface TaxPatch {
  tax_amount: number;
  tax_rate: number | null;
  itc_pct: number | null;
  deductible_pct: number | null;
  tax_source: TaxSource | null;
}

export interface RecalcRow {
  total_amount: number;
  tax_amount: number;
  from_statement?: boolean | null;
  no_receipt?: boolean | null;
  tax_rate?: number | null;
  itc_pct?: number | null;
  deductible_pct?: number | null;
  tax_source?: TaxSource | null;
}

export function currentTaxPatch(row: RecalcRow): TaxPatch {
  return {
    tax_amount: Number(row.tax_amount),
    tax_rate: row.tax_rate ?? null,
    itc_pct: row.itc_pct ?? null,
    deductible_pct: row.deductible_pct ?? null,
    tax_source: row.tax_source ?? null,
  };
}

export function taxAfterCategoryChange(row: RecalcRow, newCategory: string, defaults: CategoryDefaults): TaxPatch | null {
  if (!isCalculated(row) || row.tax_source !== "category") return null;
  const code = defaults.get(key(newCategory)) ?? null;
  const next: TaxPatch = code
    ? {
        tax_amount: calculateTax(row.total_amount, code),
        tax_rate: code.tax_rate,
        itc_pct: code.itc_pct,
        deductible_pct: code.deductible_pct,
        tax_source: "category",
      }
    : { tax_amount: 0, tax_rate: null, itc_pct: null, deductible_pct: null, tax_source: null };
  const cur = currentTaxPatch(row);
  const same = (Object.keys(next) as (keyof TaxPatch)[]).every((k) => next[k] === cur[k]);
  return same ? null : next;
}

// ---------------------------------------------------------------------------
// Applying a tax code AFTER the expense is saved (the drawer, and bulk "Set tax code")
// ---------------------------------------------------------------------------
// Only a CALCULATED row may be given a code this way (from_statement and no receipt attached yet): a
// row with a receipt, or one the owner entered, has a confirmed figure that a code must never
// overwrite. The tax is recalculated tax-included from the row's total, and the code is marked as the
// owner's own pick ('line'), so a later category change doesn't undo it. `null` clears the code: no
// tax and "needs a tax code" again.
export function taxPatchForCode(total: number, key: TaxCodeKey | null): TaxPatch {
  if (key === null) return { tax_amount: 0, tax_rate: null, itc_pct: null, deductible_pct: null, tax_source: null };
  const code = TAX_CODES[key];
  return {
    tax_amount: calculateTax(total, code),
    tax_rate: code.tax_rate,
    itc_pct: code.itc_pct,
    deductible_pct: code.deductible_pct,
    tax_source: "line",
  };
}

export function samePatch(a: TaxPatch, b: TaxPatch): boolean {
  return (Object.keys(a) as (keyof TaxPatch)[]).every((k) => a[k] === b[k]);
}

// A calculated row whose tax is a figure the owner typed (a refund's HST from the slip): no code and
// no source, but a non-zero tax. Bulk leaves these alone rather than overwrite what they typed.
export function hasTypedFigure(
  row: Pick<RecalcRow, "from_statement" | "no_receipt" | "tax_rate" | "tax_source" | "tax_amount">,
): boolean {
  return isCalculated(row) && row.tax_rate == null && row.tax_source == null && Number(row.tax_amount) !== 0;
}

// The expense drawer's "Tax code" picker, as a pure decision so the route's rules are unit-tested:
// a code may be applied only to a CALCULATED row (a statement expense with no receipt attached); the
// tax is recalculated from the total being saved, whatever tax figure the form carried is ignored.
export type DrawerTaxCodeResult = { ok: true; patch: TaxPatch } | { ok: false; error: string };

export function drawerTaxCode(
  existing: RecalcRow | null | undefined,
  newTotal: number,
  taxCode: unknown,
): DrawerTaxCodeResult {
  if (taxCode !== null && !isTaxCodeKey(taxCode)) return { ok: false, error: "Unknown tax code." };
  if (!existing || !isCalculated(existing)) {
    return { ok: false, error: "A tax code can only be set on a statement expense that has no receipt attached." };
  }
  return { ok: true, patch: taxPatchForCode(newTotal, taxCode) };
}
