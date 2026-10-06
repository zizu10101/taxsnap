"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBankAccounts } from "@/components/owner-lists-provider";
import {
  finalizeImport,
  prepareStatement,
  runChunks,
  startImport,
  StatementApiError,
  StatementFileError,
  type ChunkPlanRow,
  type ChunkRunState,
  type PreparedStatement,
} from "@/lib/statement-client";
import { STATEMENT_MAX_FILE_BYTES, STATEMENT_MAX_PAGES } from "@/lib/statement-config";

type Phase = "idle" | "preparing" | "reading" | "partial" | "finalizing";

function pagesLabel(row: { page_from: number; page_to: number }) {
  return row.page_from === row.page_to ? `Page ${row.page_from}` : `Pages ${row.page_from}-${row.page_to}`;
}

// "Import Statement" on the Expenses toolbar: pick the card and the statement
// file, and it is read page by page. Nothing is saved as an expense here - when
// every page is read you land on the review screen. The file is only ever held
// in this browser tab; it is not uploaded anywhere.
export function StatementImportButton() {
  const router = useRouter();
  const accounts = useBankAccounts();
  const cards = useMemo(
    () => accounts.filter((a) => a.account_type === "card" && a.is_active),
    [accounts],
  );
  const cardItems = useMemo(() => Object.fromEntries(cards.map((c) => [c.id, c.name])), [cards]);

  const [open, setOpen] = useState(false);
  const [cardId, setCardId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<ChunkPlanRow[]>([]);
  const [states, setStates] = useState<Record<number, ChunkRunState>>({});
  const preparedRef = useRef<PreparedStatement | null>(null);
  const importIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const busy = phase === "preparing" || phase === "reading" || phase === "finalizing";
  const effectiveCardId = cardId || (cards.length === 1 ? cards[0].id : "");

  function reset() {
    setFiles([]);
    setPhase("idle");
    setError(null);
    setPlan([]);
    setStates({});
    preparedRef.current = null;
    importIdRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      // Closing mid-read stops new pages from starting; the draft stays and the
      // same file picks it up again from where it left off.
      abortRef.current?.abort();
      reset();
    }
    setOpen(next);
  }

  async function read(importId: string, rows: ChunkPlanRow[], prepared: PreparedStatement) {
    setPhase("reading");
    abortRef.current = new AbortController();
    const allDone = await runChunks(
      importId,
      rows,
      prepared,
      (chunkNo, state) => {
        setStates((prev) => ({ ...prev, [chunkNo]: state }));
        if (state.status === "done") {
          setPlan((prev) => prev.map((r) => (r.chunk_no === chunkNo ? { ...r, status: "done" } : r)));
        }
      },
      abortRef.current.signal,
    );
    if (abortRef.current.signal.aborted) return;
    if (!allDone) {
      setPhase("partial");
      return;
    }
    setPhase("finalizing");
    await finalizeImport(importId);
    toast.success("Statement read. Review the lines before anything is saved.");
    router.push(`/dashboard/expenses/statements/${importId}`);
  }

  function describe(err: unknown): string {
    if (err instanceof StatementFileError || err instanceof StatementApiError) return err.message;
    return err instanceof Error ? err.message : "Something went wrong.";
  }

  async function handleStart() {
    if (!effectiveCardId || files.length === 0) return;
    setError(null);
    setPhase("preparing");
    try {
      const prepared = await prepareStatement(files);
      preparedRef.current = prepared;
      const started = await startImport(effectiveCardId, prepared);
      importIdRef.current = started.importId;
      if (started.resumed) toast.info("Picking up your earlier import of this file.");
      setPlan(started.chunks);
      setStates({});
      await read(started.importId, started.chunks, prepared);
    } catch (err) {
      setError(describe(err));
      setPhase("idle");
    }
  }

  async function handleRetry() {
    const prepared = preparedRef.current;
    const importId = importIdRef.current;
    if (!prepared || !importId) return;
    setError(null);
    try {
      await read(importId, plan, prepared);
    } catch (err) {
      setError(describe(err));
      setPhase("partial");
    }
  }

  async function handleDiscard() {
    const importId = importIdRef.current;
    if (importId) {
      await fetch(`/api/statements/${importId}/discard`, { method: "POST" }).catch(() => undefined);
    }
    handleOpenChange(false);
  }

  const failed = plan.filter((r) => states[r.chunk_no]?.status === "failed");
  // A file the reader rejected outright (password-protected, damaged) reads no
  // better a second time, so there is nothing to retry - only discard.
  const canRetry = failed.some((r) => {
    const s = states[r.chunk_no];
    return s?.status === "failed" && s.retryable;
  });

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <FileText className="h-4 w-4" />
        Import Statement
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Import a card statement</DialogTitle>
            <DialogDescription>
              We read the statement page by page, then you review every line before anything
              is saved. The file stays in your browser; it is not stored.
            </DialogDescription>
          </DialogHeader>

          {phase === "idle" && (
            <div className="grid gap-4">
              {cards.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Add the credit card first -{" "}
                  <Link href="/dashboard/settings" className="underline underline-offset-2">
                    Settings, Accounts
                  </Link>
                  .
                </p>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="statement_card">Which card is this statement for?</Label>
                  <Select
                    items={cardItems}
                    value={effectiveCardId}
                    onValueChange={(v) => v && setCardId(v)}
                  >
                    <SelectTrigger id="statement_card" className="w-full">
                      <SelectValue placeholder="Choose a card" />
                    </SelectTrigger>
                    <SelectContent>
                      {cards.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="statement_file">Statement file</Label>
                <input
                  ref={fileInputRef}
                  id="statement_file"
                  type="file"
                  multiple
                  accept="application/pdf,image/*"
                  className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5 file:text-sm"
                  onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                />
                <p className="text-xs text-muted-foreground">
                  A PDF (up to {Math.round(STATEMENT_MAX_FILE_BYTES / 1024 / 1024)} MB and{" "}
                  {STATEMENT_MAX_PAGES} pages) or up to {STATEMENT_MAX_PAGES} photos of the pages,
                  in order.
                </p>
              </div>
            </div>
          )}

          {phase === "preparing" && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Opening the file...
            </p>
          )}

          {(phase === "reading" || phase === "partial" || phase === "finalizing") && (
            <ul className="space-y-1.5 text-sm">
              {plan.map((row) => {
                const state = states[row.chunk_no];
                const done = row.status === "done" || state?.status === "done";
                return (
                  <li key={row.chunk_no} className="flex items-start gap-2">
                    {done ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    ) : state?.status === "failed" ? (
                      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    ) : state?.status === "running" ? (
                      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
                    ) : (
                      <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border" />
                    )}
                    <span className="min-w-0">
                      {pagesLabel(row)}
                      {state?.status === "failed" && (
                        <span className="block text-xs text-destructive">{state.message}</span>
                      )}
                    </span>
                  </li>
                );
              })}
              {phase === "finalizing" && (
                <li className="flex items-center gap-2 pt-1 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking for duplicates and matching receipts...
                </li>
              )}
            </ul>
          )}

          {phase === "partial" && canRetry && (
            <p className="text-xs text-muted-foreground">
              {failed.length} part{failed.length === 1 ? "" : "s"} couldn&apos;t be read. The pages
              that were read are kept - retry just the ones that failed.
            </p>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            {phase === "idle" && (
              <>
                <Button variant="outline" onClick={() => handleOpenChange(false)}>
                  Cancel
                </Button>
                <Button onClick={handleStart} disabled={!effectiveCardId || files.length === 0}>
                  Read statement
                </Button>
              </>
            )}
            {phase === "partial" && (
              <>
                <Button variant="outline" onClick={handleDiscard}>
                  Discard import
                </Button>
                {canRetry && <Button onClick={handleRetry}>Retry failed pages</Button>}
              </>
            )}
            {busy && phase !== "preparing" && (
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Stop
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
