"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// The manual "attach to an existing expense" picker: every statement-created expense
// still waiting for a receipt, for when nothing matched on its own. It is a second VIEW
// inside the receipt review dialog (not a nested dialog - stacked Base UI modals fight
// over focus and scroll-lock). Candidates the matcher rates come first, then everything
// else nearest-date first; 100 a page with "Show more"; searchable.

export interface PickerItem {
  id: string;
  merchant_name: string;
  date: string;
  amount: number;
  tax_category: string;
  kind: "vendor" | "exact" | "near" | null;
  day_diff: number;
  /** Signed: the expense's date minus the scan's (positive = the expense is later). */
  days_from_scan: number;
  amount_matches: boolean;
}

interface Page {
  q: string;
  items: PickerItem[];
  total: number;
  hasMore: boolean;
  capped: boolean;
  failed: boolean;
}

export interface PickerScan {
  merchant: string;
  date: string;
  total: number;
}

function money(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function dayLabel(offset: number): string {
  if (offset === 0) return "same day as your receipt";
  const n = Math.abs(offset);
  return `${n} day${n === 1 ? "" : "s"} ${offset > 0 ? "after" : "before"} your receipt`;
}

const KIND_CHIP: Record<NonNullable<PickerItem["kind"]>, { text: string; tone: string }> = {
  vendor: { text: "Same vendor & amount", tone: "text-success" },
  exact: { text: "Same amount", tone: "text-foreground" },
  near: { text: "Close amount", tone: "text-muted-foreground" },
};

async function fetchPage(scan: PickerScan, q: string, offset: number): Promise<Omit<Page, "q">> {
  const params = new URLSearchParams({ mode: "browse", date: scan.date, offset: String(offset) });
  if (scan.total > 0) params.set("total", String(scan.total));
  if (scan.merchant.trim()) params.set("merchant", scan.merchant.trim());
  if (q.trim()) params.set("q", q.trim());
  try {
    const res = await fetch(`/api/statements/attach-candidates?${params}`);
    if (!res.ok) return { items: [], total: 0, hasMore: false, capped: false, failed: true };
    const body = await res.json();
    return {
      items: (body.items ?? []) as PickerItem[],
      total: Number(body.total ?? 0),
      hasMore: body.hasMore === true,
      capped: body.capped === true,
      failed: false,
    };
  } catch {
    return { items: [], total: 0, hasMore: false, capped: false, failed: true };
  }
}

export function AttachPicker({
  scan,
  selectedId,
  onChoose,
  onBack,
}: {
  scan: PickerScan;
  /** The expense currently chosen in the review view, so it shows as selected. */
  selectedId: string | null;
  onChoose: (item: PickerItem) => void;
  onBack: () => void;
}) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState<Page | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [picked, setPicked] = useState<PickerItem | null>(null);

  // Search is debounced; setState only ever runs inside the timer's callback.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  // First page for the current search. A stale answer (the search changed while it was
  // in flight) is dropped. `loading` is derived below, not set here.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchPage(scan, debouncedQ, 0);
      if (!cancelled) setPage({ q: debouncedQ, ...result });
    })();
    return () => {
      cancelled = true;
    };
  }, [scan, debouncedQ]);

  const loading = !page || page.q !== debouncedQ;
  const items = page?.items ?? [];

  async function showMore() {
    if (!page || loadingMore) return;
    setLoadingMore(true);
    const next = await fetchPage(scan, page.q, page.items.length);
    setPage((prev) => (prev && prev.q === page.q ? { ...prev, ...next, items: [...prev.items, ...next.items] } : prev));
    setLoadingMore(false);
  }

  const chosenId = picked?.id ?? selectedId;
  const firstOtherIndex = items.findIndex((i) => i.kind === null);
  const anyLikely = items.some((i) => i.kind !== null);

  // min-w-0: the dialog is a CSS grid, and a grid child defaults to min-width:auto, so a long
  // list would widen the column past the dialog and add a horizontal scrollbar.
  return (
    <div className="min-w-0 space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to your receipt
      </button>

      <div className="rounded-md border bg-muted/40 p-2.5 text-xs">
        <p className="font-medium text-foreground">Your receipt</p>
        <p className="text-muted-foreground">
          {scan.merchant || "Unknown merchant"} · {scan.date} · {scan.total > 0 ? money(scan.total) : "no total yet"}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="attach-picker-search" className="text-xs text-muted-foreground">
          Search merchant, amount, date or category
        </Label>
        <Input
          id="attach-picker-search"
          type="search"
          autoFocus
          value={q}
          placeholder="e.g. Rogers, 89.99, 2026-02"
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {loading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading...
        </p>
      )}

      {!loading && page?.failed && (
        <p className="text-sm text-destructive">Couldn&apos;t load your expenses. Go back and try again.</p>
      )}

      {!loading && !page?.failed && items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {debouncedQ.trim()
            ? "No waiting expenses match that search."
            : "No expenses are waiting for a receipt. Import a card statement first."}
        </p>
      )}

      {!loading && items.length > 0 && (
        <div role="radiogroup" aria-label="Expenses waiting for a receipt" className="min-w-0 space-y-1.5">
          {items.map((item, i) => {
            const selected = chosenId === item.id;
            const chip = item.kind ? KIND_CHIP[item.kind] : null;
            return (
              <div key={item.id} className="space-y-1.5">
                {i === 0 && anyLikely && (
                  <p className="pt-1 text-xs font-medium text-muted-foreground">Likely matches</p>
                )}
                {i === firstOtherIndex && firstOtherIndex > -1 && (
                  <p className="pt-2 text-xs font-medium text-muted-foreground">
                    {anyLikely ? "All other waiting expenses" : "All waiting expenses"}
                  </p>
                )}
                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm",
                    selected && "border-primary bg-primary/5",
                  )}
                >
                  <input
                    type="radio"
                    name="attach-picker-choice"
                    className="mt-1"
                    checked={selected}
                    onChange={() => setPicked(item)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-medium">{item.merchant_name}</span>
                      <span className="shrink-0 font-semibold tabular-nums">{money(item.amount)}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      <span>{item.date}</span>
                      <span aria-hidden>·</span>
                      <span>{dayLabel(item.days_from_scan)}</span>
                      <Badge variant="secondary">{item.tax_category}</Badge>
                      {chip && <span className={cn("font-medium", chip.tone)}>{chip.text}</span>}
                      {scan.total > 0 && !item.amount_matches && (
                        <span className="text-destructive">Amount differs</span>
                      )}
                    </span>
                  </span>
                </label>
              </div>
            );
          })}
        </div>
      )}

      {!loading && page && (
        <p className="text-xs text-muted-foreground">
          Showing {items.length} of {page.total}
          {page.capped ? " (the most recent 2,000 waiting expenses)" : ""}
        </p>
      )}

      {!loading && page?.hasMore && (
        <Button variant="outline" size="sm" onClick={showMore} disabled={loadingMore}>
          {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
          Show more ({page.total - items.length} left)
        </Button>
      )}

      {picked && scan.total > 0 && !picked.amount_matches && (
        <p className="text-xs text-muted-foreground">
          Your receipt is {money(scan.total)} but this expense is {money(picked.amount)}. You&apos;ll be asked
          to confirm the amounts before attaching.
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={() => picked && onChoose(picked)} disabled={!picked}>
          Use this expense
        </Button>
      </div>
    </div>
  );
}
