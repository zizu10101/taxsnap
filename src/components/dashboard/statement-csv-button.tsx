"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBankAccounts } from "@/components/owner-lists-provider";
import { accountDisplayName, accountTypeOf, paidWithAccounts } from "@/lib/accounts";
import type { ParsedTable } from "@/lib/client-import";
import { DATE_ORDER_LABELS, type DateOrder } from "@/lib/expense-import";
import { sha256Hex } from "@/lib/statement-pdf";
import { STATEMENTS_HREF } from "@/lib/statement-routes";
import {
  AMOUNT_LAYOUT_LABELS,
  SIGN_CONVENTION_LABELS,
  STATEMENT_CSV_MAX_BYTES,
  STATEMENT_CSV_MAX_ROWS,
  STATEMENT_CSV_TARGETS,
  STATEMENT_CSV_TARGET_LABELS,
  buildStatementRows,
  defaultConventionFor,
  guessStatementMapping,
  layoutFromMapping,
  parseSavedStatementMapping,
  readStatementCsv,
  statementDateQuestion,
  statementHeadingsKey,
  statementMappingProblems,
  type AmountLayout,
  type BalanceCheck,
  type CsvRowStatus,
  type MoneyTotals,
  type PlannedCsvRow,
  type SignConvention,
  type StatementCsvProblem,
  type StatementCsvRow,
  type StatementCsvTarget,
} from "@/lib/statement-csv";

const money = (n: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(n);
const NO_DATE_ORDER = "__choose__";

type Step = "file" | "map" | "preview";

// Browser storage can be blocked or full: remembering the mapping is a nicety, so every access is wrapped.
function readSaved(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeSaved(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

const STATUS_BADGE: Record<CsvRowStatus, { label: string; className: string }> = {
  ready: { label: "Ready", className: "bg-success text-success-foreground" },
  duplicate: { label: "Already imported", className: "bg-warning/20 text-warning" },
  total: { label: "Looks like a total", className: "bg-warning/20 text-warning" },
  ignored: { label: "Left out", className: "bg-muted text-muted-foreground" },
  error: { label: "Error", className: "bg-destructive/10 text-destructive" },
};

interface PreviewData {
  rows: PlannedCsvRow[];
  totals: MoneyTotals;
  balance: BalanceCheck;
}

// "Import CSV" beside "Import Statement": a bank or card statement exported as a CSV. The file is read here in
// the browser and only the mapped rows are POSTed to /api/statements/csv (preview, then apply after Confirm);
// the server re-checks everything. Confirm creates the same draft the PDF path does and lands on its review
// screen - nothing becomes an expense here. No AI is involved.
export function StatementCsvButton() {
  const router = useRouter();
  const accounts = paidWithAccounts(useBankAccounts());
  const accountItems = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, accountDisplayName(a, { withType: true })])),
    [accounts],
  );

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("file");
  const [accountId, setAccountId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [table, setTable] = useState<ParsedTable | null>(null);
  const [overflowRows, setOverflowRows] = useState<Set<number>>(new Set());
  const [preambleLines, setPreambleLines] = useState(0);
  const [fileSha, setFileSha] = useState("");
  const [mapping, setMapping] = useState<StatementCsvTarget[]>([]);
  const [remembered, setRemembered] = useState(false);
  const [layout, setLayout] = useState<AmountLayout>("signed");
  const [conventionChoice, setConventionChoice] = useState<SignConvention | "">("");
  const [dateOrder, setDateOrder] = useState<DateOrder | "">("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [opening, setOpening] = useState("");
  const [closing, setClosing] = useState("");
  const [busy, setBusy] = useState(false);

  const [inputs, setInputs] = useState<StatementCsvRow[]>([]);
  const [problems, setProblems] = useState<StatementCsvProblem[]>([]);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [included, setIncluded] = useState<Set<number>>(new Set());

  const account = accounts.find((a) => a.id === accountId) ?? null;
  // Starts on the account's own convention (a card is "positive = a charge"); the person can change it.
  const convention: SignConvention = conventionChoice || defaultConventionFor(account ? accountTypeOf(account) : null);

  function reset() {
    setStep("file");
    setAccountId("");
    setFile(null);
    setError(null);
    setTable(null);
    setOverflowRows(new Set());
    setPreambleLines(0);
    setFileSha("");
    setMapping([]);
    setRemembered(false);
    setLayout("signed");
    setConventionChoice("");
    setDateOrder("");
    setPeriodStart("");
    setPeriodEnd("");
    setOpening("");
    setClosing("");
    setInputs([]);
    setProblems([]);
    setPreview(null);
    setIncluded(new Set());
  }

  function handleOpenChange(next: boolean) {
    if (busy) return;
    if (!next) reset();
    setOpen(next);
  }

  async function handleContinueFromFile() {
    if (!accountId) return setError("Choose the account this statement is for.");
    if (!file) return setError("Choose a .csv file first.");
    if (file.size > STATEMENT_CSV_MAX_BYTES) {
      return setError(`That file is over ${STATEMENT_CSV_MAX_BYTES / 1024 / 1024} MB. Split it into smaller files.`);
    }
    const text = await file.text();
    const read = readStatementCsv(text);
    if (read.table.headers.length === 0 || read.table.rows.length === 0) {
      return setError("Found no rows. The file needs a row of column names followed by one row per transaction.");
    }
    if (read.table.rows.length > STATEMENT_CSV_MAX_ROWS) {
      return setError(
        `Found ${read.table.rows.length} rows. An import can have at most ${STATEMENT_CSV_MAX_ROWS.toLocaleString("en-CA")}. Split it into smaller files.`,
      );
    }
    setError(null);
    setFileSha(await sha256Hex(file));
    setTable(read.table);
    setOverflowRows(read.overflowRows);
    setPreambleLines(read.preambleLines);
    // The mapping used for a file with these exact headings last time, if any; otherwise a guess.
    const saved = parseSavedStatementMapping(readSaved(statementHeadingsKey(read.table.headers)), read.table.headers.length);
    const next = saved ?? guessStatementMapping(read.table.headers);
    setMapping(next);
    setLayout(layoutFromMapping(next));
    setRemembered(saved !== null);
    setStep("map");
  }

  // Each field comes from one column: choosing it again moves it and sets the old column to Ignore.
  function setColumn(index: number, target: StatementCsvTarget) {
    setRemembered(false);
    const next = mapping.map((t, i) => (i === index ? target : target !== "ignore" && t === target ? "ignore" : t));
    setMapping(next);
    setLayout(layoutFromMapping(next));
  }

  const dateAnalysis = useMemo(() => (table ? statementDateQuestion(table, mapping) : null), [table, mapping]);
  const blockers = [
    ...(table ? statementMappingProblems(mapping, layout) : []),
    ...(dateAnalysis?.needsChoice && dateOrder === "" ? ["Choose how the dates are written."] : []),
    ...(periodStart && periodEnd && periodEnd < periodStart ? ["The period ends before it starts."] : []),
  ];

  async function post(payload: unknown) {
    const res = await fetch("/api/statements/csv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong");
    return data as Record<string, unknown>;
  }

  const number = (v: string) => (v.trim() === "" ? null : Number(v.replace(/[$,\s]/g, "")));
  const statementFields = () => ({
    account_id: accountId,
    file_sha256: fileSha,
    layout,
    convention,
    ...(periodStart && { period_start: periodStart }),
    ...(periodEnd && { period_end: periodEnd }),
    ...(number(opening) !== null && Number.isFinite(number(opening)) && { opening_balance: number(opening) }),
    ...(number(closing) !== null && Number.isFinite(number(closing)) && { closing_balance: number(closing) }),
  });

  async function handlePreview() {
    if (!table) return;
    const order = dateOrder === "" ? (dateAnalysis?.detected ?? null) : dateOrder;
    const built = buildStatementRows(table, mapping, { layout, dateOrder: order, overflowRows });
    setBusy(true);
    try {
      writeSaved(statementHeadingsKey(table.headers), JSON.stringify(mapping));
      if (built.rows.length === 0) throw new Error("No row could be read. Check the date and amount columns.");
      const data = await post({ mode: "preview", ...statementFields(), rows: built.rows });
      const rows = data.rows as PlannedCsvRow[];
      setInputs(built.rows);
      setProblems(built.problems);
      setPreview({ rows, totals: data.totals as MoneyTotals, balance: data.balance as BalanceCheck });
      // Ready rows start ticked; a duplicate or a total row starts unticked (ticking it = Import anyway).
      setIncluded(new Set(rows.filter((p) => p.status === "ready").map((p) => p.row)));
      setStep("preview");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    const byRow = new Map(preview.rows.map((p) => [p.row, p]));
    const toSend = inputs.map((r) => {
      const p = byRow.get(r.row);
      const on = included.has(r.row);
      return { ...r, skip: !on, import_anyway: on && (p?.status === "duplicate" || p?.status === "total") };
    });
    setBusy(true);
    try {
      const data = await post({ mode: "apply", ...statementFields(), rows: toSend });
      toast.success("Statement read. Review the lines before anything is saved.");
      router.push(typeof data.href === "string" ? data.href : STATEMENTS_HREF);
      handleOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const previewRows = useMemo(() => {
    if (!preview) return [];
    const byRow = new Map(inputs.map((r) => [r.row, r]));
    return [
      ...preview.rows.map((p) => ({ row: p.row, planned: p as PlannedCsvRow | null, problem: null as string | null })),
      ...problems.map((p) => ({ row: p.row, planned: null, problem: p.reason })),
    ]
      .sort((a, b) => a.row - b.row)
      .map((r) => ({ ...r, input: byRow.get(r.row) ?? null }));
  }, [preview, problems, inputs]);

  const counts = {
    ready: preview?.rows.filter((p) => p.status === "ready").length ?? 0,
    duplicate: preview?.rows.filter((p) => p.status === "duplicate").length ?? 0,
    total: preview?.rows.filter((p) => p.status === "total").length ?? 0,
    error: (preview?.rows.filter((p) => p.status === "error").length ?? 0) + problems.length,
  };

  const dateOrderItems: Record<string, string> = { [NO_DATE_ORDER]: "Choose...", ...DATE_ORDER_LABELS };
  const conventionItems = SIGN_CONVENTION_LABELS as Record<string, string>;

  return (
    <>
      <Button variant="outline" size="sm" className="h-auto min-h-11 lg:h-7 lg:min-h-0" onClick={() => setOpen(true)}>
        <FileSpreadsheet className="h-4 w-4" />
        Import statement (CSV)
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className={step === "preview" ? "max-h-[90vh] overflow-y-auto sm:max-w-5xl" : "max-h-[90vh] overflow-y-auto sm:max-w-lg"}>
          <DialogHeader>
            <DialogTitle>Import a statement from CSV</DialogTitle>
            {step === "file" && (
              <DialogDescription>
                A bank or card statement exported as a CSV. You review every line before anything is saved.
              </DialogDescription>
            )}
          </DialogHeader>

          {step === "file" && (
            <div className="grid gap-3">
              {accounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Add the account first -{" "}
                  <Link href="/dashboard/settings" className="underline underline-offset-2">
                    Settings, Accounts
                  </Link>
                  .
                </p>
              ) : (
                <div className="space-y-1.5">
                  <Label>Which account is this statement for?</Label>
                  <Select items={accountItems} value={accountId} onValueChange={(v) => v && setAccountId(v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose an account" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {accountDisplayName(a, { withType: true })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="statement-csv-file">Upload a .csv file</Label>
                <Input
                  id="statement-csv-file"
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    setError(null);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Up to {STATEMENT_CSV_MAX_ROWS.toLocaleString("en-CA")} rows and {STATEMENT_CSV_MAX_BYTES / 1024 / 1024} MB. The file
                  is read in your browser; only the rows are sent.
                </p>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <DialogFooter>
                <Button variant="outline" onClick={() => handleOpenChange(false)}>
                  Cancel
                </Button>
                <Button onClick={handleContinueFromFile}>Continue</Button>
              </DialogFooter>
            </div>
          )}

          {step === "map" && table && (
            <div className="grid gap-3">
              <p className="text-sm text-muted-foreground">
                {table.rows.length} row{table.rows.length === 1 ? "" : "s"} found
                {preambleLines > 0 ? ` (${preambleLines} line${preambleLines === 1 ? "" : "s"} above the column names were set aside)` : ""}
                . Check what each column is.
              </p>
              {remembered && (
                <p className="text-xs text-muted-foreground">Using the mapping you chose for a file with these headings last time.</p>
              )}
              <div className="grid gap-2">
                {table.headers.map((header, i) => (
                  <div key={i} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium">{header || `Column ${i + 1}`}</span>
                    <Select
                      items={STATEMENT_CSV_TARGET_LABELS}
                      value={mapping[i] ?? "ignore"}
                      onValueChange={(v) => v && setColumn(i, v as StatementCsvTarget)}
                    >
                      <SelectTrigger className="w-48 shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATEMENT_CSV_TARGETS.map((t) => (
                          <SelectItem key={t} value={t}>
                            {STATEMENT_CSV_TARGET_LABELS[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>

              <div className="space-y-1.5">
                <Label>How are the amounts laid out?</Label>
                <Select
                  items={AMOUNT_LAYOUT_LABELS}
                  value={layout}
                  onValueChange={(v) => v && setLayout(v as AmountLayout)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(AMOUNT_LAYOUT_LABELS) as AmountLayout[]).map((l) => (
                      <SelectItem key={l} value={l}>
                        {AMOUNT_LAYOUT_LABELS[l]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Which sign means money out?</Label>
                <Select
                  items={conventionItems}
                  value={convention}
                  onValueChange={(v) => v && setConventionChoice(v as SignConvention)}
                  disabled={layout === "debit_credit"}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(SIGN_CONVENTION_LABELS) as SignConvention[]).map((c) => (
                      <SelectItem key={c} value={c}>
                        {SIGN_CONVENTION_LABELS[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {layout === "debit_credit"
                    ? "Not needed: the Debit column is money out and the Credit column is money in."
                    : "The preview shows the money out and money in totals, so a wrong choice is easy to spot."}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="csv-period-start">Period start (optional)</Label>
                  <Input id="csv-period-start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="csv-period-end">Period end (optional)</Label>
                  <Input id="csv-period-end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="csv-opening">Opening balance (optional)</Label>
                  <Input id="csv-opening" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="csv-closing">Closing balance (optional)</Label>
                  <Input id="csv-closing" inputMode="decimal" value={closing} onChange={(e) => setClosing(e.target.value)} />
                </div>
              </div>
              <p className="-mt-1 text-xs text-muted-foreground">
                With both balances the preview checks that they add up. A bank account&apos;s balance is what is in it; a card&apos;s is what is owed.
              </p>

              {dateAnalysis?.needsChoice && (
                <div className="space-y-1.5">
                  <Label>How are the dates written?</Label>
                  <Select
                    items={dateOrderItems}
                    value={dateOrder === "" ? NO_DATE_ORDER : dateOrder}
                    onValueChange={(v) => setDateOrder(v === NO_DATE_ORDER || !v ? "" : (v as DateOrder))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(DATE_ORDER_LABELS) as DateOrder[]).map((o) => (
                        <SelectItem key={o} value={o}>
                          {DATE_ORDER_LABELS[o]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {blockers.length > 0 && (
                <ul className="space-y-0.5 text-sm text-destructive">
                  {blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setStep("file")} disabled={busy}>
                  Back
                </Button>
                <Button onClick={handlePreview} disabled={busy || blockers.length > 0}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Preview
                </Button>
              </DialogFooter>
            </div>
          )}

          {step === "preview" && preview && (
            <div className="grid gap-3">
              <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                <p className="font-medium">
                  Money out {money(preview.totals.out)} ({preview.totals.outCount} line{preview.totals.outCount === 1 ? "" : "s"}) · Money in{" "}
                  {money(preview.totals.in)} ({preview.totals.inCount} line{preview.totals.inCount === 1 ? "" : "s"})
                </p>
                <p className="text-xs text-muted-foreground">
                  If these look swapped, go back and change which sign means money out.
                </p>
                {preview.balance.state === "ok" && (
                  <p className="mt-1 text-xs text-success">The opening and closing balances add up.</p>
                )}
                {preview.balance.state === "off" && (
                  <p className="mt-1 text-xs text-warning">
                    The balances don&apos;t add up: the opening balance and these lines give {money(preview.balance.expected)}, not the closing
                    balance (off by {money(Math.abs(preview.balance.diff))}). You can still continue.
                  </p>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {counts.ready} ready, {counts.duplicate} already imported and {counts.total} that look like totals (skipped unless you tick
                them), {counts.error} errors. Untick a row to skip it. Money in is kept as a payment, not an expense; you can change a line&apos;s
                type on the review screen. Nothing is saved as an expense until you review and save.
              </p>
              <div className="max-h-[45vh] overflow-auto rounded-lg border">
                <table className="w-full min-w-[52rem] text-left text-xs">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">Import</th>
                      <th className="px-2 py-1.5 font-medium">Row</th>
                      <th className="px-2 py-1.5 font-medium">Status</th>
                      <th className="px-2 py-1.5 font-medium">Date</th>
                      <th className="px-2 py-1.5 font-medium">Description</th>
                      <th className="px-2 py-1.5 text-right font-medium">Money out</th>
                      <th className="px-2 py-1.5 text-right font-medium">Money in</th>
                      <th className="px-2 py-1.5 text-right font-medium">Balance</th>
                      <th className="px-2 py-1.5 font-medium">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map(({ row, planned: p, problem }) => {
                      const line = p?.line ?? null;
                      const status: CsvRowStatus = p ? p.status : "error";
                      const badge = STATUS_BADGE[status];
                      const messages = p ? p.messages : problem ? [problem] : [];
                      const flagged = status === "duplicate" || status === "total";
                      return (
                        <tr key={row} className="border-t align-top">
                          <td className="px-2 py-1.5">
                            <Checkbox
                              aria-label={flagged ? `Import row ${row} anyway` : `Import row ${row}`}
                              disabled={!line || status === "error" || status === "ignored"}
                              checked={included.has(row)}
                              onCheckedChange={(c) =>
                                setIncluded((prev) => {
                                  const next = new Set(prev);
                                  if (c) next.add(row);
                                  else next.delete(row);
                                  return next;
                                })
                              }
                            />
                            {flagged && line && <span className="block text-[10px] text-muted-foreground">Import anyway</span>}
                          </td>
                          <td className="px-2 py-1.5 tabular-nums">{row}</td>
                          <td className="px-2 py-1.5">
                            <Badge variant="secondary" className={badge.className}>
                              {badge.label}
                            </Badge>
                          </td>
                          <td className="px-2 py-1.5 whitespace-nowrap">{line?.txn_date ?? ""}</td>
                          <td className="max-w-64 truncate px-2 py-1.5">{line?.description ?? ""}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                            {line && line.amount > 0 ? money(line.amount) : ""}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                            {line && line.amount < 0 ? `+${money(-line.amount)}` : ""}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap text-muted-foreground">
                            {p?.balance != null ? money(p.balance) : ""}
                          </td>
                          <td className="px-2 py-1.5 text-muted-foreground">{messages.join(". ")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setStep("map")} disabled={busy}>
                  Back
                </Button>
                <Button onClick={handleConfirm} disabled={busy || preview.rows.every((p) => !p.line)}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Continue to review
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
