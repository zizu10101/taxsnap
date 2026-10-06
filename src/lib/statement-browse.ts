import { dayNumber } from "./statement-lines.ts";
import { candidateFor, type MatchKind } from "./statement-matching.ts";
import { STATEMENT_BROWSE_LIMIT } from "./statement-config.ts";

// The manual "attach to an existing expense" picker's list: every statement-created
// expense still waiting for a receipt, for the case where nothing matched on its own.
// There can be far more than fit on screen (hundreds after a few imports), so this
// ranks, searches and pages. Pure, so the paging and the ranking are unit-tested.
//
// Order: expenses the matcher itself would call a candidate come first (vendor, then
// exact, then near - the same ranking as the automatic list), then everything else by
// how close its date is to the scan's. Searching never reorders by anything but
// that, so the page a person is on stays stable.

export interface BrowseRow {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  amount: number;
  merchant_name: string;
  tax_category: string;
}

export interface BrowseScan {
  /** The scanned receipt's date, YYYY-MM-DD. */
  date: string;
  total: number | null;
  merchant: string | null;
}

export interface BrowseItem extends BrowseRow {
  /** How the matcher rates this expense against the scan; null = not a candidate. */
  kind: MatchKind | null;
  day_diff: number;
  /** Same amount to the cent as the scan. */
  amount_matches: boolean;
}

export interface BrowseOptions {
  q?: string;
  offset?: number;
  limit?: number;
}

export interface BrowsePage {
  items: BrowseItem[];
  /** Matches AFTER the search is applied (not the page size). */
  total: number;
  hasMore: boolean;
  offset: number;
}

const KIND_ORDER: Record<MatchKind, number> = { vendor: 0, exact: 1, near: 2 };

function matchesSearch(row: BrowseRow, q: string): boolean {
  const needle = q.trim().toLowerCase().replace(/^\$/, "");
  if (!needle) return true;
  return (
    row.merchant_name.toLowerCase().includes(needle) ||
    row.tax_category.toLowerCase().includes(needle) ||
    row.amount.toFixed(2).includes(needle) ||
    row.date.includes(needle)
  );
}

export function browseExpenses(rows: BrowseRow[], scan: BrowseScan, options: BrowseOptions = {}): BrowsePage {
  // Never more than one screenful per request, whatever the caller asks for.
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? STATEMENT_BROWSE_LIMIT)), STATEMENT_BROWSE_LIMIT);
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const scanDay = dayNumber(scan.date);

  const items: BrowseItem[] = rows
    .filter((r) => matchesSearch(r, options.q ?? ""))
    .map((r) => {
      const candidate =
        scan.total !== null && scan.total > 0
          ? candidateFor(
              { id: "scan", date: scan.date, amount: scan.total, vendor: scan.merchant },
              { id: r.id, date: r.date, amount: r.amount, vendor: r.merchant_name },
            )
          : null;
      return {
        ...r,
        kind: candidate?.kind ?? null,
        day_diff: Math.abs(dayNumber(r.date) - scanDay),
        amount_matches: scan.total !== null && Math.round(scan.total * 100) === Math.round(r.amount * 100),
      };
    })
    .sort((a, b) => {
      const ak = a.kind === null ? 3 : KIND_ORDER[a.kind];
      const bk = b.kind === null ? 3 : KIND_ORDER[b.kind];
      if (ak !== bk) return ak - bk;
      if (a.day_diff !== b.day_diff) return a.day_diff - b.day_diff;
      // Stable tail: newer first, then by id so two pages never overlap or skip.
      return a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? 1 : -1;
    });

  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    hasMore: offset + limit < items.length,
    offset,
  };
}
