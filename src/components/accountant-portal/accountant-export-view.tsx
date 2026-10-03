"use client";

import { useState } from "react";
import { FileArchive, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DateRangeFilter } from "@/components/dashboard/date-range-filter";
import { buildAndDownloadAccountantExport } from "@/lib/accountant-export";
import { getPresetRange, type DateRange, type RangePreset } from "@/lib/date-range";
import { RANGE_PRESET_LABELS } from "@/lib/date-range";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Generates the same accountant bundle the owner can export (transactions,
// summary, QuickBooks import, payments, invoices CSV + PDFs, receipt photos) on
// demand, for any date range. The data comes from the read-only accountant API
// and the zip is assembled in the browser by the owner's own export code.
export function AccountantExportView({ businessName }: { businessName: string | null }) {
  const [preset, setPreset] = useState<RangePreset>("this-year");
  const [range, setRange] = useState<DateRange>(() => getPresetRange("this-year"));
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (range.start) params.set("from", range.start);
      if (range.end) params.set("to", range.end);
      const res = await fetch(`/api/accountant-portal/export-data?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't load the records for this export.");

      if (data.receipts.length === 0 && data.invoices.length === 0 && data.invoicePayments.length === 0) {
        toast.info("Nothing to export in this date range.");
        return;
      }

      const label =
        preset === "all-time" ? "all-time" : `${range.start ?? "start"}-to-${range.end ?? "now"}`;
      await buildAndDownloadAccountantExport(
        {
          receipts: data.receipts,
          bankAccounts: data.bankAccounts,
          invoices: data.invoices,
          paymentDocs: data.paymentDocs,
          invoicePayments: data.invoicePayments,
          range,
          business: data.business,
          getLogoUrl: async () => {
            if (!data.hasLogo) return null;
            const r = await fetch("/api/accountant-portal/export-data/signed-urls", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ logo: true }),
            });
            const json = await r.json().catch(() => ({}));
            return r.ok ? (json.logoUrl ?? null) : null;
          },
          getImageUrls: async (paths) => {
            const r = await fetch("/api/accountant-portal/export-data/signed-urls", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ paths }),
            });
            const json = await r.json().catch(() => ({}));
            return new Map(Object.entries((r.ok ? json.urls : {}) as Record<string, string>));
          },
        },
        `taxsnap-accountant-export-${slugify(businessName ?? "business")}-${slugify(label)}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to build the export.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="max-w-prose text-sm text-muted-foreground">
        Builds a zip for the selected dates: transactions, a period summary, a QuickBooks import
        file, payments received, invoices as CSV and individual PDFs, and the original receipt
        photos.
      </p>

      <DateRangeFilter
        preset={preset}
        range={range}
        onChange={(nextPreset, nextRange) => {
          setPreset(nextPreset);
          setRange(nextRange);
        }}
      />

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="min-w-0">
            <p className="font-medium">Accountant export bundle</p>
            <p className="text-sm text-muted-foreground">{RANGE_PRESET_LABELS[preset]}</p>
          </div>
          <Button onClick={handleExport} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileArchive className="h-4 w-4" />}
            {busy ? "Building…" : "Generate and download"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
