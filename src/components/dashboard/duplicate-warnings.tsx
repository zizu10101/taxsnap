"use client";

import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AttachedSummary, DuplicateSummary } from "@/lib/receipt-duplicates";

// The two duplicate warnings on receipt scanning. Both are only WARNINGS: neither ever blocks a
// save, and each has an explicit way to go ahead.
//  - ExactFileDuplicateDialog: the very same file was already scanned (matched by its SHA-256).
//    Shown BEFORE any parsing or upload; "Continue anyway" carries on, "Cancel" stops.
//  - SimilarReceiptsWarning: after extraction, a receipt with the same cleaned merchant, total and
//    a date within 2 days already exists. The review dialog's save button then reads "Save anyway".
//  - AlreadyAttachedWarning: this scan matches a card-statement expense that ALREADY has a receipt
//    attached, so saving it as a new expense would count the charge twice.
// "View existing receipt" opens the receipt in a NEW TAB (/dashboard/expenses?receipt=<id>), so the
// scan in progress is never lost.

function money(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}
function day(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
const viewHref = (id: string) => `/dashboard/expenses?receipt=${encodeURIComponent(id)}`;

function MatchList({ matches }: { matches: DuplicateSummary[] }) {
  return (
    <ul className="space-y-1.5">
      {matches.map((m) => (
        <li key={m.id} className="flex items-center justify-between gap-3 rounded-md border bg-background px-2.5 py-1.5 text-sm">
          <span className="min-w-0">
            <span className="block truncate font-medium">{m.merchant_name}</span>
            <span className="block text-xs text-muted-foreground">
              {day(m.transaction_date)} · {money(m.total_amount)}
            </span>
          </span>
          <a
            href={viewHref(m.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-xs text-primary underline underline-offset-2"
          >
            View existing receipt
          </a>
        </li>
      ))}
    </ul>
  );
}

export function ExactFileDuplicateDialog({
  matches,
  onCancel,
  onContinue,
}: {
  /** null = closed. */
  matches: DuplicateSummary[] | null;
  onCancel: () => void;
  onContinue: () => void;
}) {
  return (
    <Dialog open={!!matches} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>You already scanned this file</DialogTitle>
          <DialogDescription>
            This exact file was saved before, so it may be a duplicate. Nothing has been uploaded or
            read yet.
          </DialogDescription>
        </DialogHeader>
        {matches && <MatchList matches={matches} />}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onContinue}>Continue anyway</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AlreadyAttachedWarning({ matches }: { matches: AttachedSummary[] }) {
  if (matches.length === 0) return null;
  return (
    <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
      <p className="flex items-center gap-1.5 font-medium">
        <TriangleAlert className="h-4 w-4 shrink-0 text-destructive" />
        This charge already has a receipt
      </p>
      <p className="text-xs text-muted-foreground">
        {matches.length === 1
          ? `Your ${matches[0].merchant_name} charge on ${day(matches[0].transaction_date)} (${money(matches[0].total_amount)}) already has a receipt attached${matches[0].attached_on ? ` (on ${day(matches[0].attached_on)})` : ""}.`
          : "These card charges already have a receipt attached."}{" "}
        Saving this as a new expense would count it twice. If it&apos;s a different purchase, just save it.
      </p>
      <MatchList matches={matches} />
    </div>
  );
}

export function SimilarReceiptsWarning({ matches }: { matches: DuplicateSummary[] }) {
  if (matches.length === 0) return null;
  return (
    <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
      <p className="flex items-center gap-1.5 font-medium">
        <TriangleAlert className="h-4 w-4 shrink-0 text-destructive" />
        You may have already saved this receipt
      </p>
      <p className="text-xs text-muted-foreground">
        Same merchant, same total, within 2 days. If it&apos;s a different purchase, just save it.
      </p>
      <MatchList matches={matches} />
    </div>
  );
}

// Looks for similar saved receipts (and already-attached statement expenses) as the review form's
// merchant, total or date change, after a
// short pause (not on every keystroke). Only the answer for the CURRENT values is returned, so a
// stale one never lingers while the person is typing.
export interface DuplicateChecks {
  similar: DuplicateSummary[];
  attached: AttachedSummary[];
}
const NO_MATCHES: DuplicateChecks = { similar: [], attached: [] };

export function useDuplicateChecks(enabled: boolean, total: number, date: string, merchant: string): DuplicateChecks {
  const key = enabled && total > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date) && merchant.trim() ? `${total}|${date}|${merchant}` : "";
  const [result, setResult] = useState<{ key: string; checks: DuplicateChecks }>({ key: "", checks: NO_MATCHES });

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ total: String(total), date, merchant });
        const res = await fetch(`/api/receipts/duplicate-check?${params}`);
        if (!res.ok || cancelled) return;
        const body = await res.json();
        if (!cancelled) {
          setResult({
            key,
            checks: {
              similar: (body.similar ?? []) as DuplicateSummary[],
              attached: (body.attached ?? []) as AttachedSummary[],
            },
          });
        }
      } catch {
        // Best effort: a warning that can't be fetched is simply not shown.
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, total, date, merchant]);

  return key && result.key === key ? result.checks : NO_MATCHES;
}
