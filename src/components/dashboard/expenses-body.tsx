"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FileText, Plus, Repeat } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ReceiptsSummary } from "@/components/dashboard/receipts-summary";
import { ReceiptsList } from "@/components/dashboard/receipts-list";
import { DateRangeFilter } from "@/components/dashboard/date-range-filter";
import { ReceiptDetailDialog } from "@/components/dashboard/receipt-detail-dialog";
import { ManualExpenseDialog } from "@/components/dashboard/manual-expense-dialog";
import { UploadReceipt } from "@/components/dashboard/upload-receipt";
import { StatementImportButton } from "@/components/dashboard/statement-import-button";
import { RecentlyAddedReceipts } from "@/components/dashboard/recently-added-receipts";
import { ExpenseTemplatesDialog } from "@/components/dashboard/expense-templates-dialog";
import { JobFilter } from "@/components/dashboard/job-filter";
import { CategoryFilter } from "@/components/dashboard/category-filter";
import { BulkCategoryControls } from "@/components/dashboard/bulk-category-controls";
import { useExpenseCategoryOptions } from "@/components/owner-lists-provider";
import { BULK_CATEGORY_MAX } from "@/lib/bulk-category";
import {
  describeRange,
  filterByRange,
  getPresetRange,
  type DateRange,
  type RangePreset,
} from "@/lib/date-range";
import { pickRecentlyAdded } from "@/lib/recent-receipts";
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
  lastSignInAt,
  statementImportEnabled = false,
  openStatementDrafts = [],
  initialOpenReceiptId = null,
}: {
  initialReceipts: Receipt[];
  initialJobNames: string[];
  initialTemplates: ExpenseTemplateWithJob[];
  business: BusinessInfo;
  logoPath: string | null;
  // When the owner last signed in; receipts added since then that the current
  // filters hide are pinned in "Recently added".
  lastSignInAt: string | null;
  // Card-statement import (allowlist-only): shows the Import button, the
  // "resume" banner for a draft in progress, and the scan-to-attach check.
  statementImportEnabled?: boolean;
  openStatementDrafts?: { id: string; issuer: string | null; created_at: string }[];
  // A receipt to open in the detail drawer on first render (from ?receipt=<id>). Looked up among
  // the loaded receipts regardless of the date and job filters; an id that isn't there (deleted,
  // or not theirs) simply opens nothing.
  initialOpenReceiptId?: string | null;
}) {
  const [receipts, setReceipts] = useState(initialReceipts);
  const [templates, setTemplates] = useState(initialTemplates);
  const [preset, setPreset] = useState<RangePreset>("this-month");
  const [range, setRange] = useState<DateRange>(getPresetRange("this-month"));
  const [jobFilter, setJobFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  // Rows ticked for a bulk action. Cleared whenever a filter changes, so what is selected is always
  // what is on screen; the ids are frozen again when the change dialog opens.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(() =>
    initialOpenReceiptId ? (initialReceipts.find((r) => r.id === initialOpenReceiptId) ?? null) : null,
  );
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [templatesDialogOpen, setTemplatesDialogOpen] = useState(false);
  const [expenseTemplate, setExpenseTemplate] = useState<ExpenseTemplateWithJob | null>(null);

  const existingJobs = useMemo(() => {
    const jobs = new Set<string>(initialJobNames);
    for (const r of receipts) if (r.job_name) jobs.add(r.job_name);
    return [...jobs].sort();
  }, [receipts, initialJobNames]);

  // The built-in and active custom categories, plus any category an expense still carries that is
  // no longer offered (a deactivated custom one), so it can still be filtered on.
  const knownCategories = useExpenseCategoryOptions();
  const categoryOptions = useMemo(() => {
    const seen = new Set(knownCategories.map((c) => c.toLowerCase()));
    const extra = [...new Set(receipts.map((r) => r.tax_category))].filter(
      (c) => !seen.has(c.toLowerCase()),
    );
    return [...knownCategories, ...extra.sort()];
  }, [knownCategories, receipts]);

  const filteredReceipts = useMemo(() => {
    const byRange = filterByRange(receipts, range);
    const byJob = jobFilter ? byRange.filter((r) => r.job_name === jobFilter) : byRange;
    return categoryFilter
      ? byJob.filter((r) => r.tax_category.toLowerCase() === categoryFilter.toLowerCase())
      : byJob;
  }, [receipts, range, jobFilter, categoryFilter]);

  // Only rows that are still on screen count (a deleted row drops out by itself).
  const selectedIds = useMemo(
    () => filteredReceipts.filter((r) => selected.has(r.id)).map((r) => r.id),
    [filteredReceipts, selected],
  );

  const recentlyAdded = useMemo(
    () =>
      pickRecentlyAdded(receipts, new Set(filteredReceipts.map((r) => r.id)), lastSignInAt),
    [receipts, filteredReceipts, lastSignInAt],
  );

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
  const scopeLabel = [jobFilter, categoryFilter].filter(Boolean).concat(rangeLabel).join(" — ");

  const exportFilenameBase = `taxsnap-expenses-${slugify(scopeLabel)}`;

  function handleRangeChange(nextPreset: RangePreset, nextRange: DateRange) {
    setPreset(nextPreset);
    setRange(nextRange);
    setSelected(new Set());
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function toggleMany(ids: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  const selection = { selected, onToggle: toggleOne, onToggleMany: toggleMany };

  function handleDeleted(id: string) {
    setReceipts((prev) => prev.filter((r) => r.id !== id));
  }

  function handleUpdated(updated: Receipt) {
    setReceipts((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    setSelectedReceipt(updated);
  }

  // A scan was attached to an expense a statement import created: that row is
  // updated in place - it is not a new receipt, so it must not be prepended.
  function handleAttached(updated: Receipt) {
    setReceipts((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <DateRangeFilter preset={preset} range={range} onChange={handleRangeChange} />
          <JobFilter
            jobs={existingJobs}
            value={jobFilter}
            onChange={(job) => {
              setJobFilter(job);
              setSelected(new Set());
            }}
          />
          <CategoryFilter
            categories={categoryOptions}
            value={categoryFilter}
            onChange={(category) => {
              setCategoryFilter(category);
              setSelected(new Set());
            }}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setTemplatesDialogOpen(true)}>
            <Repeat className="h-4 w-4" />
            From Template
          </Button>
          {statementImportEnabled && <StatementImportButton />}
          <UploadReceipt
            variant="compact"
            onSaved={(receipt) => setReceipts((prev) => [receipt, ...prev])}
            onAttached={handleAttached}
            statementImportEnabled={statementImportEnabled}
            existingJobs={existingJobs}
          />
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

      {openStatementDrafts.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          <span className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            {openStatementDrafts.length === 1
              ? "You have a card statement import waiting for review."
              : `You have ${openStatementDrafts.length} card statement imports waiting for review.`}
          </span>
          <span className="flex gap-2">
            {openStatementDrafts.map((d, i) => (
              <Button
                key={d.id}
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link href={`/dashboard/expenses/statements/${d.id}`} />}
              >
                {openStatementDrafts.length === 1 ? "Continue" : `Continue #${i + 1}`}
              </Button>
            ))}
          </span>
        </div>
      )}

      {lastSignInAt && (
        <RecentlyAddedReceipts
          receipts={recentlyAdded.items}
          hiddenCount={recentlyAdded.hiddenCount}
          signInKey={lastSignInAt}
          viewLabel={jobFilter ? `${jobFilter}, ${rangeLabel}` : rangeLabel}
          onSelect={setSelectedReceipt}
        />
      )}

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
        selection={selection}
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
        selection={selection}
      />

      <BulkCategoryControls
        selectedIds={selectedIds}
        visibleCount={filteredReceipts.length}
        onSelectAllVisible={() => {
          const ids = filteredReceipts.slice(0, BULK_CATEGORY_MAX).map((r) => r.id);
          setSelected(new Set(ids));
          if (filteredReceipts.length > BULK_CATEGORY_MAX) {
            toast.info(
              `Only the first ${BULK_CATEGORY_MAX} can be changed at once. Narrow the filters for the rest.`,
            );
          }
        }}
        onClear={() => setSelected(new Set())}
        onMoved={({ category, previous, retaxed }) => {
          const moved = new Set(previous.map((p) => p.id));
          const newTax = new Map(retaxed.map((t) => [t.id, t.patch]));
          setReceipts((prev) =>
            prev.map((r) =>
              moved.has(r.id) ? { ...r, tax_category: category, ...(newTax.get(r.id) ?? {}) } : r,
            ),
          );
          setSelected(new Set());
        }}
        onTaxCodeSet={({ retaxed }) => {
          const newTax = new Map(retaxed.map((t) => [t.id, t.patch]));
          setReceipts((prev) => prev.map((r) => (newTax.has(r.id) ? { ...r, ...newTax.get(r.id)! } : r)));
          setSelected(new Set());
        }}
        onTaxCodeRestored={(rows) => {
          const back = new Map(rows.map((r) => [r.id, r.tax]));
          setReceipts((prev) => prev.map((r) => (back.has(r.id) ? { ...r, ...back.get(r.id)! } : r)));
        }}
        onRestored={(rows) => {
          const back = new Map(rows.map((r) => [r.id, r]));
          setReceipts((prev) =>
            prev.map((r) => {
              const b = back.get(r.id);
              return b ? { ...r, tax_category: b.category, ...(b.tax ?? {}) } : r;
            }),
          );
        }}
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
