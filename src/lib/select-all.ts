// Reads EVERY row of a query, not just the first page.
//
// The database API answers at most 1000 rows per request (the project's "Max rows" setting; a client
// `.limit(5000)` does not raise it). A plain `await supabase.from("receipts").select("*")` therefore
// silently stops at 1000, and every total built on it comes out too low with no sign anything is wrong.
// selectAll() asks page after page until a short page says the rows have run out.
//
//   const { rows, truncated } = await selectAll(() =>
//     supabase
//       .from("receipts")
//       .select("*")
//       .order("transaction_date", { ascending: false })
//       .order("id"),                       // <- the tiebreak: see below
//   );
//
// THE ORDER MUST BE STABLE. `build` is called afresh for every page and `.range()` is added to it; if two
// rows can tie on the sort columns, the database may order them differently from one page to the next, and
// a row is then returned twice or never. End the order with a unique column (`id`). selectAll cannot check
// this for you; a static test (select-all.test.ts) checks that the loaders that use it do.
//
// A SAFETY CEILING: at most SELECT_ALL_MAX_ROWS rows (20,000) are read. A user past that gets exactly the
// first 20,000 in the query's order and `truncated: true` - true only when a further row really exists
// (when the 20th page is full, one more row is asked for before deciding), so a user with exactly 20,000
// is not told their totals are incomplete. Callers show "Some totals may be incomplete" when it is set.
//
// ERRORS PROPAGATE. A failed page throws; it is never turned into "the rows ran out", because a half-read
// list looks exactly like a short one and would be silently wrong.
//
// Pure (no imports): it only needs something with a `.range()` that can be awaited.

export const SELECT_ALL_PAGE = 1000;
export const SELECT_ALL_MAX_ROWS = 20_000;

export const TRUNCATED_NOTICE =
  "Some totals may be incomplete: there are more than 20,000 records, and only the first 20,000 were counted.";

// What a Supabase query builder looks like to this helper: `.range()` gives something awaitable that
// resolves to { data, error }.
export interface RangeQuery<T> {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
}

export async function selectAll<T>(
  build: () => RangeQuery<T>,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];

  for (let from = 0; from < SELECT_ALL_MAX_ROWS; from += SELECT_ALL_PAGE) {
    const { data, error } = await build().range(from, from + SELECT_ALL_PAGE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < SELECT_ALL_PAGE) return { rows, truncated: false };
  }

  // The ceiling's worth of full pages was read. Is there really another row?
  const { data, error } = await build().range(SELECT_ALL_MAX_ROWS, SELECT_ALL_MAX_ROWS);
  if (error) throw new Error(error.message);
  return { rows, truncated: (data ?? []).length > 0 };
}
