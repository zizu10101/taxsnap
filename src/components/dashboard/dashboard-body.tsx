"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ClipboardList, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import type { BusinessType, Receipt, SubscriptionStatus } from "@/lib/database.types";
import type { BusinessInfo } from "@/components/invoices/document-detail";

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function DashboardBody({
  initialReceipts,
  initialJobNames,
  businessType,
  subscriptionStatus,
  business,
  logoPath,
}: {
  initialReceipts: Receipt[];
  initialJobNames: string[];
  // Hides the "New Estimate" quick-action tile below for salon accounts -
  // Estimates doesn't apply to that business type (see
  // dashboard/estimates/layout.tsx for the matching route-level block and
  // dashboard-header.tsx for the matching nav-tab hide). Also threaded into
  // HstSummaryCard below to gate manual sales entry.
  businessType: BusinessType;
  // Threaded into HstSummaryCard to gate manual sales entry (Basic-or-
  // higher for general-business accounts; unrestricted for salon).
  subscriptionStatus: SubscriptionStatus;
  // Passed straight through to ReceiptsList's accountant export bundle,
  // which needs it to render invoice PDFs the same way the invoice detail
  // page/PDF download already do - nothing on this page itself displays
  // it.
  business: BusinessInfo;
  logoPath: string | null;
}) {
  const [receipts, setReceipts] = useState(initialReceipts);
  const [preset, setPreset] = useState<RangePreset>("this-month");
  const [range, setRange] = useState<DateRange>(getPresetRange("this-month"));
  const [jobFilter, setJobFilter] = useState<string | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);

  // Union of the jobs table (includes jobs created from the Jobs/Hours
  // pages that have no receipt yet) and any job_name already on a receipt
  // in this session (covers a job typed here moments ago, before a fresh
  // server fetch would pick it up).
  const existingJobs = useMemo(() => {
    const jobs = new Set<string>(initialJobNames);
    for (const r of receipts) if (r.job_name) jobs.add(r.job_name);
    return [...jobs].sort();
  }, [receipts, initialJobNames]);

  const filteredReceipts = useMemo(() => {
    const byRange = filterByRange(receipts, range);
    return jobFilter ? byRange.filter((r) => r.job_name === jobFilter) : byRange;
  }, [receipts, range, jobFilter]);

  const rangeLabel = useMemo(() => describeRange(preset, range), [preset, range]);
  const scopeLabel = jobFilter ? `${jobFilter} — ${rangeLabel}` : rangeLabel;

  const exportFilenameBase = `taxsnap-receipts-${slugify(scopeLabel)}`;

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
      <div className={businessType === "salon" ? "grid grid-cols-2 gap-2" : "grid grid-cols-3 gap-2"}>
        <UploadReceipt
          variant="tile"
          onSaved={(receipt) => setReceipts((prev) => [receipt, ...prev])}
          existingJobs={existingJobs}
        />
        {businessType !== "salon" && (
          <Button
            variant="outline"
            className="h-20 w-full flex-col gap-1.5 text-xs font-semibold"
            nativeButton={false}
            render={<Link href="/dashboard/estimates?new=1" />}
          >
            <ClipboardList className="h-5 w-5" />
            New Estimate
          </Button>
        )}
        <Button
          variant="outline"
          className="h-20 w-full flex-col gap-1.5 text-xs font-semibold"
          nativeButton={false}
          render={<Link href="/dashboard/invoices?new=1" />}
        >
          <FileText className="h-5 w-5" />
          New Invoice
        </Button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <DateRangeFilter preset={preset} range={range} onChange={handleRangeChange} />
        <JobFilter jobs={existingJobs} value={jobFilter} onChange={setJobFilter} />
      </div>

      <ReceiptsSummary receipts={filteredReceipts} rangeLabel={scopeLabel} />

      <HstSummaryCard
        receipts={receipts}
        businessType={businessType}
        subscriptionStatus={subscriptionStatus}
      />

      <ReceiptsList
        receipts={filteredReceipts}
        onDeleted={handleDeleted}
        onSelect={setSelectedReceipt}
        exportFilenameBase={exportFilenameBase}
        range={range}
        business={business}
        logoPath={logoPath}
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
