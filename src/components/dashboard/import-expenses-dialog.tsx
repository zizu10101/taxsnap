"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
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
import { useExpenseCategoryOptions } from "@/components/owner-lists-provider";
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, parseDelimited, rowsWithExtraValues, type ParsedTable } from "@/lib/client-import";
import {
  DATE_ORDER_LABELS,
  EXPENSE_TARGETS,
  EXPENSE_TARGET_LABELS,
  buildImportRows,
  dateFormatQuestion,
  guessExpenseMapping,
  headingsKey,
  importSummaryText,
  mappingProblems,
  parseSavedMapping,
  planTotals,
  type DateOrder,
  type ExpenseImportRow,
  type ExpenseImportTarget,
  type ImportProblem,
  type PlannedRow,
} from "@/lib/expense-import";

const money = (n: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(n);
const NO_DATE_ORDER = "__choose__";

type Step = "file" | "map" | "preview" | "done";

interface Result {
  imported: number;
  skipped: number;
  failed: { row: number; reason: string }[];
  created_ids: string[];
}

// Browser storage can be blocked or full (private mode, policies): remembering the mapping is a nicety,
// so every access is wrapped and a failure is silent.
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

const STATUS_BADGE: Record<PlannedRow["status"] | "error", { label: string; className: string }> = {
  ready: { label: "Ready", className: "bg-success text-success-foreground" },
  warning: { label: "Warning", className: "bg-warning/20 text-warning" },
  duplicate: { label: "Duplicate", className: "bg-warning/20 text-warning" },
  total: { label: "Looks like a total", className: "bg-warning/20 text-warning" },
  error: { label: "Error", className: "bg-destructive/10 text-destructive" },
};

// "Import CSV" on the Expenses page: a supplier's invoices, one row per invoice. The file is read here in
// the browser and only the mapped rows are POSTed to /api/receipts/import (preview, then apply after
// Confirm); the server re-checks every rule. Nothing is saved until Confirm, the file is never stored,
// and no AI is involved. Imported rows are ordinary expenses, like ones typed by hand.
export function ImportExpensesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const categoryOptions = useExpenseCategoryOptions();
  const [step, setStep] = useState<Step>("file");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileText, setFileText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [table, setTable] = useState<ParsedTable | null>(null);
  const [overflowRows, setOverflowRows] = useState<Set<number>>(new Set());
  const [mapping, setMapping] = useState<ExpenseImportTarget[]>([]);
  const [remembered, setRemembered] = useState(false);
  const [supplierName, setSupplierName] = useState("");
  const [defaultCategory, setDefaultCategory] = useState("Other");
  const [dateOrder, setDateOrder] = useState<DateOrder | "">("");
  // "Date for rows without a date": kept in this dialog's state only (cleared when it closes), never saved.
  const [fallbackDate, setFallbackDate] = useState("");
  const [busy, setBusy] = useState(false);

  const [inputs, setInputs] = useState<ExpenseImportRow[]>([]);
  const [problems, setProblems] = useState<ImportProblem[]>([]);
  const [planned, setPlanned] = useState<PlannedRow[]>([]);
  const [included, setIncluded] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<Result | null>(null);
  const [undone, setUndone] = useState<number | null>(null);

  function reset() {
    setStep("file");
    setFileName(null);
    setFileText(null);
    setError(null);
    setTable(null);
    setOverflowRows(new Set());
    setMapping([]);
    setRemembered(false);
    setSupplierName("");
    setDefaultCategory("Other");
    setDateOrder("");
    setFallbackDate("");
    setInputs([]);
    setProblems([]);
    setPlanned([]);
    setIncluded(new Set());
    setResult(null);
    setUndone(null);
  }

  function handleOpenChange(next: boolean) {
    if (busy) return;
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleFile(file: File | undefined) {
    setError(null);
    if (!file) {
      setFileName(null);
      setFileText(null);
      return;
    }
    if (file.size > IMPORT_MAX_BYTES) {
      setFileName(null);
      setFileText(null);
      setError("That file is over 1 MB. Split it into smaller files.");
      return;
    }
    setFileName(file.name);
    setFileText(await file.text());
  }

  function handleContinueFromFile() {
    if (!fileText?.trim()) {
      setError("Choose a .csv file first.");
      return;
    }
    const parsed = parseDelimited(fileText);
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      setError("Found no rows. The first row must be the column names, followed by one row per invoice.");
      return;
    }
    if (parsed.rows.length > IMPORT_MAX_ROWS) {
      setError(`Found ${parsed.rows.length} rows. An import can have at most ${IMPORT_MAX_ROWS}. Split it into smaller files.`);
      return;
    }
    setError(null);
    setTable(parsed);
    setOverflowRows(rowsWithExtraValues(fileText));
    // The mapping used for a file with these exact headings last time, if any; otherwise a guess.
    const saved = parseSavedMapping(readSaved(headingsKey(parsed.headers)), parsed.headers.length);
    setMapping(saved ?? guessExpenseMapping(parsed.headers));
    setRemembered(saved !== null);
    setStep("map");
  }

  // Each field comes from one column: choosing it again moves it and sets the old column to Ignore.
  function setColumn(index: number, target: ExpenseImportTarget) {
    setRemembered(false);
    setMapping((prev) => prev.map((t, i) => (i === index ? target : target !== "ignore" && t === target ? "ignore" : t)));
  }

  const hasSupplierColumn = mapping.includes("supplier");
  const hasDateColumn = mapping.includes("date");
  // Only dates that come from the FILE can be ambiguous: with no date column (every row dated by the
  // picker) there is nothing to read, so the question is never asked.
  const dateAnalysis = useMemo(() => (table ? dateFormatQuestion(table, mapping) : null), [table, mapping]);
  const localToday = new Date().toLocaleDateString("en-CA");
  const fallbackDateProblem = fallbackDate && fallbackDate > localToday ? "it can't be in the future." : null;
  const blockers = [
    ...(table ? mappingProblems(mapping, fallbackDate) : []),
    ...(fallbackDateProblem ? [`Date for rows without a date: ${fallbackDateProblem}`] : []),
    ...(table && !hasSupplierColumn && !supplierName.trim() ? ["Enter the supplier's name."] : []),
    ...(dateAnalysis?.needsChoice && dateOrder === "" ? ["Choose how the dates are written."] : []),
  ];

  async function post(path: string, payload: unknown) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong");
    return data as Record<string, unknown>;
  }

  async function handlePreview() {
    if (!table) return;
    const order = dateOrder === "" ? (dateAnalysis?.detected ?? null) : dateOrder;
    const built = buildImportRows(table, mapping, { supplierName, dateOrder: order, overflowRows, fallbackDate });
    setBusy(true);
    try {
      writeSaved(headingsKey(table.headers), JSON.stringify(mapping));
      let plan: PlannedRow[] = [];
      if (built.rows.length > 0) {
        const data = await post("/api/receipts/import", {
          mode: "preview",
          default_category: defaultCategory,
          ...(fallbackDate && { fallback_date: fallbackDate }),
          rows: built.rows,
        });
        plan = data.rows as PlannedRow[];
      }
      setInputs(built.rows);
      setProblems(built.problems);
      setPlanned(plan);
      // Ready and warning rows start ticked; duplicates start unticked ("Import anyway" = tick it).
      setIncluded(new Set(plan.filter((p) => p.status === "ready" || p.status === "warning").map((p) => p.row)));
      setStep("preview");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  // The rows as sent on Confirm: unticked = skip; a ticked duplicate = import anyway.
  const toSend = useMemo<ExpenseImportRow[]>(
    () =>
      inputs.map((r) => {
        const p = planned.find((x) => x.row === r.row);
        const on = included.has(r.row);
        return { ...r, skip: !on, import_anyway: on && (p?.status === "duplicate" || p?.status === "total") };
      }),
    [inputs, planned, included],
  );
  const totals = useMemo(
    () =>
      planTotals(
        toSend.flatMap((input) => {
          const p = planned.find((x) => x.row === input.row);
          return p ? [{ planned: p, input }] : [];
        }),
      ),
    [toSend, planned],
  );

  async function handleConfirm() {
    setBusy(true);
    try {
      const data = await post("/api/receipts/import", {
        mode: "apply",
        default_category: defaultCategory,
        ...(fallbackDate && { fallback_date: fallbackDate }),
        rows: toSend,
      });
      const r = data as unknown as Result;
      setResult(r);
      setStep("done");
      if (r.imported > 0) {
        router.refresh();
        toast.success(`${r.imported} expense${r.imported === 1 ? "" : "s"} imported`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function handleUndo() {
    if (!result || result.created_ids.length === 0) return;
    setBusy(true);
    try {
      const data = await post("/api/receipts/import/undo", { ids: result.created_ids });
      setUndone(typeof data.removed === "number" ? data.removed : 0);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  // One list for the preview: the server's plan plus the rows the browser could not read.
  const previewRows = useMemo(() => {
    const byRow = new Map(inputs.map((r) => [r.row, r]));
    const all: { row: number; planned: PlannedRow | null; problem: string | null }[] = [
      ...planned.map((p) => ({ row: p.row, planned: p, problem: null })),
      ...problems.map((p) => ({ row: p.row, planned: null, problem: p.reason })),
    ];
    return all.sort((a, b) => a.row - b.row).map((r) => ({ ...r, input: byRow.get(r.row) ?? null }));
  }, [planned, problems, inputs]);

  const counts = {
    ready: planned.filter((p) => p.status === "ready").length,
    warning: planned.filter((p) => p.status === "warning").length,
    duplicate: planned.filter((p) => p.status === "duplicate").length,
    total: planned.filter((p) => p.status === "total").length,
    error: planned.filter((p) => p.status === "error").length + problems.length,
  };

  const dateOrderItems: Record<string, string> = { [NO_DATE_ORDER]: "Choose...", ...DATE_ORDER_LABELS };
  const categoryItems = useMemo(() => Object.fromEntries(categoryOptions.map((c) => [c, c])), [categoryOptions]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={step === "preview" ? "sm:max-w-5xl" : "sm:max-w-lg"}>
        <DialogHeader>
          <DialogTitle>Import expenses from CSV</DialogTitle>
          {step === "file" && (
            <DialogDescription>
              One row per supplier invoice. Nothing is saved until you confirm.
            </DialogDescription>
          )}
        </DialogHeader>

        {step === "file" && (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              The first row must be the column names. Up to {IMPORT_MAX_ROWS} invoices and 1 MB per import. The file is
              read in your browser; only the rows are sent.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="import-expenses-file">Upload a .csv file</Label>
              <Input
                id="import-expenses-file"
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
              {fileName && <p className="text-xs text-muted-foreground">{fileName}</p>}
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
              {table.rows.length} row{table.rows.length === 1 ? "" : "s"} found. Check what each column is. A date is
              required, plus a total (or a subtotal and a tax column).
            </p>
            {remembered && (
              <p className="text-xs text-muted-foreground">Using the mapping you chose for a file with these headings last time.</p>
            )}
            <div className="grid gap-2">
              {table.headers.map((header, i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-medium">{header || `Column ${i + 1}`}</span>
                  <Select
                    items={EXPENSE_TARGET_LABELS}
                    value={mapping[i] ?? "ignore"}
                    onValueChange={(v) => v && setColumn(i, v as ExpenseImportTarget)}
                  >
                    <SelectTrigger className="w-40 shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPENSE_TARGETS.map((t) => (
                        <SelectItem key={t} value={t}>
                          {EXPENSE_TARGET_LABELS[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {!hasSupplierColumn && (
              <div className="space-y-1.5">
                <Label htmlFor="import-supplier">Supplier name (used for every row)</Label>
                <Input id="import-supplier" maxLength={200} value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Category when the file has none (or a row is blank)</Label>
              <Select items={categoryItems} value={defaultCategory} onValueChange={(v) => v && setDefaultCategory(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categoryOptions.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!mapping.includes("tax") && (
                <p className="text-xs text-muted-foreground">
                  There is no tax column, so HST is estimated from the category (13/113 of the total) and the rows are marked
                  estimated. Categories with no tax credit (insurance, wages, bank charges) get none.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="import-fallback-date">
                Date for rows without a date{hasDateColumn ? " (optional)" : ""}
              </Label>
              <Input
                id="import-fallback-date"
                type="date"
                max={localToday}
                value={fallbackDate}
                onChange={(e) => setFallbackDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {hasDateColumn
                  ? "Used only for rows whose date cell is blank. A date in the file always wins."
                  : "No column is the date, so every row gets this date. It is required."}{" "}
                Rows dated this way are marked in the preview and noted on the expense.
              </p>
            </div>

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
                <p className="text-xs text-muted-foreground">
                  The dates in this file could be read either way, so you choose. Rows that don&apos;t fit your choice are
                  reported as errors.
                </p>
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

        {step === "preview" && (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              {counts.ready} ready, {counts.warning} with warnings, {counts.duplicate} duplicates and {counts.total} that look
              like totals (both skipped unless you tick them), {counts.error} errors. Untick a row to skip it. Nothing is
              saved until you confirm.
            </p>
            <div className="max-h-[50vh] overflow-auto rounded-lg border">
              <table className="w-full min-w-[56rem] text-left text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Import</th>
                    <th className="px-2 py-1.5 font-medium">Row</th>
                    <th className="px-2 py-1.5 font-medium">Status</th>
                    <th className="px-2 py-1.5 font-medium">Date</th>
                    <th className="px-2 py-1.5 font-medium">Supplier</th>
                    <th className="px-2 py-1.5 font-medium">Invoice no.</th>
                    <th className="px-2 py-1.5 font-medium">Category</th>
                    <th className="px-2 py-1.5 text-right font-medium">Tax</th>
                    <th className="px-2 py-1.5 text-right font-medium">Total</th>
                    <th className="px-2 py-1.5 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map(({ row, planned: p, problem }) => {
                    const e = p?.expense ?? null;
                    const status = p ? p.status : "error";
                    const badge = STATUS_BADGE[status];
                    const messages = p ? p.messages : problem ? [problem] : [];
                    return (
                      <tr key={row} className="border-t align-top">
                        <td className="px-2 py-1.5">
                          <Checkbox
                            aria-label={status === "duplicate" || status === "total" ? `Import row ${row} anyway` : `Import row ${row}`}
                            disabled={status === "error" || (p !== null && p.expense === null)}
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
                          {(status === "duplicate" || status === "total") && p?.expense && (
                            <span className="block text-[10px] text-muted-foreground">Import anyway</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 tabular-nums">{row}</td>
                        <td className="px-2 py-1.5">
                          <Badge variant="secondary" className={badge.className}>
                            {badge.label}
                          </Badge>
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          {e?.transaction_date ?? ""}
                          {e?.date_set_at_import && (
                            <span className="block text-[10px] text-muted-foreground">date set at import</span>
                          )}
                        </td>
                        <td className="max-w-40 truncate px-2 py-1.5">{e?.merchant_name ?? ""}</td>
                        <td className="px-2 py-1.5 font-mono">{e?.invoice_number ?? ""}</td>
                        <td className="max-w-36 truncate px-2 py-1.5">{e?.tax_category ?? ""}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                          {e ? money(e.tax_amount) : ""}
                          {e?.tax_estimated && <span className="ml-1 text-[10px] text-muted-foreground">est.</span>}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                          {e ? money(e.total_amount) : ""}
                          {e?.credit && <span className="ml-1 text-[10px] text-muted-foreground">credit</span>}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">{messages.join(". ")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-sm font-medium">
              {totals.rows} row{totals.rows === 1 ? "" : "s"} will be imported: {money(totals.total)} in total, {money(totals.tax)} tax.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("map")} disabled={busy}>
                Back
              </Button>
              <Button onClick={handleConfirm} disabled={busy || totals.rows === 0}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Confirm import
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-3 text-sm">
            <p className="font-medium">
              {undone !== null
                ? `Import undone: ${undone} expense${undone === 1 ? "" : "s"} removed.`
                : importSummaryText({ imported: result.imported, skipped: result.skipped, failed: result.failed.length })}
            </p>
            {result.failed.length > 0 && (
              <div className="space-y-1">
                <p className="text-muted-foreground">Rows that were not saved:</p>
                <ul className="list-disc pl-5">
                  {result.failed.slice(0, 20).map((f) => (
                    <li key={f.row}>
                      Row {f.row}: {f.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <DialogFooter>
              {undone === null && result.imported > 0 && (
                <Button variant="outline" onClick={handleUndo} disabled={busy}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Undo import
                </Button>
              )}
              <Button onClick={() => handleOpenChange(false)} disabled={busy}>
                Done
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
