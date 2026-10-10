"use client";

import { useMemo, useState } from "react";
import { BookmarkPlus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { filterSavedItems, sortSavedItems, type SavedItemLike } from "@/lib/saved-items";
import { lineDescription, lineName, normalizeUnit } from "@/lib/line-format";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

// "Insert a saved item" with a live search box.
//
// This replaced a Base UI Select. That popup positions itself so the selected
// item sits over the trigger (alignItemWithTrigger), hides its own scrollbar
// while doing so, sets scrollTop from code, and only offers its "scroll up"
// arrow on mouse hover (not on touch) - so a long list scrolled down and then
// could not be brought back up. A saved-item list isn't a one-of-N form value
// anyway; it is a searchable list. So this is a plain inline panel with a
// normally scrolling list: no portal (it also sits inside the Dialog-based
// builder, where a second portalled popup would fight over focus), and the
// browser's own scrolling in both directions.
export function SavedItemPicker({
  items,
  onPick,
  triggerClassName,
}: {
  items: SavedItemLike[];
  onPick: (item: SavedItemLike) => void;
  /** Lets the dark editor panel pass its field styling to the trigger. */
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const sorted = useMemo(() => sortSavedItems(items), [items]);
  const matches = useMemo(() => filterSavedItems(sorted, query), [sorted, query]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="w-full sm:w-72">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={`w-full justify-start gap-1.5 text-xs ${triggerClassName ?? ""}`}
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <BookmarkPlus className="h-3.5 w-3.5" />
        Insert a saved item...
      </Button>

      {open && (
        <div className="mt-1.5 rounded-lg border border-border bg-popover text-popover-foreground shadow-sm">
          <div className="relative border-b border-border p-1.5">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              type="search"
              placeholder="Search saved items"
              aria-label="Search saved items"
              className="h-8 pl-7 text-sm"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  close();
                }
                // Enter picks the only match, so "type, Enter" works.
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (matches.length === 1) {
                    onPick(matches[0]);
                    close();
                  }
                }
              }}
            />
          </div>

          <ul className="max-h-56 overflow-y-auto overscroll-contain p-1" role="listbox">
            {matches.length === 0 ? (
              <li className="px-2 py-3 text-center text-xs text-muted-foreground">
                No saved items match &ldquo;{query.trim()}&rdquo;.
              </li>
            ) : (
              matches.map((item) => {
                const unit = normalizeUnit(item.unit);
                const description = lineDescription(item);
                return (
                  <li key={item.id} role="option" aria-selected={false}>
                    <button
                      type="button"
                      className="flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none"
                      onClick={() => {
                        onPick(item);
                        close();
                      }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{lineName(item)}</span>
                        {description && (
                          <span className="block truncate text-xs text-muted-foreground">{description}</span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {formatCurrency(item.unit_price)}
                        {unit && ` / ${unit}`}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
