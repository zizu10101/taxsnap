"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { TAX_CATEGORIES } from "@/lib/tax-categories";
import type { ExpenseTemplateWithJob, Receipt } from "@/lib/database.types";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Sentinel values for the job Select - same inline-create pattern as
// upload-receipt.tsx and document-builder.tsx's own job pickers.
const NO_JOB = "__no_job__";
const NEW_JOB = "__new_job__";

const NO_RECURRENCE = "__none__";
const RECURRENCE_SELECT_ITEMS: Record<string, string> = {
  [NO_RECURRENCE]: "No recurrence hint",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

function emptyForm(template?: ExpenseTemplateWithJob | null) {
  return {
    merchant_name: template?.description ?? "",
    transaction_date: todayIso(),
    tax_category: template?.default_tax_category ?? "Other",
    total_amount: template?.default_amount ?? 0,
    tax_amount: template?.default_tax_amount ?? 0,
  };
}

// Manual expense entry - for costs with no physical receipt to scan (rent,
// phone bill, etc). Posts to the same POST /api/receipts route the AI-scan
// "Approve & Save" step already uses, just with image_path omitted -
// receipts.image_url is already nullable and nothing downstream (HST calc,
// accountant export, job cost rollup) requires it, so this needed no new
// column or "source" flag: image_url IS NULL already means "no scanned
// receipt" unambiguously, since the scan flow always sets it.
//
// When `template` is set (opened via "From Template"), the form is
// pre-filled from it - the caller is expected to key this component by
// template?.id so a different pick (or "Add Expense" with no template)
// gets a fresh initial state, same pattern as ServiceDialog's own
// key={editing?.id ?? "new"} elsewhere in this app, rather than
// resyncing state from a prop change in an effect.
export function ManualExpenseDialog({
  open,
  onOpenChange,
  existingJobs,
  template = null,
  onSaved,
  onTemplateSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingJobs: string[];
  template?: ExpenseTemplateWithJob | null;
  onSaved: (receipt: Receipt) => void;
  onTemplateSaved?: (template: ExpenseTemplateWithJob) => void;
}) {
  const [form, setForm] = useState(() => emptyForm(template));
  const [jobMode, setJobMode] = useState<string>(template?.job?.name ?? NO_JOB);
  const [newJobName, setNewJobName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [recurrenceHint, setRecurrenceHint] = useState(NO_RECURRENCE);

  const jobSelectItems = useMemo(() => {
    const map: Record<string, string> = { [NO_JOB]: "No job", [NEW_JOB]: "+ Add new job" };
    for (const job of existingJobs) map[job] = job;
    return map;
  }, [existingJobs]);

  function reset() {
    setForm(emptyForm(template));
    setJobMode(template?.job?.name ?? NO_JOB);
    setNewJobName("");
    setSaveAsTemplate(false);
    setTemplateName("");
    setRecurrenceHint(NO_RECURRENCE);
  }

  function handleJobModeChange(value: string) {
    setJobMode(value);
    if (value === NEW_JOB) setNewJobName("");
  }

  async function handleSave() {
    if (!form.merchant_name.trim()) {
      toast.error("Enter a description for this expense.");
      return;
    }
    if (saveAsTemplate && !templateName.trim()) {
      toast.error("Enter a name for the template, or uncheck “Save as template”.");
      return;
    }

    const jobName =
      jobMode === NO_JOB ? null : jobMode === NEW_JOB ? newJobName.trim() : jobMode;

    setSaving(true);
    try {
      const res = await fetch("/api/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant_name: form.merchant_name.trim(),
          transaction_date: form.transaction_date,
          total_amount: form.total_amount,
          tax_amount: form.tax_amount,
          tax_category: form.tax_category,
          job_name: jobName,
          source_template_id: template?.id ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save expense");

      onSaved(data.receipt as Receipt);
      toast.success("Expense added");

      if (saveAsTemplate) {
        const templateRes = await fetch("/api/expense-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: templateName.trim(),
            description: form.merchant_name.trim(),
            default_amount: form.total_amount,
            default_tax_amount: form.tax_amount,
            default_tax_category: form.tax_category,
            job_name: jobName,
            recurrence_hint: recurrenceHint === NO_RECURRENCE ? null : recurrenceHint,
          }),
        });
        const templateData = await templateRes.json();
        if (!templateRes.ok) {
          toast.error(templateData.error || "Expense saved, but the template couldn't be saved");
        } else {
          toast.success("Template saved");
          onTemplateSaved?.(templateData.template as ExpenseTemplateWithJob);
        }
      }

      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Expense</DialogTitle>
          <DialogDescription>
            For costs with no physical receipt to scan, like rent or a phone
            bill.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="expense-description">Description</Label>
            <Input
              id="expense-description"
              placeholder="e.g. Office rent - September"
              value={form.merchant_name}
              onChange={(e) => setForm({ ...form, merchant_name: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="expense-date">Date</Label>
              <Input
                id="expense-date"
                type="date"
                value={form.transaction_date}
                onChange={(e) => setForm({ ...form, transaction_date: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expense-category">Category</Label>
              <Select
                value={form.tax_category}
                onValueChange={(v) => v && setForm({ ...form, tax_category: v })}
              >
                <SelectTrigger id="expense-category" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TAX_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="expense-amount">Amount ($)</Label>
              <NumberInput
                id="expense-amount"
                step="0.01"
                value={form.total_amount}
                onValueChange={(total_amount) => setForm({ ...form, total_amount })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expense-tax">HST/tax paid ($)</Label>
              <NumberInput
                id="expense-tax"
                step="0.01"
                value={form.tax_amount}
                onValueChange={(tax_amount) => setForm({ ...form, tax_amount })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="expense-job">Job (optional)</Label>
            <Select
              items={jobSelectItems}
              value={jobMode}
              onValueChange={(v) => v && handleJobModeChange(v)}
            >
              <SelectTrigger id="expense-job" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_JOB}>No job</SelectItem>
                <SelectItem value={NEW_JOB}>+ Add new job</SelectItem>
                {existingJobs.map((job) => (
                  <SelectItem key={job} value={job}>
                    {job}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {jobMode === NEW_JOB ? (
              <Input
                placeholder="e.g. 123 Main St or Job #4521"
                value={newJobName}
                onChange={(e) => setNewJobName(e.target.value)}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                Leave as &quot;No job&quot; for overhead costs like rent, phone, or
                insurance - it&apos;ll show up under Overhead Expenses instead of
                a specific job.
              </p>
            )}
          </div>

          <div className="space-y-2 rounded-lg border p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={saveAsTemplate}
                onCheckedChange={(checked) => setSaveAsTemplate(!!checked)}
              />
              Save as reusable template
            </label>
            {saveAsTemplate && (
              <div className="grid gap-3 pt-1">
                <div className="space-y-2">
                  <Label htmlFor="template-name">Template name</Label>
                  <Input
                    id="template-name"
                    placeholder="e.g. Office Rent"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="template-recurrence">Recurrence (optional, informational)</Label>
                  <Select
                    items={RECURRENCE_SELECT_ITEMS}
                    value={recurrenceHint}
                    onValueChange={(v) => v && setRecurrenceHint(v)}
                  >
                    <SelectTrigger id="template-recurrence" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(RECURRENCE_SELECT_ITEMS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save Expense
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
