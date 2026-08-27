"use client";

import { useState } from "react";
import { Clock, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { JobCostNav } from "@/components/jobs/job-cost-nav";
import { HourEntryDialog } from "@/components/hours/hour-entry-dialog";
import type { Employee, HourEntryWithRelations, Job } from "@/lib/database.types";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function HoursList({
  initialEntries,
  initialEmployees,
  initialJobs,
}: {
  initialEntries: HourEntryWithRelations[];
  initialEmployees: Employee[];
  initialJobs: Job[];
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [employees] = useState(initialEmployees);
  const [jobs, setJobs] = useState(initialJobs);
  const [dialogOpen, setDialogOpen] = useState(false);

  function upsert(entry: HourEntryWithRelations) {
    setEntries((prev) => {
      const exists = prev.some((e) => e.id === entry.id);
      return exists ? prev.map((e) => (e.id === entry.id ? entry : e)) : [entry, ...prev];
    });
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/hours/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete");
      setEntries((prev) => prev.filter((e) => e.id !== id));
      toast.success("Entry deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <div className="space-y-4">
      <JobCostNav active="hours" />

      <Button className="w-full" onClick={() => setDialogOpen(true)}>
        <Plus className="h-4 w-4" />
        Log hours
      </Button>

      {entries.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <Clock className="h-8 w-8" />
            <p className="text-sm">No hours logged yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <Card key={entry.id}>
              <CardContent className="flex items-center justify-between gap-3 py-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{entry.employee.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {entry.job.name} · {formatDate(entry.work_date)} · {entry.hours}h @{" "}
                    {formatCurrency(entry.rate)}/hr
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums">
                    {formatCurrency(entry.labor_cost)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Delete"
                    onClick={() => handleDelete(entry.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <HourEntryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        employees={employees}
        jobs={jobs}
        onSaved={upsert}
        onJobCreated={(job) =>
          setJobs((prev) => [...prev, job].sort((a, b) => a.name.localeCompare(b.name)))
        }
      />
    </div>
  );
}
