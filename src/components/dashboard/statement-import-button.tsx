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
import {
  alreadyImportedMessage,
  capAllowsReimport,
  capNote,
  reimportBringsBack,
  type AlreadyImportedInfo,
} from "@/lib/statement-reimport";
import { STATEMENTS_HREF } from "@/lib/statement-routes";
import { ElapsedClock, WholeFileStatus } from "@/components/dashboard/statement-progress";
import { formatDuration, type ClientChunkTiming, type ClientTimings } from "@/lib/statement-timing";

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
  // Set when this exact file was already saved: shows what exists and offers Re-import.
  const [alreadyImported, setAlreadyImported] = useState<AlreadyImportedInfo | null>(null);
  const [plan, setPlan] = useState<ChunkPlanRow[]>([]);
  const [states, setStates] = useState<Record<number, ChunkRunState>>({});
  const preparedRef = useRef<PreparedStatement | null>(null);
  const importIdRef = useRef<string | null>(null);
  // When this run began (Date.now()), and how the file is being read, for the clock and the message.
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [readMode, setReadMode] = useState<"split" | "whole" | null>(null);
  const [pageCount, setPageCount] = useState(0);
  // The browser's own timing of this import, sent to the server's log with the finalize request.
  const timingRef = useRef<{ prepare_ms: number; start_ms: number }>({ prepare_ms: 0, start_ms: 0 });
  const chunkTimingsRef = useRef<ClientChunkTiming[]>([]);
  const readStartRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const busy = phase === "preparing" || phase === "reading" || phase === "finalizing";
  const effectiveCardId = cardId || (cards.length === 1 ? cards[0].id : "");

  function reset() {
    setFiles([]);
    setPhase("idle");
    setError(null);
    setAlreadyImported(null);
    setPlan([]);
    setStates({});
    setStartedAt(null);
    setReadMode(null);
    preparedRef.current = null;
    importIdRef.current = null;
    chunkTimingsRef.current = [];
    readStartRef.current = null;
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
    readStartRef.current ??= performance.now();
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
      chunkTimingsRef.current,
    );
    if (abortRef.current.signal.aborted) return;
    if (!allDone) {
      setPhase("partial");
      return;
    }
    setPhase("finalizing");
    // The browser's side of the timing goes to the server log with the finalize request, so one
    // import's whole picture (browser and server) is in one place. Numbers only, no content.
    const summary: ClientTimings = {
      ...timingRef.current,
      read_ms: Math.round(performance.now() - (readStartRef.current ?? performance.now())),
      chunks: chunkTimingsRef.current,
      mode: prepared.mode,
      pages: prepared.pageCount,
      file_bytes: files.reduce((sum, f) => sum + f.size, 0),
    };
    console.info("[statement-timing] browser", summary);
    await finalizeImport(importId, summary);
    toast.success("Statement read. Review the lines before anything is saved.");
    router.push(`/dashboard/expenses/statements/${importId}`);
  }

  function describe(err: unknown): string {
    if (err instanceof StatementFileError || err instanceof StatementApiError) return err.message;
    return err instanceof Error ? err.message : "Something went wrong.";
  }

  async function handleStart(reimportOf?: string) {
    if (!effectiveCardId || files.length === 0) return;
    setError(null);
    setAlreadyImported(null);
    setStartedAt(Date.now());
    setReadMode(null);
    chunkTimingsRef.current = [];
    readStartRef.current = null;
    setPhase("preparing");
    try {
      // Browser read + hash: opening the file, fingerprinting it, checking and slicing its pages.
      const t0 = performance.now();
      const prepared = await prepareStatement(files);
      const prepareMs = Math.round(performance.now() - t0);
      preparedRef.current = prepared;
      setReadMode(prepared.mode);
      setPageCount(prepared.pageCount);
      const t1 = performance.now();
      const started = await startImport(effectiveCardId, prepared, { reimportOf });
      timingRef.current = { prepare_ms: prepareMs, start_ms: Math.round(performance.now() - t1) };
      importIdRef.current = started.importId;
      if (started.resumed) toast.info("Picking up your earlier import of this file.");
      setPlan(started.chunks);
      setStates({});
      await read(started.importId, started.chunks, prepared);
    } catch (err) {
      const info = err instanceof StatementApiError ? (err.details?.already_imported as AlreadyImportedInfo | undefined) : undefined;
      if (err instanceof StatementApiError && err.code === "ALREADY_IMPORTED" && info) {
        // Not a dead end: say what exists, link to it, and offer Re-import when there is something to bring back.
        setAlreadyImported(info);
      } else {
        setError(describe(err));
      }
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
                  onChange={(e) => {
                    setFiles(Array.from(e.target.files ?? []));
                    setAlreadyImported(null);
                  }}
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
              Opening the file... <ElapsedClock since={startedAt} />
            </p>
          )}

          {/* A PDF that can't be split is read in ONE piece: one clear message and a clock, never a
              frozen spinner. (If it fails, the list below shows the reason.) */}
          {readMode === "whole" && phase === "reading" && failed.length === 0 && (
            <WholeFileStatus since={startedAt} pages={pageCount} />
          )}

          {(phase === "reading" || phase === "partial" || phase === "finalizing") &&
            !(readMode === "whole" && phase === "reading" && failed.length === 0) && (
            <p className="text-xs text-muted-foreground">
              Reading your statement · <ElapsedClock since={startedAt} />
            </p>
          )}

          {(phase === "reading" || phase === "partial" || phase === "finalizing") &&
            !(readMode === "whole" && phase === "reading" && failed.length === 0) && (
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
                      {state?.status === "running" && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          reading... <ElapsedClock since={state.startedAt} />
                        </span>
                      )}
                      {state?.status === "done" && (
                        <span className="ml-2 text-xs text-muted-foreground">{formatDuration(state.ms)}</span>
                      )}
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

          {alreadyImported && phase === "idle" && (
            <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p className="font-medium">{alreadyImportedMessage(alreadyImported)}</p>
              {alreadyImported.can_reimport ? (
                <>
                  <p className="text-xs text-muted-foreground">{reimportBringsBack(alreadyImported.free)}</p>
                  <p className="text-xs text-muted-foreground">
                    Lines whose expense still exists stay protected: they come up as &quot;Already
                    imported&quot;, so nothing is added twice.
                  </p>
                  <p className="text-xs text-muted-foreground">{capNote(alreadyImported.cap)}</p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Every line that could be an expense still has one, so there is nothing to bring back.
                </p>
              )}
              <p className="text-xs">
                <Link href={STATEMENTS_HREF} className="text-primary underline underline-offset-2">
                  View your statements
                </Link>
              </p>
            </div>
          )}

          <DialogFooter>
            {phase === "idle" && (
              <>
                <Button variant="outline" onClick={() => handleOpenChange(false)}>
                  Cancel
                </Button>
                {alreadyImported?.can_reimport ? (
                  <Button
                    onClick={() => handleStart(alreadyImported.import_id)}
                    disabled={!effectiveCardId || files.length === 0 || !capAllowsReimport(alreadyImported.cap)}
                  >
                    Re-import this statement
                  </Button>
                ) : (
                  <Button onClick={() => handleStart()} disabled={!effectiveCardId || files.length === 0 || !!alreadyImported}>
                    Read statement
                  </Button>
                )}
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
