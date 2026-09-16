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
import type { ExpenseTemplateWithJob } from "@/lib/database.types";

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

function formFrom(template: ExpenseTemplateWithJob | null) {
  return {
    name: template?.name ?? "",
    description: template?.description ?? "",
    default_amount: template?.default_amount ?? 0,
    default_tax_amount: template?.default_tax_amount ?? 0,
    default_tax_category: template?.default_tax_category ?? "Other",
  };
}

// Edit-only - templates are created exclusively via "Save as reusable
// template" on the manual expense form (see manual-expense-dialog.tsx),
// not here. Caller keys this by template?.id so switching which template
// is being edited (or closing to null) gets a fresh initial state,
// rather than resyncing from a prop change in an effect.
export function ExpenseTemplateEditDialog({
  open,
  onOpenChange,
  template,
  existingJobs,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: ExpenseTemplateWithJob | null;
  existingJobs: string[];
  onSaved: (template: ExpenseTemplateWithJob) => void;
}) {
  const [form, setForm] = useState(() => formFrom(template));
  const [jobMode, setJobMode] = useState<string>(template?.job?.name ?? NO_JOB);
  const [newJobName, setNewJobName] = useState("");
  const [recurrenceHint, setRecurrenceHint] = useState(template?.recurrence_hint ?? NO_RECURRENCE);
  const [saving, setSaving] = useState(false);

  const jobSelectItems = useMemo(() => {
    const map: Record<string, string> = { [NO_JOB]: "No job", [NEW_JOB]: "+ Add new job" };
    for (const job of existingJobs) map[job] = job;
    return map;
  }, [existingJobs]);

  function handleJobModeChange(value: string) {
    setJobMode(value);
    if (value === NEW_JOB) setNewJobName("");
  }

  async function handleSave() {
    if (!template) return;
    if (!form.name.trim() || !form.description.trim()) {
      toast.error("A template name and description are required.");
      return;
    }

    const jobName =
      jobMode === NO_JOB ? null : jobMode === NEW_JOB ? newJobName.trim() : jobMode;

    setSaving(true);
    try {
      const res = await fetch(`/api/expense-templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim(),
          default_amount: form.default_amount,
          default_tax_amount: form.default_tax_amount,
          default_tax_category: form.default_tax_category,
          job_name: jobName,
          recurrence_hint: recurrenceHint === NO_RECURRENCE ? null : recurrenceHint,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save template");

      onSaved(data.template as ExpenseTemplateWithJob);
      toast.success("Template updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Template</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="edit-template-name">Template name</Label>
            <Input
              id="edit-template-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-template-description">Description</Label>
            <Input
              id="edit-template-description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-template-amount">Amount ($)</Label>
              <NumberInput
                id="edit-template-amount"
                step="0.01"
                value={form.default_amount}
                onValueChange={(default_amount) => setForm({ ...form, default_amount })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-template-tax">HST/tax paid ($)</Label>
              <NumberInput
                id="edit-template-tax"
                step="0.01"
                value={form.default_tax_amount}
                onValueChange={(default_tax_amount) => setForm({ ...form, default_tax_amount })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-template-category">Category</Label>
            <Select
              value={form.default_tax_category}
              onValueChange={(v) => v && setForm({ ...form, default_tax_category: v })}
            >
              <SelectTrigger id="edit-template-category" className="w-full">
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

          <div className="space-y-2">
            <Label htmlFor="edit-template-job">Job (optional)</Label>
            <Select
              items={jobSelectItems}
              value={jobMode}
              onValueChange={(v) => v && handleJobModeChange(v)}
            >
              <SelectTrigger id="edit-template-job" className="w-full">
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

          <div className="space-y-2">
            <Label htmlFor="edit-template-recurrence">Recurrence (optional, informational)</Label>
            <Select
              items={RECURRENCE_SELECT_ITEMS}
              value={recurrenceHint}
              onValueChange={(v) => v && setRecurrenceHint(v)}
            >
              <SelectTrigger id="edit-template-recurrence" className="w-full">
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

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
