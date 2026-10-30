"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SkippedRow } from "@/lib/bulk-delete";

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// What is being deleted: the ticked rows, or every expense of one CSV import.
export type DeleteTarget =
  | { kind: "ids"; ids: string[] }
  | { kind: "batch"; batchId: string; label: string };

interface Preview {
  count: number;
  total: number;
  tax: number;
  skipped: SkippedRow[];
}

async function call(target: DeleteTarget, extra: Record<string, unknown>) {
  const res = await fetch("/api/receipts/bulk-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(target.kind === "ids" ? { ids: target.ids } : { import_batch_id: target.batchId }),
      ...extra,
    }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

// The confirmation for "Delete" on the selection bar and for "Delete this import". It asks the server what
// would go (count, total amount, total tax, and any row that will be skipped with the reason) BEFORE
// anything is deleted, and sends those figures back with the confirmation so the server refuses if the rows
// have changed since. A delete is permanent - the single delete is too - so this says so, and says the
// receipt photos go with the expenses. Keyed by the caller, so each open starts fresh.
export function BulkDeleteDialog({
  target,
  describe,
  onClose,
  onDeleted,
}: {
  target: DeleteTarget;
  /** A readable name for a skipped row ("Home Depot, Mar 5"), from the list already on screen. */
  describe: (id: string) => string;
  onClose: () => void;
  /** The ids that were really deleted, so the page can drop them. */
  onDeleted: (ids: string[]) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<{ deleted: number; skipped: SkippedRow[]; filesLeft: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    call(target, { mode: "preview" })
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) setError(data.error || "Couldn't check these expenses.");
        else setPreview(data as Preview);
      })
      .catch(() => {
        if (!cancelled) setError("Something went wrong");
      });
    return () => {
      cancelled = true;
    };
    // The target is fixed for this dialog's life (the caller keys it).
  }, [target]);

  async function handleDelete() {
    if (!preview) return;
    setApplying(true);
    setError(null);
    try {
      const { ok, data } = await call(target, {
        mode: "apply",
        expected_count: preview.count,
        expected_total_cents: Math.round(preview.total * 100),
      });
      if (!ok) {
        setError(data.error || "Couldn't delete these expenses.");
        if (data.code === "STALE_PREVIEW") setPreview(null);
        return;
      }
      const deletedIds = (data.deleted_ids ?? []) as string[];
      const skipped = (data.skipped ?? []) as SkippedRow[];
      onDeleted(deletedIds);
      toast.success(`Deleted ${plural(data.deleted, "expense")}`);
      if (skipped.length > 0 || data.files_left > 0) {
        setResult({ deleted: data.deleted, skipped, filesLeft: data.files_left ?? 0 });
      } else {
        onClose();
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setApplying(false);
    }
  }

  const title =
    target.kind === "batch"
      ? "Delete this import?"
      : `Delete ${plural(preview?.count ?? target.ids.length, "expense")}?`;

  return (
    <Dialog open onOpenChange={(open) => !open && !applying && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{result ? "Delete finished" : title}</DialogTitle>
          {!result && target.kind === "batch" && <DialogDescription>{target.label}</DialogDescription>}
        </DialogHeader>

        {result ? (
          <div className="space-y-3 text-sm">
            <p className="font-medium">Deleted {plural(result.deleted, "expense")}.</p>
            {result.skipped.length > 0 && (
              <div className="space-y-1">
                <p className="text-muted-foreground">{plural(result.skipped.length, "expense")} not deleted:</p>
                <ul className="list-disc pl-5">
                  {result.skipped.slice(0, 20).map((s) => (
                    <li key={s.id}>
                      {describe(s.id)}: {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.filesLeft > 0 && (
              <p className="text-muted-foreground">
                {plural(result.filesLeft, "receipt photo")} couldn&apos;t be removed from storage. The expenses are gone.
              </p>
            )}
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            {!preview && !error && (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking...
              </p>
            )}
            {preview && (
              <>
                <p>
                  {preview.count === 0 ? (
                    "None of these can be deleted."
                  ) : (
                    <>
                      This permanently deletes <strong>{plural(preview.count, "expense")}</strong>:{" "}
                      <strong className="tabular-nums">{money(preview.total)}</strong> in total, with{" "}
                      <strong className="tabular-nums">{money(preview.tax)}</strong> tax. <strong>This can&apos;t be undone</strong>,
                      and their receipt photos are removed too.
                    </>
                  )}
                </p>
                {preview.skipped.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-muted-foreground">
                      {plural(preview.skipped.length, "expense")} can&apos;t be deleted and will be skipped:
                    </p>
                    <ul className="list-disc pl-5">
                      {preview.skipped.slice(0, 10).map((s) => (
                        <li key={s.id}>
                          {describe(s.id)}: {s.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
            {error && <p className="text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={applying}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDelete} disabled={!preview || preview.count === 0 || applying}>
                {applying && <Loader2 className="h-4 w-4 animate-spin" />}
                {preview && preview.count > 0 ? `Delete ${plural(preview.count, "expense")}` : "Delete"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
