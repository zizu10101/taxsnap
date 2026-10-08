// A payment dated after today is almost always a typo (wrong year or month),
// and it would be counted as revenue (and HST) in a period that hasn't
// happened. It is only a WARNING: a post-dated cheque or a scheduled
// e-transfer is a real thing, so the owner can still record it.

/** Local calendar date as YYYY-MM-DD (not UTC: the owner's "today"). */
export function localIsoDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isFuturePaymentDate(paidDate: string, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidDate)) return false;
  return paidDate > localIsoDate(now);
}
