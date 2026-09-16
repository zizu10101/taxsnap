"use client";

import { useMemo, useState } from "react";
import { Plus, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReceiptsSummary } from "@/components/dashboard/receipts-summary";
import { ReceiptsList } from "@/components/dashboard/receipts-list";
import { DateRangeFilter } from "@/components/dashboard/date-range-filter";
import { ReceiptDetailDialog } from "@/components/dashboard/receipt-detail-dialog";
import { ManualExpenseDialog } from "@/components/dashboard/manual-expense-dialog";
import { ExpenseTemplatesDialog } from "@/components/dashboard/expense-templates-dialog";
import { JobFilter } from "@/components/dashboard/job-filter";
import {
  describeRange,
  filterByRange,
  getPresetRange,
  type DateRange,
  type RangePreset,
} from "@/lib/date-range";
import type { ExpenseTemplateWithJob, Receipt } from "@/lib/database.types";
import type { BusinessInfo } from "@/components/invoices/document-detail";

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Same date-range/job filtering pattern as DashboardBody, but scoped to
// just the expense/receipt list - no quick-action tiles, no HstSummaryCard
// (which pulls in invoice payment data), no client creation. Those all
// still live on the main dashboard; this page is a focused expenses-only
// view, mirroring how Invoices/Estimates/Jobs each get their own page
// instead of being mixed into one screen.
export function ExpensesBody({
  initialReceipts,
  initialJobNames,
  initialTemplates,
  business,
  logoPath,
}: {
  initialReceipts: Receipt[];
  initialJobNames: string[];
  initialTemplates: ExpenseTemplateWithJob[];
  business: BusinessInfo;
  logoPath: string | null;
}) {
  const [receipts, setReceipts] = useState(initialReceipts);
  const [templates, setTemplates] = useState(initialTemplates);
  const [preset, setPreset] = useState<RangePreset>("this-month");
  const [range, setRange] = useState<DateRange>(getPresetRange("this-month"));
  const [jobFilter, setJobFilter] = useState<string | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [templatesDialogOpen, setTemplatesDialogOpen] = useState(false);
  const [expenseTemplate, setExpenseTemplate] = useState<ExpenseTemplateWithJob | null>(null);

  const existingJobs = useMemo(() => {
    const jobs = new Set<string>(initialJobNames);
    for (const r of receipts) if (r.job_name) jobs.add(r.job_name);
    return [...jobs].sort();
  }, [receipts, initialJobNames]);

  const filteredReceipts = useMemo(() => {
    const byRange = filterByRange(receipts, range);
    return jobFilter ? byRange.filter((r) => r.job_name === jobFilter) : byRange;
  }, [receipts, range, jobFilter]);

  // job_id set = tied to a specific job, null = general overhead - the
  // same nullable column job costing already reads, just grouped here
  // instead of joined against a job's cost rollup.
  const jobExpenses = useMemo(
    () => filteredReceipts.filter((r) => r.job_id),
    [filteredReceipts],
  );
  const overheadExpenses = useMemo(
    () => filteredReceipts.filter((r) => !r.job_id),
    [filteredReceipts],
  );

  const rangeLabel = useMemo(() => describeRange(preset, range), [preset, range]);
  const scopeLabel = jobFilter ? `${jobFilter} — ${rangeLabel}` : rangeLabel;

  const exportFilenameBase = `taxsnap-expenses-${slugify(scopeLabel)}`;

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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <DateRangeFilter preset={preset} range={range} onChange={handleRangeChange} />
          <JobFilter jobs={existingJobs} value={jobFilter} onChange={setJobFilter} />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setTemplatesDialogOpen(true)}>
            <Repeat className="h-4 w-4" />
            From Template
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setExpenseTemplate(null);
              setAddExpenseOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Add Expense
          </Button>
        </div>
      </div>

      <ReceiptsSummary receipts={filteredReceipts} rangeLabel={scopeLabel} />

      <ReceiptsList
        receipts={jobExpenses}
        title="Job Expenses"
        emptyLabel="No job expenses in this date range."
        onDeleted={handleDeleted}
        onSelect={setSelectedReceipt}
        exportFilenameBase={`${exportFilenameBase}-job`}
        range={range}
        business={business}
        logoPath={logoPath}
      />

      <ReceiptsList
        receipts={overheadExpenses}
        title="Overhead Expenses"
        emptyLabel="No overhead expenses in this date range."
        onDeleted={handleDeleted}
        onSelect={setSelectedReceipt}
        exportFilenameBase={`${exportFilenameBase}-overhead`}
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

      <ManualExpenseDialog
        key={expenseTemplate?.id ?? "new"}
        open={addExpenseOpen}
        onOpenChange={(open) => {
          setAddExpenseOpen(open);
          if (!open) setExpenseTemplate(null);
        }}
        existingJobs={existingJobs}
        template={expenseTemplate}
        onSaved={(receipt) => setReceipts((prev) => [receipt, ...prev])}
        onTemplateSaved={(template) => setTemplates((prev) => [...prev, template])}
      />

      <ExpenseTemplatesDialog
        open={templatesDialogOpen}
        onOpenChange={setTemplatesDialogOpen}
        templates={templates}
        existingJobs={existingJobs}
        onUse={(template) => {
          setTemplatesDialogOpen(false);
          setExpenseTemplate(template);
          setAddExpenseOpen(true);
        }}
        onUpdated={(updated) =>
          setTemplates((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
        }
        onDeleted={(id) => setTemplates((prev) => prev.filter((t) => t.id !== id))}
      />
    </div>
  );
}
