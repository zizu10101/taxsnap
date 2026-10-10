// Pure logic for the saved-item picker on estimates, invoices and change orders.
import { searchList } from "./list-search.ts";
import { lineDescription, lineName, normalizeUnit, type LineLabelFields } from "./line-format.ts";

export interface SavedItemLike {
  id: string;
  /** Absent/null on an item saved before migration 0061: its description is then its name. */
  name?: string | null;
  description: string;
  /** Absent/null = no unit. */
  unit?: string | null;
  unit_price: number;
}

export interface LineDraft {
  name: string;
  description: string;
  /** "" = no unit. */
  unit: string;
  quantity: number;
  unit_price: number;
}

/**
 * Live search - the shared list-search rule (lib/list-search.ts): case- and accent-insensitive, and
 * every word typed must appear in the description, in any order (so "paint room" finds "Interior
 * paint, per room"). An empty query returns everything, in the original order.
 */
export function filterSavedItems<T extends Pick<SavedItemLike, "description" | "name">>(
  items: T[],
  query: string,
): T[] {
  return searchList(items, query, (item) => [lineName(item), lineDescription(item)]);
}

/**
 * Saved items by name (an old item's name is its description). The queries still order by the
 * `description` column, which is '' for every item saved since 0061, so the order is made here.
 */
export function sortSavedItems<T extends Pick<SavedItemLike, "description" | "name">>(items: T[]): T[] {
  return [...items].sort((a, b) => lineName(a).localeCompare(lineName(b)));
}

/**
 * What picking a saved item fills into a line: name, description, unit and price per unit. The quantity
 * is always 1 - it differs on every job, so a saved item never recalls one (line_items.quantity from
 * migration 0059 still exists in old rows, but nothing reads it). The form then focuses and selects the
 * quantity field so typing replaces the 1.
 */
export function lineFromSavedItem(item: SavedItemLike): LineDraft {
  return {
    name: lineName(item),
    description: lineDescription(item),
    unit: normalizeUnit(item.unit) ?? "",
    quantity: 1,
    unit_price: item.unit_price,
  };
}

/**
 * Puts a picked item on the first still-empty line instead of always
 * appending, so picking right after opening the form (one blank row) doesn't
 * leave that blank row behind.
 */
export function insertLine<T extends LineLabelFields>(lines: T[], filled: T): T[] {
  const index = insertedLineIndex(lines);
  if (index === lines.length) return [...lines, filled];
  return lines.map((l, i) => (i === index ? filled : l));
}

/** Where insertLine puts a picked item: the first still-blank line, otherwise the end. */
export function insertedLineIndex<T extends LineLabelFields>(lines: T[]): number {
  const emptyIndex = lines.findIndex((l) => !lineName(l));
  return emptyIndex === -1 ? lines.length : emptyIndex;
}
