"use client";

import { useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Receipt } from "@/lib/database.types";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function formatDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Dismissal is remembered per device, keyed by the sign-in it belongs to - so
// the next sign-in starts fresh without anything being cleared explicitly.
const DISMISS_KEY = "taxsnap-recent-receipts-dismissed";
const DISMISS_EVENT = "taxsnap:recent-receipts-dismissed";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(DISMISS_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(DISMISS_EVENT, callback);
  };
}
function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}
const readDismissedOnServer = () => null;

// Receipts added since the owner last signed in that the current filters are
// hiding (typically an old receipt just scanned or uploaded), pinned above the
// lists so it's clear the save worked. Clears itself at the next sign-in.
export function RecentlyAddedReceipts({
  receipts,
  hiddenCount,
  signInKey,
  viewLabel,
  onSelect,
}: {
  receipts: Receipt[];
  hiddenCount: number;
  // The sign-in time these receipts are measured from; also the dismissal key.
  signInKey: string;
  // e.g. "This Month", for "Dated Mar 12, not in This Month".
  viewLabel: string;
  onSelect: (receipt: Receipt) => void;
}) {
  const dismissedFor = useSyncExternalStore(subscribe, readDismissed, readDismissedOnServer);

  if (receipts.length === 0 || dismissedFor === signInKey) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, signInKey);
    } catch {
      // Private mode etc.: it simply returns on the next load.
    }
    window.dispatchEvent(new Event(DISMISS_EVENT));
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold">Recently added</p>
            <p className="text-xs text-muted-foreground">
              Added since you last signed in, but not in the view below.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={dismiss} aria-label="Dismiss recently added">
            <X className="h-4 w-4" />
            Dismiss
          </Button>
        </div>

        <div className="divide-y rounded-md border">
          {receipts.map((receipt) => (
            <button
              key={receipt.id}
              type="button"
              onClick={() => onSelect(receipt)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{receipt.merchant_name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  Dated {formatDate(receipt.transaction_date)}, not in {viewLabel}
                </p>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums">
                {formatCurrency(receipt.total_amount)}
              </span>
            </button>
          ))}
        </div>

        {hiddenCount > 0 && (
          <p className="text-xs text-muted-foreground">
            +{hiddenCount} more added since you signed in. Widen the date range to see them.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
