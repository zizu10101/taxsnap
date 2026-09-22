"use client";

import { useState } from "react";
import {
  Briefcase,
  Download,
  FileArchive,
  Loader2,
  Receipt as ReceiptIcon,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { downloadCsv, receiptsToCsv } from "@/lib/csv";
import { downloadAccountantExport } from "@/lib/accountant-export";
import { createClient } from "@/lib/supabase/client";
import type { DateRange } from "@/lib/date-range";
import type { Receipt } from "@/lib/database.types";
import type { BusinessInfo } from "@/components/invoices/document-detail";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ReceiptsList({
  receipts,
  title = "Receipts",
  emptyLabel = "No receipts in this date range.",
  onDeleted,
  onSelect,
  exportFilenameBase,
  range,
  business,
  logoPath,
}: {
  receipts: Receipt[];
  // Lets a caller render more than one list on the same page (e.g. the
  // Expenses tab's Job/Overhead split) with its own heading instead of
  // always saying "Receipts".
  title?: string;
  emptyLabel?: string;
  onDeleted: (id: string) => void;
  onSelect: (receipt: Receipt) => void;
  // Extension-less - both the plain CSV export and the accountant bundle
  // derive their own filename from this one base, so the two downloads
  // for the same range are obviously a pair (e.g.
  // "taxsnap-receipts-august-2026.csv" / ".zip").
  exportFilenameBase: string;
  // Scopes the accountant bundle's own invoice fetch to the same period
  // as `receipts` (already range-filtered by the caller) - not used for
  // receipts themselves, only so the bundle's invoices.csv/PDFs describe
  // the same window.
  range: DateRange;
  business: BusinessInfo;
  logoPath: string | null;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [exportingBundle, setExportingBundle] = useState(false);

  const subtotal = receipts.reduce((sum, r) => sum + r.total_amount, 0);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/receipts/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete receipt");
      }
      onDeleted(id);
      toast.success("Receipt deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setDeletingId(null);
    }
  }

  function handleExport() {
    if (receipts.length === 0) {
      toast.info("No receipts in this range to export");
      return;
    }
    const csv = receiptsToCsv(receipts);
    downloadCsv(`${exportFilenameBase}.csv`, csv);
  }

  async function handleExportBundle() {
    setExportingBundle(true);
    try {
      await downloadAccountantExport(
        receipts,
        createClient(),
        exportFilenameBase,
        range,
        business,
        logoPath,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to build export");
    } finally {
      setExportingBundle(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <CardTitle>{title}</CardTitle>
          <span className="text-sm text-muted-foreground tabular-nums">
            {receipts.length} item{receipts.length === 1 ? "" : "s"} ·{" "}
            {formatCurrency(subtotal)}
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportBundle}
            disabled={exportingBundle}
          >
            {exportingBundle ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileArchive className="h-4 w-4" />
            )}
            For Accountant
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {receipts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <ReceiptIcon className="h-8 w-8" />
            <p className="text-sm">{emptyLabel}</p>
          </div>
        ) : (
          <>
            {/* Desktop: a real MERCHANT/CATEGORY/DATE/AMOUNT column table,
                matching the mockup - a plain header row, not part of the
                scrolling list. Hidden below sm; the mobile card-row list
                below (unchanged from before this redesign) takes over
                there instead of squeezing this grid into a narrow column. */}
            <div className="mb-1 hidden grid-cols-[minmax(0,2.1fr)_140px_120px_110px_36px] gap-3 border-b px-1 pb-2 font-mono text-[11px] font-semibold tracking-wider text-muted-foreground uppercase sm:grid">
              <span>Merchant</span>
              <span>Category</span>
              <span>Date</span>
              <span className="text-right">Amount</span>
              <span />
            </div>
            <ul className="divide-y">
              {receipts.map((r) => (
                <li
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(r)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(r);
                    }
                  }}
                  className="cursor-pointer rounded-md py-3 outline-none hover:bg-muted/50 focus-visible:bg-muted/50 sm:grid sm:grid-cols-[minmax(0,2.1fr)_140px_120px_110px_36px] sm:items-center sm:gap-3 sm:px-1"
                >
                  {/* Mobile row (below sm) - unchanged two-line card shape. */}
                  <div className="flex items-center justify-between gap-3 sm:hidden">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium">{r.merchant_name}</p>
                        <Badge variant="secondary" className="shrink-0 text-xs">
                          {r.tax_category}
                        </Badge>
                      </div>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        {formatDate(r.transaction_date)}
                        {r.job_name && (
                          <span className="flex items-center gap-0.5 truncate">
                            <span aria-hidden>·</span>
                            <Briefcase className="h-3 w-3 shrink-0" />
                            <span className="truncate">{r.job_name}</span>
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold tabular-nums">
                        {formatCurrency(r.total_amount)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(r.id);
                        }}
                        disabled={deletingId === r.id}
                      >
                        {deletingId === r.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Desktop row (sm+) - one grid cell per column, same data. */}
                  <div className="hidden min-w-0 sm:block">
                    <p className="truncate text-sm font-medium">{r.merchant_name}</p>
                    {r.job_name && (
                      <p className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                        <Briefcase className="h-3 w-3 shrink-0" />
                        <span className="truncate">{r.job_name}</span>
                      </p>
                    )}
                  </div>
                  <span className="hidden sm:block">
                    <Badge variant="secondary" className="text-xs">
                      {r.tax_category}
                    </Badge>
                  </span>
                  <span className="hidden font-mono text-xs text-muted-foreground sm:block">
                    {formatDate(r.transaction_date)}
                  </span>
                  <span className="hidden text-right text-sm font-semibold tabular-nums sm:block">
                    {formatCurrency(r.total_amount)}
                  </span>
                  <span className="hidden justify-self-end sm:block">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(r.id);
                      }}
                      disabled={deletingId === r.id}
                    >
                      {deletingId === r.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
