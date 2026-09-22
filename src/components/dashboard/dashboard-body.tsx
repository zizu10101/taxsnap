"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ClipboardList, FileText, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import { UploadReceipt } from "@/components/dashboard/upload-receipt";
import { ReceiptsSummary } from "@/components/dashboard/receipts-summary";
import { ReceiptsList } from "@/components/dashboard/receipts-list";
import { DateRangeFilter } from "@/components/dashboard/date-range-filter";
import { ReceiptDetailDialog } from "@/components/dashboard/receipt-detail-dialog";
import { HstSummaryCard } from "@/components/dashboard/hst-summary-card";
import { JobFilter } from "@/components/dashboard/job-filter";
import { NewClientDialog } from "@/components/clients/new-client-dialog";
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
  // nav-config.ts for the matching nav-item hide). Also threaded into
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
  const [newClientOpen, setNewClientOpen] = useState(false);

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

  const monthEyebrow = useMemo(
    () =>
      new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" }).toUpperCase(),
    [],
  );

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
      {/* The eyebrow/title/actions pattern comes from the Claude Design
          dashboard mockup; the subtitle uses real data (this period's
          receipt count) rather than the mockup's fabricated "last sync"
          line, since there's no sync-timestamp concept in this app's data
          model. PageHeader itself is shared with the rest of /dashboard/**
          - see page-header.tsx. */}
      <PageHeader
        eyebrow={monthEyebrow}
        title="Dashboard"
        subtitle={
          <>
            {filteredReceipts.length} receipt{filteredReceipts.length === 1 ? "" : "s"} captured ·{" "}
            {rangeLabel}
          </>
        }
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link href="/dashboard/invoices/new" />}>
              New Invoice
            </Button>
            <UploadReceipt
              variant="hero"
              onSaved={(receipt) => setReceipts((prev) => [receipt, ...prev])}
              existingJobs={existingJobs}
            />
          </>
        }
      />

      {/* Quick actions - 4 equal tiles for a general account (Scan/
          Estimate/Invoice/Client), 2x2 on phone widths, 4-across from sm
          up. A salon account has one fewer tile (no Estimate) and stays a
          fixed single row of 3 at every width - that 3-tile row was
          already verified to fit a ~390px phone viewport (see
          CommissionNav's own tab row), unlike a bare 4-across row, which is
          why general only goes 4-across from sm up rather than always. */}
      <div
        className={
          businessType === "salon"
            ? "grid grid-cols-3 gap-2"
            : "grid grid-cols-2 gap-2 sm:grid-cols-4"
        }
      >
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
            render={<Link href="/dashboard/estimates/new" />}
          >
            <ClipboardList className="h-5 w-5" />
            New Estimate
          </Button>
        )}
        <Button
          variant="outline"
          className="h-20 w-full flex-col gap-1.5 text-xs font-semibold"
          nativeButton={false}
          render={<Link href="/dashboard/invoices/new" />}
        >
          <FileText className="h-5 w-5" />
          New Invoice
        </Button>
        {/* Opens the same client-creation form as the invoice/estimate
            builder's "+ Add new client" fields, but standalone - doesn't
            require starting an invoice/estimate first. Not hidden for
            salon: New Invoice above already isn't either, even though
            Invoices has no nav tab for that business type - this follows
            the same precedent instead of introducing a new inconsistency. */}
        <Button
          variant="outline"
          className="h-20 w-full flex-col gap-1.5 text-xs font-semibold"
          onClick={() => setNewClientOpen(true)}
        >
          <UserPlus className="h-5 w-5" />
          New Client
        </Button>
      </div>

      {/* No client list lives on this page to update - onCreated only
          matters to a caller (like DocumentList) that renders one; here
          the dialog's own success toast is the entire confirmation. */}
      <NewClientDialog
        open={newClientOpen}
        onOpenChange={setNewClientOpen}
        onCreated={() => {}}
      />

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
