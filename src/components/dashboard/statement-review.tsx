"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { LineRow, formatDay, formatMoney, type PatchFn } from "@/components/dashboard/statement-review-line";
import { useBankAccounts } from "@/components/owner-lists-provider";
import {
  finalizeImport,
  prepareStatement,
  runChunks,
  StatementApiError,
  StatementFileError,
  type ChunkRunState,
} from "@/lib/statement-client";
import {
  GROUP_ORDER,
  canSave,
  groupOf,
  summarize,
  type ReviewGroup,
  type ReviewLine,
} from "@/lib/statement-review-model";
import type { ReviewLineData, StatementReviewData } from "@/lib/statement-review-data";

const GROUP_COPY: Record<ReviewGroup, { title: string; help: string }> = {
  possible_matches: {
    title: "Possible receipt matches",
    help: "These charges look like receipts you already scanned. Pick the right one, or save as a new expense.",
  },
  new: {
    title: "New expenses",
    help: "No receipt on file. Saved with no HST and flagged \"No receipt, ITC not claimed\". Scan the receipt later and it fills this expense in.",
  },
  refunds: {
    title: "Refunds and credits",
    help: "Saved as a negative expense. HST is not adjusted unless you enter the HST from your refund slip.",
  },
  bank_charges: {
    title: "Interest and fees",
    help: "Interest and card fees. Accept the suggested category, or choose another.",
  },
  already_imported: {
    title: "Already imported",
    help: "An earlier statement already saved these charges, so they're skipped. Choose Import anyway only if one is genuinely a second charge.",
  },
  matched: {
    title: "Matched to your receipts",
    help: "Linked to a receipt you already have. Nothing new is created.",
  },
  excluded: { title: "Excluded", help: "Not saved." },
  payments: { title: "Payments to the card", help: "Not expenses, so they're ignored." },
};

function toReviewLine(l: ReviewLineData): ReviewLine {
  return {
    id: l.id,
    kind: l.kind,
    amount: l.amount,
    resolution: l.resolution,
    category: l.category,
    category_confirmed: l.category_confirmed,
    duplicate_of_line_id: l.duplicate_of_line_id,
    duplicate_override: l.duplicate_override,
    candidate_count: l.candidates.length,
  };
}

export function StatementReview({ initial }: { initial: StatementReviewData }) {
  const router = useRouter();
  const accounts = useBankAccounts();
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const importId = data.import.id;
  const card = accounts.find((a) => a.id === data.import.account_id);

  async function reload() {
    const res = await fetch(`/api/statements/${importId}`);
    if (res.ok) setData((await res.json()) as StatementReviewData);
  }

  const patchLines: PatchFn = async (ids, patch) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/statements/${importId}/lines`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ line_ids: ids, patch }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Couldn't save that change.");
        return false;
      }
      await reload();
      return true;
    } finally {
      setBusy(false);
    }
  };

  const reviewLines = useMemo(() => data.lines.map(toReviewLine), [data.lines]);
  const summary = useMemo(() => summarize(reviewLines), [reviewLines]);
  const grouped = useMemo(() => {
    const map = new Map<ReviewGroup, ReviewLineData[]>();
    for (const line of data.lines) {
      const g = groupOf(toReviewLine(line));
      map.set(g, [...(map.get(g) ?? []), line]);
    }
    return map;
  }, [data.lines]);

  const incomplete = data.chunks.some((c) => c.status !== "done");
  const ready = canSave(reviewLines, data.reconcile, acknowledged);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/statements/${importId}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledge_reconcile: acknowledged }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Couldn't save the statement.");
        await reload();
        return;
      }
      const r = body.result as { created: number; matched: number; skipped_as_already_imported: number };
      toast.success(
        `Saved ${r.created} expense${r.created === 1 ? "" : "s"}, matched ${r.matched} receipt${r.matched === 1 ? "" : "s"}` +
          (r.skipped_as_already_imported ? `, skipped ${r.skipped_as_already_imported} already imported` : ""),
      );
      router.push("/dashboard/expenses");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleDiscard() {
    if (!confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    await fetch(`/api/statements/${importId}/discard`, { method: "POST" });
    router.push("/dashboard/expenses");
  }

  if (incomplete) {
    return <RetryPanel data={data} onDone={reload} onDiscard={handleDiscard} confirmDiscard={confirmDiscard} />;
  }

  const rc = data.reconcile;
  const suggestionIds = (g: ReviewGroup) =>
    (grouped.get(g) ?? [])
      .filter((l) => !l.category_confirmed && l.suggested_category && l.resolution !== "skipped")
      .map((l) => l.id);

  return (
    <div className="space-y-6 pb-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {data.import.issuer ?? "Card statement"}
            {card ? ` · ${card.name}` : ""}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {data.import.period_start && data.import.period_end
              ? `${formatDay(data.import.period_start)} to ${formatDay(data.import.period_end)} · `
              : ""}
            {summary.total} lines
          </p>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {rc.status === "matches" && (
            <p className="flex items-start gap-2 text-success">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              The lines add up to the statement ({formatMoney(rc.extracted)}
              {rc.basis === "balance_roll" ? ", from the balances" : ", total purchases"}).
            </p>
          )}
          {rc.status === "off" && (
            <div className="space-y-2">
              <p className="flex items-start gap-2 text-destructive">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  The lines add up to {formatMoney(rc.extracted)} but the statement says{" "}
                  {formatMoney(rc.expected)} - off by {formatMoney(Math.abs(rc.diff))}
                  {rc.diff < 0 ? " (a line may be missing)" : " (a line may be extra or misread)"}. Check
                  the amounts against your statement.
                </span>
              </p>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="ack-reconcile"
                  checked={acknowledged}
                  onCheckedChange={(c) => setAcknowledged(c === true)}
                />
                <Label htmlFor="ack-reconcile" className="text-sm font-normal">
                  I&apos;ve checked this and want to save anyway
                </Label>
              </div>
            </div>
          )}
          {rc.status === "no_total" && (
            <p className="flex items-start gap-2 text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              No statement total was found to check these lines against.
            </p>
          )}
          <p className="text-muted-foreground">
            {summary.willMatch} matched · {summary.willCreate} new expenses · {summary.willSkip} skipped
            {summary.alreadyImported > 0 ? ` (${summary.alreadyImported} already imported)` : ""} ·{" "}
            <span className={summary.needsDecision > 0 ? "font-medium text-foreground" : ""}>
              {summary.needsDecision} need a decision
            </span>
          </p>
        </CardContent>
      </Card>

      {data.lines.length === 0 && (
        <p className="text-sm text-muted-foreground">No transaction lines were found on this statement.</p>
      )}

      {GROUP_ORDER.map((g) => {
        const rows = grouped.get(g);
        if (!rows || rows.length === 0) return null;
        const ids = suggestionIds(g);
        return (
          <section key={g} className="space-y-1">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold">
                  {GROUP_COPY[g].title} <span className="text-muted-foreground">({rows.length})</span>
                </h2>
                <p className="text-xs text-muted-foreground">{GROUP_COPY[g].help}</p>
              </div>
              {ids.length > 0 && (g === "new" || g === "bank_charges" || g === "refunds") && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => patchLines(ids, { accept_suggestion: true })}
                >
                  Accept {ids.length} suggested categor{ids.length === 1 ? "y" : "ies"}
                </Button>
              )}
            </div>
            <ul className="rounded-lg border px-3">
              {rows.map((line) => (
                <LineRow
                  key={line.id}
                  line={line}
                  group={g}
                  categories={data.categories}
                  cardId={data.import.account_id}
                  disabled={busy || saving}
                  onPatch={patchLines}
                />
              ))}
            </ul>
          </section>
        );
      })}

      {/* In-flow rather than fixed/sticky: the dashboard's own mobile nav is
          sticky at the bottom, and a second bottom bar would sit on top of it. */}
      <div className="border-t pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" onClick={handleDiscard} disabled={saving}>
            {confirmDiscard ? "Click again to discard" : "Discard import"}
          </Button>
          <div className="flex items-center gap-3">
            {summary.needsDecision > 0 && (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {summary.needsDecision} line{summary.needsDecision === 1 ? "" : "s"} still need a decision
              </span>
            )}
            <Button onClick={handleSave} disabled={!ready || saving || busy}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save {summary.willCreate + summary.willMatch} line{summary.willCreate + summary.willMatch === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Shown instead of the lines while some pages are still unread (a chunk failed,
// or the page was reopened). Only the unread chunks are retried - everything
// already read is kept. The file isn't stored, so it has to be chosen again, and
// it must be the same file the import started with.
function RetryPanel({
  data,
  onDone,
  onDiscard,
  confirmDiscard,
}: {
  data: StatementReviewData;
  onDone: () => Promise<void>;
  onDiscard: () => void;
  confirmDiscard: boolean;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [states, setStates] = useState<Record<number, ChunkRunState>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const unread = data.chunks.filter((c) => c.status !== "done");

  async function retry() {
    setError(null);
    setRunning(true);
    try {
      const prepared = await prepareStatement(files);
      if (prepared.sha256 !== data.import.file_sha256) {
        throw new StatementFileError("That isn't the file this import started with. Choose the same statement file.");
      }
      const ok = await runChunks(data.import.id, data.chunks, prepared, (n, s) =>
        setStates((prev) => ({ ...prev, [n]: s })),
      );
      if (ok) await finalizeImport(data.import.id);
      await onDone();
    } catch (err) {
      setError(
        err instanceof StatementFileError || err instanceof StatementApiError
          ? err.message
          : "Something went wrong.",
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Some pages still need to be read</CardTitle>
        <p className="text-sm text-muted-foreground">
          {unread.length} of {data.chunks.length} part{data.chunks.length === 1 ? "" : "s"} unread. What was
          already read is kept. Choose the same statement file to read the rest.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-1 text-sm">
          {unread.map((c) => {
            const s = states[c.chunk_no];
            return (
              <li key={c.chunk_no} className="flex items-center gap-2">
                {s?.status === "running" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CircleAlert className="h-4 w-4 text-destructive" />
                )}
                {c.page_from === c.page_to ? `Page ${c.page_from}` : `Pages ${c.page_from}-${c.page_to}`}
                {s?.status === "failed" && <span className="text-xs text-destructive">{s.message}</span>}
              </li>
            );
          })}
        </ul>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="application/pdf,image/*"
          className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5 file:text-sm"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button onClick={retry} disabled={files.length === 0 || running}>
            {running && <Loader2 className="h-4 w-4 animate-spin" />}
            Read the rest
          </Button>
          <Button variant="ghost" onClick={onDiscard} disabled={running}>
            {confirmDiscard ? "Click again to discard" : "Discard import"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
