"use client";

import { useMemo, useState } from "react";
import { UploadReceipt } from "@/components/dashboard/upload-receipt";
import { ReceiptsSummary } from "@/components/dashboard/receipts-summary";
import { ReceiptsList } from "@/components/dashboard/receipts-list";
import { DateRangeFilter } from "@/components/dashboard/date-range-filter";
import { ReceiptDetailDialog } from "@/components/dashboard/receipt-detail-dialog";
import { HstSummaryCard } from "@/components/dashboard/hst-summary-card";
import { JobFilter } from "@/components/dashboard/job-filter";
import {
  describeRange,
  filterByRange,
  getPresetRange,
  type DateRange,
  type RangePreset,
} from "@/lib/date-range";
import type { Receipt } from "@/lib/database.types";

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function DashboardBody({
  initialReceipts,
}: {
  initialReceipts: Receipt[];
}) {
  const [receipts, setReceipts] = useState(initialReceipts);
  const [preset, setPreset] = useState<RangePreset>("this-month");
  const [range, setRange] = useState<DateRange>(getPresetRange("this-month"));
  const [jobFilter, setJobFilter] = useState<string | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);

  const existingJobs = useMemo(() => {
    const jobs = new Set<string>();
    for (const r of receipts) if (r.job_name) jobs.add(r.job_name);
    return [...jobs].sort();
  }, [receipts]);

  const filteredReceipts = useMemo(() => {
    const byRange = filterByRange(receipts, range);
    return jobFilter ? byRange.filter((r) => r.job_name === jobFilter) : byRange;
  }, [receipts, range, jobFilter]);

  const rangeLabel = useMemo(() => describeRange(preset, range), [preset, range]);
  const scopeLabel = jobFilter ? `${jobFilter} — ${rangeLabel}` : rangeLabel;

  const exportFilename = `taxsnap-receipts-${slugify(scopeLabel)}.csv`;

  function handleRangeChange(nextPreset: RangePreset, nextRange: DateRange) {
    setPreset(nextPreset);
    setRange(nextRange);
  }

  function handleDeleted(id: string) {
    setReceipts((prev) => prev.filter((r) => r.id !== id));
  }

  function handleUpdated(updated: Receipt) {
    setReceipts((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    setSelectedReceipt(updated);
  }

  return (
    <div className="space-y-6">
      <UploadReceipt
        onSaved={(receipt) => setReceipts((prev) => [receipt, ...prev])}
        existingJobs={existingJobs}
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <DateRangeFilter preset={preset} range={range} onChange={handleRangeChange} />
        <JobFilter jobs={existingJobs} value={jobFilter} onChange={setJobFilter} />
      </div>

      <ReceiptsSummary receipts={filteredReceipts} rangeLabel={scopeLabel} />

      <HstSummaryCard receipts={receipts} />

      <ReceiptsList
        receipts={filteredReceipts}
        onDeleted={handleDeleted}
        onSelect={setSelectedReceipt}
        exportFilename={exportFilename}
      />

      <ReceiptDetailDialog
        receipt={selectedReceipt}
        existingJobs={existingJobs}
        onOpenChange={(open) => !open && setSelectedReceipt(null)}
        onDeleted={handleDeleted}
        onUpdated={handleUpdated}
      />
    </div>
  );
}
