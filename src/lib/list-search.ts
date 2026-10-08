// The one matching rule behind every list's search box (and the saved-item picker): case-insensitive,
// accent-insensitive, and every typed word must appear somewhere in the row's searchable text, in any
// order - so "kitchen ann" finds a document for client Ann on job "Kitchen reno" because words may
// match different fields. An empty query matches everything. Pure; lists filter data they already
// loaded, so there is no query per keystroke.

export type SearchField = string | number | null | undefined;

/** Lower-cased, accents removed (é -> e), runs of space collapsed. */
export function normalizeSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function searchWords(query: string): string[] {
  return normalizeSearchText(query).split(" ").filter(Boolean);
}

/** Does every word of the query appear in the joined fields? Empty query = true. */
export function matchesSearch(fields: SearchField[], query: string): boolean {
  const words = searchWords(query);
  if (words.length === 0) return true;
  const haystack = normalizeSearchText(
    fields.filter((f) => f !== null && f !== undefined && f !== "").join(" "),
  );
  return words.every((w) => haystack.includes(w));
}

/**
 * Filters `items` to those whose fields match. Returns the SAME array when the query is empty (so a
 * memoised result keeps its identity and useSyncedState-style consumers don't re-seed).
 */
export function searchList<T>(items: T[], query: string, fieldsOf: (item: T) => SearchField[]): T[] {
  if (searchWords(query).length === 0) return items;
  return items.filter((item) => matchesSearch(fieldsOf(item), query));
}

/** A money amount as the ways people type it: 45.5 -> "45.5 45.50", so "45" and "45.50" both match. */
export function amountSearchText(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "";
  return `${amount} ${amount.toFixed(2)}`;
}
