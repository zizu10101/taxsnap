"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import type { Job } from "@/lib/database.types";

// Adjusts an already-progress-billed job's contract value (e.g. an
// add-on/change to the original agreed amount) - distinct from
// StartProgressBillingDialog, which only ever sets it once on a job that
// doesn't have one yet. Same PATCH /api/jobs/[id] endpoint either way.
export function EditContractValueDialog({
  open,
  onOpenChange,
  jobId,
  currentValue,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  currentValue: number;
  onSaved: (job: Job) => void;
}) {
  const [value, setValue] = useState(currentValue);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!value || value <= 0) {
      toast.error("Enter a contract value greater than $0.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contract_value: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update contract value");
      onSaved(data.job as Job);
      toast.success("Contract value updated");
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
        if (!next) setValue(currentValue);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit Contract Value</DialogTitle>
          <DialogDescription>
            Adjust the total contract value - e.g. for an approved add-on or
            change to the original agreement.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="edit-contract-value">Contract value ($)</Label>
          <NumberInput id="edit-contract-value" value={value} onValueChange={setValue} />
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
