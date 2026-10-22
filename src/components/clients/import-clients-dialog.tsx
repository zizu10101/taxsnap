"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
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
import type { Client } from "@/lib/database.types";
import { showUpgradePrompt } from "@/lib/upgrade-prompt";
import {
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  IMPORT_TARGET_LABELS,
  applyMapping,
  guessMapping,
  parseDelimited,
  summaryText,
  unstoredColumnLabel,
  type ImportProblem,
  type ImportSummary,
  type ImportTarget,
  type ParsedTable,
} from "@/lib/client-import";

const TARGETS: ImportTarget[] = ["name", "email", "phone", "address", "ignore"];
const PREVIEW_ROWS = 5;

type Result = ImportSummary & { problems: ImportProblem[] };

// "Import clients": a .csv file or cells pasted from Excel / Google Sheets, both through the same parser
// (lib/client-import.ts). Parsing and column mapping happen here in the browser; the mapped rows are POSTed to
// /api/clients/import, which re-checks every rule (size, row cap, emails, duplicates, plan cap). Nothing is
// stored: the file and the pasted text live in this component's state until it closes.
export function ImportClientsDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (clients: Client[]) => void;
}) {
  const router = useRouter();
  const [pasted, setPasted] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileText, setFileText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [table, setTable] = useState<ParsedTable | null>(null);
  const [mapping, setMapping] = useState<ImportTarget[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  function reset() {
    setPasted("");
    setFileName(null);
    setFileText(null);
    setError(null);
    setTable(null);
    setMapping([]);
    setResult(null);
  }

  function handleOpenChange(next: boolean) {
    if (importing) return;
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

  function handleContinue() {
    const text = fileText ?? pasted;
    if (!text.trim()) {
      setError("Choose a .csv file or paste your cells first.");
      return;
    }
    if (new Blob([text]).size > IMPORT_MAX_BYTES) {
      setError("That is over 1 MB. Split it into smaller imports.");
      return;
    }
    const parsed = parseDelimited(text);
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      setError("Found no rows. The first row must be the column names, followed by your clients.");
      return;
    }
    if (parsed.rows.length > IMPORT_MAX_ROWS) {
      setError(`Found ${parsed.rows.length} rows. An import can have at most ${IMPORT_MAX_ROWS}. Split it into smaller imports.`);
      return;
    }
    setError(null);
    setTable(parsed);
    setMapping(guessMapping(parsed.headers));
  }

  // Each field can come from one column: choosing it again moves it and sets the old column to Ignore.
  function setColumn(index: number, target: ImportTarget) {
    setMapping((prev) => prev.map((t, i) => (i === index ? target : target !== "ignore" && t === target ? "ignore" : t)));
  }

  async function handleImport() {
    if (!table) return;
    setImporting(true);
    try {
      const res = await fetch("/api/clients/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: applyMapping(table, mapping) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not import clients.");

      setResult(data as Result);
      if (data.imported > 0) {
        onImported(data.clients as Client[]);
        router.refresh();
        toast.success(`${data.imported} client${data.imported === 1 ? "" : "s"} imported`);
      }
      if (data.limitMessage) showUpgradePrompt(data.limitMessage, router);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setImporting(false);
    }
  }

  const nameMapped = mapping.includes("name");
  const previewCols = table ? mapping.map((t, i) => ({ t, i })).filter((c) => c.t !== "ignore") : [];
  const unstored = table
    ? Array.from(new Set(table.headers.map(unstoredColumnLabel).filter((l): l is string => l !== null)))
    : [];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import clients</DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="space-y-3 text-sm">
            <p className="font-medium">{summaryText(result)}</p>
            {result.problems.length > 0 && (
              <div className="space-y-1">
                <p className="text-muted-foreground">
                  {result.skippedProblems > result.problems.length
                    ? `First ${result.problems.length} of ${result.skippedProblems} problem rows:`
                    : "Problem rows:"}
                </p>
                <ul className="list-disc pl-5">
                  {result.problems.map((p) => (
                    <li key={p.row}>
                      Row {p.row}: {p.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : !table ? (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              The first row must be the column names. Up to {IMPORT_MAX_ROWS} clients and 1 MB per import.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="import-clients-file">Upload a .csv file</Label>
              <Input
                id="import-clients-file"
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
              {fileName && <p className="text-xs text-muted-foreground">{fileName}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="import-clients-paste">Or paste cells from Excel or Google Sheets</Label>
              <textarea
                id="import-clients-paste"
                rows={6}
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm"
                placeholder={"Name\tEmail\tAddress\nJordan Reyes\tjordan@example.com\t12 Main St"}
                value={pasted}
                disabled={fileText !== null}
                onChange={(e) => setPasted(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleContinue}>Continue</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              {table.rows.length} row{table.rows.length === 1 ? "" : "s"} found. Check what each column is. Name is required.
            </p>
            <div className="grid gap-2">
              {table.headers.map((header, i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-medium">{header || `Column ${i + 1}`}</span>
                  <Select
                    items={IMPORT_TARGET_LABELS}
                    value={mapping[i] ?? "ignore"}
                    onValueChange={(v) => v && setColumn(i, v as ImportTarget)}
                  >
                    <SelectTrigger className="w-36 shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TARGETS.map((t) => (
                        <SelectItem key={t} value={t}>
                          {IMPORT_TARGET_LABELS[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            {unstored.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {unstored.join(", ")} can&apos;t be saved on a client yet, so {unstored.length === 1 ? "that column is" : "those columns are"} ignored.
              </p>
            )}
            {!nameMapped && <p className="text-sm text-destructive">Choose which column is the client&apos;s name.</p>}

            {previewCols.length > 0 && (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      {previewCols.map((c) => (
                        <th key={c.i} className="px-2 py-1.5 font-medium">
                          {IMPORT_TARGET_LABELS[c.t]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.slice(0, PREVIEW_ROWS).map((r) => (
                      <tr key={r.row} className="border-t">
                        {previewCols.map((c) => (
                          <td key={c.i} className="max-w-40 truncate px-2 py-1.5">
                            {r.cells[c.i]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setTable(null)} disabled={importing}>
                Back
              </Button>
              <Button onClick={handleImport} disabled={importing || !nameMapped}>
                {importing && <Loader2 className="h-4 w-4 animate-spin" />}
                Import {table.rows.length} row{table.rows.length === 1 ? "" : "s"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
