"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
import { formatDay, formatMoney } from "@/lib/statement-format";
import { STATEMENTS_HREF } from "@/lib/statement-routes";
import type { DeleteExpectation } from "@/lib/statement-delete";
import type { DeletePreview } from "@/lib/statement-groups-server";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const SHOWN = 8;

async function post(importId: string, body: unknown) {
  const res = await fetch(`/api/statements/${importId}/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// Preview first, then confirm - nothing is deleted until the owner presses the red button, and it
// is never automatic. If anything changed between the preview and the confirm (a receipt was
// attached, an expense deleted by hand) nothing is deleted and the new counts are shown instead.
export function DeleteStatementDialog({ importId, onClose }: { importId: string; onClose: () => void }) {
  const router = useRouter();
  const [preview, setPreview] = useState<DeletePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  // Loaded once when the dialog opens (state is only set inside the async callback).
  useEffect(() => {
    let cancelled = false;
    post(importId, { mode: "preview" })
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) setError(data.error || "Couldn't check what would be deleted.");
        else setPreview(data as DeletePreview);
      })
      .catch(() => !cancelled && setError("Couldn't check what would be deleted."));
    return () => {
      cancelled = true;
    };
  }, [importId]);

  async function confirm(expect: DeleteExpectation) {
    setApplying(true);
    setError(null);
    try {
      const { ok, status, data } = await post(importId, { mode: "apply", expect });
      if (!ok) {
        // Changed since the preview: show the fresh counts and make the owner confirm again.
        if (status === 409 && data.code === "STALE_PREVIEW" && data.plan) setPreview(data as DeletePreview);
        setError(data.error || "Couldn't delete the statement.");
        return;
      }
      toast.success(
        data.deleted > 0
          ? `Deleted the statement and ${plural(data.deleted, "expense")}.`
          : "Deleted the statement.",
      );
      router.push(STATEMENTS_HREF);
      router.refresh();
    } catch {
      setError("Something went wrong. Nothing more was changed - try again.");
    } finally {
      setApplying(false);
    }
  }

  const counts = preview?.plan.counts;

  return (
    <Dialog open onOpenChange={(open) => !open && !applying && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Delete this statement?</DialogTitle>
          <DialogDescription>
            Deletes the expenses it created that have no receipt attached, and lets you upload the same
            statement file again. Nothing is deleted until you confirm below.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-3 text-sm">
          {!preview && !error && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking what would be deleted...
            </p>
          )}

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-destructive">{error}</p>
          )}

          {preview && counts && (
            <>
              <p>
                {counts.delete > 0 ? (
                  <>
                    <strong>{plural(counts.delete, "expense")}</strong> will be deleted ({formatMoney(counts.delete_total)}{" "}
                    as paid, {formatMoney(counts.delete_tax)} of tax).
                  </>
                ) : (
                  <>No expenses will be deleted: none of this statement&apos;s expenses are left without a receipt.</>
                )}
              </p>

              {preview.plan.delete.length > 0 && (
                <ul className="divide-y rounded-md border text-xs">
                  {preview.plan.delete.slice(0, SHOWN).map((d) => (
                    <li key={d.receipt_id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                      <span className="min-w-0 truncate">
                        {d.merchant_name}
                        <span className="text-muted-foreground"> · {formatDay(d.transaction_date)}</span>
                      </span>
                      <span className="shrink-0 tabular-nums">{formatMoney(d.total_amount)}</span>
                    </li>
                  ))}
                  {preview.plan.delete.length > SHOWN && (
                    <li className="px-3 py-1.5 text-muted-foreground">and {preview.plan.delete.length - SHOWN} more</li>
                  )}
                </ul>
              )}

              {counts.delete_on_jobs > 0 && (
                <p className="text-xs text-muted-foreground">
                  {counts.delete_on_jobs} of these {counts.delete_on_jobs === 1 ? "is" : "are"} tagged to a job, so that
                  job&apos;s costs go down.
                </p>
              )}

              {counts.keep > 0 && (
                <p className="rounded-md border bg-muted/40 p-3 text-xs">
                  <strong>{plural(counts.keep, "expense")}</strong> {counts.keep === 1 ? "has" : "have"} a receipt attached, so{" "}
                  {counts.keep === 1 ? "it stays" : "they stay"}. {counts.keep === 1 ? "Its" : "Their"} charge
                  stays marked as already imported, so uploading this statement again won&apos;t add{" "}
                  {counts.keep === 1 ? "it" : "them"} twice.
                </p>
              )}

              {counts.unlink > 0 && (
                <p className="text-xs text-muted-foreground">
                  {plural(counts.unlink, "receipt")} you had matched to this statement {counts.unlink === 1 ? "is" : "are"} not
                  deleted - {counts.unlink === 1 ? "it is" : "they are"} just unlinked.
                </p>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={applying}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!preview || applying}
            onClick={() => preview && confirm(preview.expect)}
          >
            {applying && <Loader2 className="h-4 w-4 animate-spin" />}
            {counts && counts.delete > 0 ? `Delete ${plural(counts.delete, "expense")} and the statement` : "Delete the statement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
