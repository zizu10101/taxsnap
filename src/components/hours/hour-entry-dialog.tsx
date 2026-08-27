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
import type { Employee, HourEntryWithRelations, Job } from "@/lib/database.types";

const NEW_JOB = "__new_job__";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function HourEntryDialog({
  open,
  onOpenChange,
  employees,
  jobs,
  defaultJobId,
  entry,
  onSaved,
  onJobCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: Employee[];
  jobs: Job[];
  defaultJobId?: string;
  entry?: HourEntryWithRelations | null;
  onSaved: (entry: HourEntryWithRelations) => void;
  onJobCreated?: (job: Job) => void;
}) {
  const isEditing = !!entry;
  const activeEmployees = employees.filter((e) => e.is_active || e.id === entry?.employee_id);

  const [employeeId, setEmployeeId] = useState(
    entry?.employee_id ?? activeEmployees[0]?.id ?? "",
  );
  const [jobId, setJobId] = useState(entry?.job_id ?? defaultJobId ?? jobs[0]?.id ?? "");
  const [newJobName, setNewJobName] = useState("");
  const [workDate, setWorkDate] = useState(entry?.work_date ?? todayIso());
  const [hours, setHours] = useState(entry?.hours ?? 0);
  const [rate, setRate] = useState(
    entry?.rate ?? activeEmployees[0]?.default_hourly_rate ?? 0,
  );
  const [saving, setSaving] = useState(false);

  const employeeSelectItems = useMemo(() => {
    const map: Record<string, string> = {};
    for (const e of activeEmployees) map[e.id] = e.name;
    return map;
  }, [activeEmployees]);

  const jobSelectItems = useMemo(() => {
    const map: Record<string, string> = { [NEW_JOB]: "+ Add new job" };
    for (const j of jobs) map[j.id] = j.name;
    return map;
  }, [jobs]);

  function handleEmployeeChange(id: string) {
    setEmployeeId(id);
    // Auto-fill rate from the employee's default, but it stays editable.
    const employee = activeEmployees.find((e) => e.id === id);
    if (employee) setRate(employee.default_hourly_rate);
  }

  async function handleSave() {
    if (!employeeId) {
      toast.error("Select an employee.");
      return;
    }
    if (jobId === NEW_JOB && !newJobName.trim()) {
      toast.error("Enter a name for the new job.");
      return;
    }
    if (!hours || hours <= 0) {
      toast.error("Enter hours worked.");
      return;
    }

    setSaving(true);
    try {
      const body = {
        employee_id: employeeId,
        job_id: jobId === NEW_JOB ? undefined : jobId,
        job_name: jobId === NEW_JOB ? newJobName : undefined,
        work_date: workDate,
        hours,
        rate,
      };

      const res = await fetch(isEditing ? `/api/hours/${entry!.id}` : "/api/hours", {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");

      const saved = data.hourEntry as HourEntryWithRelations;
      if (jobId === NEW_JOB && onJobCreated) onJobCreated(saved.job);
      onSaved(saved);
      toast.success(isEditing ? "Hour entry updated" : "Hours logged");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit hours" : "Log hours"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="hour-employee">Employee</Label>
            {activeEmployees.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Add an employee first from the Employees page.
              </p>
            ) : (
              <Select
                items={employeeSelectItems}
                value={employeeId}
                onValueChange={(v) => v && handleEmployeeChange(v)}
              >
                <SelectTrigger id="hour-employee" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {activeEmployees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="hour-job">Job</Label>
            <Select
              items={jobSelectItems}
              value={jobId}
              onValueChange={(v) => v && setJobId(v)}
            >
              <SelectTrigger id="hour-job" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW_JOB}>+ Add new job</SelectItem>
                {jobs.map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    {j.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {jobId === NEW_JOB && (
              <Input
                placeholder="Job name"
                value={newJobName}
                onChange={(e) => setNewJobName(e.target.value)}
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="hour-date">Date</Label>
              <Input
                id="hour-date"
                type="date"
                value={workDate}
                onChange={(e) => setWorkDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hour-hours">Hours</Label>
              <NumberInput id="hour-hours" value={hours} onValueChange={setHours} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="hour-rate">Rate ($/hr)</Label>
            <NumberInput id="hour-rate" value={rate} onValueChange={setRate} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEditing ? "Save changes" : "Log hours"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
