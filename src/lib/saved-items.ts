// Pure logic for the saved-item picker on estimates, invoices and change orders.
import { searchList } from "./list-search.ts";

export interface SavedItemLike {
  id: string;
  description: string;
  unit_price: number;
  /** Absent on a database that hasn't had migration 0059 applied yet. */
  quantity?: number | null;
}

export interface LineDraft {
  description: string;
  quantity: number;
  unit_price: number;
}

/** A stored quantity that is missing or not a positive number reads as 1. */
export function savedItemQuantity(item: Pick<SavedItemLike, "quantity">): number {
  const q = Number(item.quantity);
  return Number.isFinite(q) && q > 0 ? q : 1;
}

/**
 * Live search - the shared list-search rule (lib/list-search.ts): case- and accent-insensitive, and
 * every word typed must appear in the description, in any order (so "paint room" finds "Interior
 * paint, per room"). An empty query returns everything, in the original order.
 */
export function filterSavedItems<T extends Pick<SavedItemLike, "description">>(
  items: T[],
  query: string,
): T[] {
  return searchList(items, query, (item) => [item.description]);
}

/** What picking a saved item fills into a line: description, quantity and price. */
export function lineFromSavedItem(item: SavedItemLike): LineDraft {
  return {
    description: item.description,
    quantity: savedItemQuantity(item),
    unit_price: item.unit_price,
  };
}

/**
 * Puts a picked item on the first still-empty line instead of always
 * appending, so picking right after opening the form (one blank row) doesn't
 * leave that blank row behind.
 */
export function insertLine<T extends LineDraft>(lines: T[], filled: T): T[] {
  const emptyIndex = lines.findIndex((l) => !l.description.trim());
  if (emptyIndex === -1) return [...lines, filled];
  return lines.map((l, i) => (i === emptyIndex ? filled : l));
}
