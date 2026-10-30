"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BatchSummary } from "@/lib/bulk-delete";

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

export function importLabel(b: Pick<BatchSummary, "imported_at" | "rows" | "total">): string {
  const date = new Date(b.imported_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${date} · ${b.rows} expense${b.rows === 1 ? "" : "s"} · ${money(b.total)}`;
}

// "Imports": the recent CSV imports (date imported, how many expenses, total amount). Choosing one filters
// the Expenses list to it and offers "Delete this import". Fetched each time it opens, so it is never stale.
export function ImportsDialog({
  open,
  onOpenChange,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (batch: BatchSummary) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Imports</DialogTitle>
          <DialogDescription>Your recent CSV imports. Choose one to see its expenses, or to delete it.</DialogDescription>
        </DialogHeader>
        <ImportsList
          onChoose={(batch) => {
            onChoose(batch);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

// Mounted only while the dialog is open, so it loads fresh every time.
function ImportsList({ onChoose }: { onChoose: (batch: BatchSummary) => void }) {
  const [state, setState] = useState<{ batches: BatchSummary[]; available: boolean } | "error" | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/receipts/imports")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (!cancelled) setState({ batches: data.batches ?? [], available: data.available !== false });
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading...
      </p>
    );
  }
  if (state === "error") return <p className="text-sm text-destructive">Couldn&apos;t load your imports.</p>;
  if (!state.available) {
    return <p className="text-sm text-muted-foreground">Imports can&apos;t be listed yet.</p>;
  }
  if (state.batches.length === 0) {
    return <p className="text-sm text-muted-foreground">No imports yet. Expenses imported from now on are listed here.</p>;
  }
  return (
    <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
      {state.batches.map((b) => (
        <li key={b.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
          <span className="min-w-0">
            <span className="block font-medium">{importLabel(b)}</span>
            <span className="block text-xs text-muted-foreground tabular-nums">{money(b.tax)} tax</span>
          </span>
          <Button size="sm" variant="outline" onClick={() => onChoose(b)}>
            View
          </Button>
        </li>
      ))}
    </ul>
  );
}
