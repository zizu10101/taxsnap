"use client";

import { useState } from "react";
import { Clock, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmployeesNav } from "@/components/employees/employees-nav";
import { EmployeeLink } from "@/components/employees/employee-link";
import { Badge } from "@/components/ui/badge";
import { HourEntryDialog } from "@/components/hours/hour-entry-dialog";
import { EditSessionTimesDialog } from "@/components/hours/edit-session-times-dialog";
import { DeleteSessionDialog } from "@/components/hours/delete-session-dialog";
import { ReviewBadge } from "@/components/employees/employee-sessions-dialog";
import type { Employee, HourEntryWithRelations, Job } from "@/lib/database.types";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

const clockTimeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

// "8:02 AM - 10:15 AM" for a clocked entry (a session that ends on a later
// day also shows its end date).
function formatSessionRange(startIso: string, endIso: string | null) {
  const start = new Date(startIso);
  if (!endIso) return `${clockTimeFormat.format(start)} - now`;
  const end = new Date(endIso);
  const endText =
    start.toDateString() === end.toDateString()
      ? clockTimeFormat.format(end)
      : `${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${clockTimeFormat.format(end)}`;
  return `${clockTimeFormat.format(start)} - ${endText}`;
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
  // Which row is being edited: a manually logged entry opens the regular
  // hours dialog; a clocked one opens the start/end time editor instead,
  // because its hours/date are derived from the session and the API refuses
  // direct edits to them.
  const [editingManual, setEditingManual] = useState<HourEntryWithRelations | null>(null);
  const [editingSession, setEditingSession] = useState<HourEntryWithRelations | null>(null);
  const [deletingSession, setDeletingSession] = useState<HourEntryWithRelations | null>(null);

  function upsert(entry: HourEntryWithRelations) {
    setEntries((prev) => {
      const exists = prev.some((e) => e.id === entry.id);
      // Merge so a response that does not embed the session (PATCH/POST
      // select) cannot wipe the clocked-session info already on the row.
      return exists
        ? prev.map((e) => (e.id === entry.id ? { ...e, ...entry } : e))
        : [entry, ...prev];
    });
  }

  // After a session's times change, the DB has rewritten the linked entry
  // (hours, date, cost). Re-read just that entry rather than recomputing
  // anything here. Not found = the new range rounded to 0.00 hours, so the
  // entry no longer exists.
  async function refreshFromSession(sessionId: string) {
    try {
      const res = await fetch(`/api/hours?time_session_id=${sessionId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to refresh");
      const fresh = (data.hourEntries ?? [])[0] as HourEntryWithRelations | undefined;
      setEntries((prev) =>
        fresh
          ? prev.map((e) => (e.id === fresh.id ? fresh : e))
          : prev.filter((e) => e.session?.id !== sessionId),
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Saved, but could not refresh - reload the page.",
      );
    }
  }

  function startEdit(entry: HourEntryWithRelations) {
    if (entry.session) setEditingSession(entry);
    else setEditingManual(entry);
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
      <EmployeesNav active="hours" />

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
        <Card className="gap-0 py-0">
          <CardContent className="p-0">
            {/* Desktop: a real EMPLOYEE/JOB/DATE/HOURS/COST table, same
                sm:grid/mobile-card split ReceiptsList uses. */}
            <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1.4fr)_150px_130px_110px_auto] items-center gap-3 border-b bg-muted/40 px-4 py-2.5 font-mono text-[11px] font-semibold tracking-wider text-muted-foreground uppercase sm:grid">
              <span>Employee</span>
              <span>Job</span>
              <span>Date</span>
              <span>Hours</span>
              <span className="text-right">Cost</span>
              <span />
            </div>
            <div className="divide-y">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1.4fr)_150px_130px_110px_auto] sm:items-center sm:gap-3"
                >
                  {/* Mobile row (below sm) - unchanged card-style layout. */}
                  <div className="flex items-center justify-between gap-3 sm:hidden">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium">
                          <EmployeeLink name={entry.employee.name} />
                        </p>
                        {entry.session && <Badge variant="secondary">Clocked</Badge>}
                        {entry.session && <ReviewBadge session={entry.session} />}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {entry.job.name} · {formatDate(entry.work_date)} · {entry.hours}h @{" "}
                        {formatCurrency(entry.rate)}/hr
                      </p>
                      {entry.session && (
                        <p className="truncate text-xs text-muted-foreground tabular-nums">
                          {formatSessionRange(entry.session.clock_in_at, entry.session.clock_out_at)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="mr-1 font-semibold tabular-nums">
                        {formatCurrency(entry.labor_cost)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={entry.session ? "Edit clocked times" : "Edit hours"}
                        onClick={() => startEdit(entry)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={entry.session ? "Delete clocked session" : "Delete"}
                        onClick={() =>
                          entry.session ? setDeletingSession(entry) : handleDelete(entry.id)
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Desktop row (sm+) - one grid cell per column, same data. */}
                  <div className="hidden min-w-0 items-center gap-2 sm:flex">
                    <p className="truncate text-sm font-medium">
                      <EmployeeLink name={entry.employee.name} />
                    </p>
                    {entry.session && <Badge variant="secondary">Clocked</Badge>}
                    {entry.session && <ReviewBadge session={entry.session} />}
                  </div>
                  <p className="hidden truncate text-sm text-muted-foreground sm:block">
                    {entry.job.name}
                  </p>
                  <span className="hidden font-mono text-xs text-muted-foreground sm:block">
                    {formatDate(entry.work_date)}
                    {entry.session && (
                      <span className="block text-[11px] tabular-nums">
                        {formatSessionRange(entry.session.clock_in_at, entry.session.clock_out_at)}
                      </span>
                    )}
                  </span>
                  <span className="hidden text-sm tabular-nums sm:block">
                    {entry.hours}h @ {formatCurrency(entry.rate)}/hr
                  </span>
                  <span className="hidden text-right text-sm font-semibold tabular-nums sm:block">
                    {formatCurrency(entry.labor_cost)}
                  </span>
                  <span className="hidden items-center justify-self-end sm:flex">
                    <Button
                      variant="ghost"
                      size="icon"
                      title={entry.session ? "Edit clocked times" : "Edit hours"}
                      onClick={() => startEdit(entry)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={entry.session ? "Delete clocked session" : "Delete"}
                      onClick={() =>
                        entry.session ? setDeletingSession(entry) : handleDelete(entry.id)
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {editingSession?.session && (
        <EditSessionTimesDialog
          key={editingSession.session.id}
          session={editingSession.session}
          title={`${editingSession.employee.name} on ${editingSession.job.name}`}
          open
          onOpenChange={(open) => !open && setEditingSession(null)}
          onSaved={refreshFromSession}
        />
      )}

      {deletingSession?.session && (
        <DeleteSessionDialog
          key={deletingSession.session.id}
          sessionId={deletingSession.session.id}
          completed={deletingSession.session.clock_out_at !== null}
          description={`${deletingSession.employee.name} on ${deletingSession.job.name}, ${formatDate(deletingSession.work_date)} (${deletingSession.hours}h, ${formatCurrency(deletingSession.labor_cost)})`}
          open
          onOpenChange={(open) => !open && setDeletingSession(null)}
          onDeleted={(sessionId) =>
            setEntries((prev) => prev.filter((e) => e.session?.id !== sessionId))
          }
        />
      )}

      <HourEntryDialog
        key={editingManual?.id ?? "edit-none"}
        open={editingManual !== null}
        onOpenChange={(open) => !open && setEditingManual(null)}
        employees={employees}
        jobs={jobs}
        entry={editingManual}
        onSaved={upsert}
        onJobCreated={(job) =>
          setJobs((prev) => [...prev, job].sort((a, b) => a.name.localeCompare(b.name)))
        }
      />

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
