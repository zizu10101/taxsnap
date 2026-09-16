"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
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
import type { Receipt } from "@/lib/database.types";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Sentinel values for the job Select - same inline-create pattern as
// upload-receipt.tsx and document-builder.tsx's own job pickers.
const NO_JOB = "__no_job__";
const NEW_JOB = "__new_job__";

const EMPTY_FORM = {
  merchant_name: "",
  transaction_date: todayIso(),
  tax_category: "Other" as string,
  total_amount: 0,
  tax_amount: 0,
};

// Manual expense entry - for costs with no physical receipt to scan (rent,
// phone bill, etc). Posts to the same POST /api/receipts route the AI-scan
// "Approve & Save" step already uses, just with image_path omitted -
// receipts.image_url is already nullable and nothing downstream (HST calc,
// accountant export, job cost rollup) requires it, so this needed no new
// column or "source" flag: image_url IS NULL already means "no scanned
// receipt" unambiguously, since the scan flow always sets it.
export function ManualExpenseDialog({
  open,
  onOpenChange,
  existingJobs,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingJobs: string[];
  onSaved: (receipt: Receipt) => void;
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [jobMode, setJobMode] = useState<string>(NO_JOB);
  const [newJobName, setNewJobName] = useState("");
  const [saving, setSaving] = useState(false);

  const jobSelectItems = useMemo(() => {
    const map: Record<string, string> = { [NO_JOB]: "No job", [NEW_JOB]: "+ Add new job" };
    for (const job of existingJobs) map[job] = job;
    return map;
  }, [existingJobs]);

  function reset() {
    setForm(EMPTY_FORM);
    setJobMode(NO_JOB);
    setNewJobName("");
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
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save expense");

      onSaved(data.receipt as Receipt);
      toast.success("Expense added");
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
            {jobMode === NEW_JOB && (
              <Input
                placeholder="e.g. 123 Main St or Job #4521"
                value={newJobName}
                onChange={(e) => setNewJobName(e.target.value)}
              />
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
