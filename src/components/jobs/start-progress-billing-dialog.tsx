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
import type { Job } from "@/lib/database.types";

const NEW_JOB = "__new_job__";

// Jobs that already have a contract_value are already progress-billed -
// offering them here again would let a second contract value silently
// overwrite the first, so they're left out of the picker entirely.
export function StartProgressBillingDialog({
  open,
  onOpenChange,
  eligibleJobs,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eligibleJobs: Job[];
  onStarted: (job: Job) => void;
}) {
  const [jobMode, setJobMode] = useState<string>(eligibleJobs[0]?.id ?? NEW_JOB);
  const [newJobName, setNewJobName] = useState("");
  const [contractValue, setContractValue] = useState(0);
  const [saving, setSaving] = useState(false);

  const jobSelectItems = useMemo(() => {
    const map: Record<string, string> = { [NEW_JOB]: "+ New job" };
    for (const job of eligibleJobs) map[job.id] = job.name;
    return map;
  }, [eligibleJobs]);

  function reset() {
    setJobMode(eligibleJobs[0]?.id ?? NEW_JOB);
    setNewJobName("");
    setContractValue(0);
  }

  async function handleStart() {
    if (jobMode === NEW_JOB && !newJobName.trim()) {
      toast.error("Enter a job name.");
      return;
    }
    if (!contractValue || contractValue <= 0) {
      toast.error("Enter a contract value.");
      return;
    }

    setSaving(true);
    try {
      let jobId = jobMode;
      if (jobMode === NEW_JOB) {
        const res = await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newJobName.trim() }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (data.code === "FREE_LIMIT_REACHED") {
            toast.error(data.error);
            return;
          }
          throw new Error(data.error || "Failed to create job");
        }
        jobId = data.job.id;
      }

      const res = await fetch(`/api/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contract_value: contractValue }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to set contract value");

      onStarted(data.job as Job);
      toast.success("Progress billing started");
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
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Start Progress Billing</DialogTitle>
          <DialogDescription>
            Pick or create the job, and enter the total contract value you agreed
            to with the client.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="progress-job">Job</Label>
            {eligibleJobs.length > 0 ? (
              <Select items={jobSelectItems} value={jobMode} onValueChange={(v) => v && setJobMode(v)}>
                <SelectTrigger id="progress-job" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {eligibleJobs.map((job) => (
                    <SelectItem key={job.id} value={job.id}>
                      {job.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW_JOB}>+ New job</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <p className="text-xs text-muted-foreground">
                No existing jobs without progress billing yet - enter a name below.
              </p>
            )}
            {(jobMode === NEW_JOB || eligibleJobs.length === 0) && (
              <Input
                placeholder="e.g. 123 Main St - Full Renovation"
                value={newJobName}
                onChange={(e) => setNewJobName(e.target.value)}
              />
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="progress-contract-value">Contract value ($)</Label>
            <NumberInput
              id="progress-contract-value"
              value={contractValue}
              onValueChange={setContractValue}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleStart} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
