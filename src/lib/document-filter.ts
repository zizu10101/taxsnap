// The Invoices list shows every invoice, including progress draws (a draw is
// an ordinary `documents` row with type = 'invoice' and is_progress_draw =
// true). This is the "Type" filter on that list and the counting rule for the
// monthly invoice cap, kept pure so both are tested.

export type InvoiceTypeFilter = "all" | "standard" | "progress";

interface DrawFields {
  is_progress_draw?: boolean | null;
  draw_number?: number | null;
}

export function isProgressDraw(doc: DrawFields): boolean {
  return !!doc.is_progress_draw;
}

export function filterByInvoiceType<T extends DrawFields>(docs: T[], filter: InvoiceTypeFilter): T[] {
  if (filter === "progress") return docs.filter(isProgressDraw);
  if (filter === "standard") return docs.filter((d) => !isProgressDraw(d));
  return docs;
}

/** "Draw 3", or just "Progress" for a draw with no number. null for a normal invoice. */
export function drawBadgeLabel(doc: DrawFields): string | null {
  if (!isProgressDraw(doc)) return null;
  return doc.draw_number ? `Draw ${doc.draw_number}` : "Progress";
}

/**
 * Invoices counted against this month's cap: every invoice row created since
 * `fromIso`, a progress draw included, each exactly once. Same rule as
 * wouldExceedMonthlyLimit (type = 'invoice', created_at >= start of month);
 * estimates never count, and a draw is one row, not one per list it shows in.
 * The filter above only changes what is SHOWN, never this count.
 */
export function countInvoicesThisMonth<T extends { id: string; type: string; created_at: string }>(
  docs: T[],
  fromIso: string | null,
): number {
  const seen = new Set<string>();
  for (const d of docs) {
    if (d.type !== "invoice") continue;
    if (fromIso && d.created_at < fromIso) continue;
    seen.add(d.id);
  }
  return seen.size;
}
