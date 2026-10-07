import {
  codeFromRow,
  taxForLine,
  type CategoryDefaults,
  type LineTax,
  type TaxSource,
} from "./tax-codes.ts";

// What a statement line is saved with, tax-wise. One function used by the review screen (to show it
// live), and by the commit route (to write it onto the lines just before commit_statement_import
// copies it onto the new expenses) - so what the owner sees is what gets saved.
//
// Nothing here is stored while the import is a draft EXCEPT the owner's own choices:
//   tax_source 'line'  + the three numbers   a code the owner picked on this line
//   tax_amount (refund, tax_source null)     an HST figure typed from a refund slip
// Everything else (category default, fees/interest, foreign currency) is derived on the spot, so
// changing a category or a line's type can never leave a stale tax behind.

export interface TaxLineInput {
  kind: string;
  amount: number;
  category: string | null;
  original_currency: string | null;
  tax_amount: number;
  tax_rate?: number | null;
  itc_pct?: number | null;
  deductible_pct?: number | null;
  tax_source?: TaxSource | null;
}

export function isForeignLine(line: Pick<TaxLineInput, "original_currency">): boolean {
  const c = line.original_currency?.trim().toUpperCase();
  return !!c && c !== "CAD";
}

// A refund's HST typed by the owner from the slip: kept as the figure, never recalculated. It has
// no code (typing a figure and picking a code are exclusive), so its claim share is read from the
// category like any receipt's.
export function manualTaxOf(line: TaxLineInput): number | null {
  return line.kind === "refund" && !line.tax_source && line.tax_amount !== 0 ? line.tax_amount : null;
}

export function lineTax(line: TaxLineInput, defaults: CategoryDefaults): LineTax & { manual: boolean } {
  const manual = manualTaxOf(line);
  const override = line.tax_source === "line" ? codeFromRow(line) : null;
  const t = taxForLine(
    line.amount,
    {
      override,
      foreignCurrency: isForeignLine(line),
      category: line.category,
      kind: line.kind,
      defaults,
    },
    manual,
  );
  // A typed figure carries no code and no source (see manualTaxOf).
  return manual !== null ? { ...t, code: null, source: null, manual: true } : { ...t, manual: false };
}

export interface TaxWrite {
  id: string;
  update: {
    tax_amount: number;
    tax_rate: number | null;
    itc_pct: number | null;
    deductible_pct: number | null;
    tax_source: TaxSource | null;
  };
}

// The writes that make every line that will become an expense carry its resolved code and tax. Only
// lines whose stored values differ are returned (so a re-run, e.g. after a failed commit, writes
// nothing). A typed refund figure is left exactly as it is.
export function taxWritesFor(
  lines: (TaxLineInput & { id: string; resolution: string | null })[],
  defaults: CategoryDefaults,
): TaxWrite[] {
  const writes: TaxWrite[] = [];
  for (const line of lines) {
    if (line.resolution !== "new_expense") continue;
    const t = lineTax(line, defaults);
    if (t.manual) continue;
    const next = {
      tax_amount: t.tax_amount,
      tax_rate: t.code?.tax_rate ?? null,
      itc_pct: t.code?.itc_pct ?? null,
      deductible_pct: t.code?.deductible_pct ?? null,
      tax_source: t.source,
    };
    const same =
      Number(line.tax_amount) === next.tax_amount &&
      (line.tax_rate ?? null) === next.tax_rate &&
      (line.itc_pct ?? null) === next.itc_pct &&
      (line.deductible_pct ?? null) === next.deductible_pct &&
      (line.tax_source ?? null) === next.tax_source;
    if (!same) writes.push({ id: line.id, update: next });
  }
  return writes;
}
