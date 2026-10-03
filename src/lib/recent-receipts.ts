// "Recently added" on the Expenses tab: receipts created since the owner last
// signed in that the current date range / job filter is hiding, so an old
// receipt that was just scanned or uploaded doesn't seem to have vanished.
// Pure and import-free (unit-tested with plain `node --test`).

export const RECENT_RECEIPT_LIMIT = 10;

export interface RecentCandidate {
  id: string;
  created_at: string;
}

export function pickRecentlyAdded<T extends RecentCandidate>(
  receipts: T[],
  visibleIds: ReadonlySet<string>,
  lastSignInAt: string | null | undefined,
  limit: number = RECENT_RECEIPT_LIMIT,
): { items: T[]; hiddenCount: number } {
  if (!lastSignInAt) return { items: [], hiddenCount: 0 };
  const since = new Date(lastSignInAt).getTime();
  if (Number.isNaN(since)) return { items: [], hiddenCount: 0 };

  const all = receipts
    .filter((r) => !visibleIds.has(r.id) && new Date(r.created_at).getTime() >= since)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return { items: all.slice(0, limit), hiddenCount: Math.max(all.length - limit, 0) };
}
