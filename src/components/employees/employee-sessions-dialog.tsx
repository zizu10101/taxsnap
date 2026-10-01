"use client";

import { useEffect, useState } from "react";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DeleteSessionDialog } from "@/components/hours/delete-session-dialog";
import { fromLocalInput, toLocalInput } from "@/lib/datetime-local";
import { formatSessionHours } from "@/lib/format-duration";
import type { TimeSession } from "@/lib/database.types";

type SessionRow = TimeSession & { job: { id: string; name: string } | null };

const fmt = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

// A session the owner closed or edited must never look like an ordinary
// employee-completed one: it gets a visible badge, and the original times
// are shown so the change is reviewable.
export function ReviewBadge({
  session,
}: {
  session: Pick<
    TimeSession,
    "owner_edited_at" | "closed_by" | "clock_in_at" | "original_clock_in_at" | "original_clock_out_at"
  >;
}) {
  if (!session.owner_edited_at && session.closed_by !== "owner") return null;
  const originalIn = session.original_clock_in_at ?? session.clock_in_at;
  const original = session.original_clock_out_at
    ? `${fmt.format(new Date(originalIn))} – ${fmt.format(new Date(session.original_clock_out_at))}`
    : `${fmt.format(new Date(originalIn))} – (still open)`;
  return (
    <Badge variant="destructive" title={`Originally ${original}`}>
      {session.closed_by === "owner" && !session.original_clock_out_at
        ? "Closed by owner"
        : "Edited by owner"}
    </Badge>
  );
}

function SessionRowView({
  session,
  employeeName,
  onSaved,
  onDeleted,
}: {
  session: SessionRow;
  employeeName: string;
  onSaved: (updated: TimeSession) => void;
  onDeleted: (deleted: SessionRow) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [inValue, setInValue] = useState(() => toLocalInput(session.clock_in_at));
  const [outValue, setOutValue] = useState(() =>
    session.clock_out_at ? toLocalInput(session.clock_out_at) : "",
  );
  const [saving, setSaving] = useState(false);
  const isOpen = session.clock_out_at === null;

  async function save() {
    const clockIn = fromLocalInput(inValue);
    const clockOut = isOpen ? null : fromLocalInput(outValue);
    if (!clockIn || (!isOpen && !clockOut)) {
      toast.error("Enter valid start and end times.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/time-sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clock_in_at: clockIn, clock_out_at: clockOut }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't save changes.");
      onSaved(data.session as TimeSession);
      setEditing(false);
      toast.success("Session updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="space-y-2 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium">{session.job?.name ?? "Job"}</p>
            {isOpen && <Badge variant="secondary">Open</Badge>}
            <ReviewBadge session={session} />
          </div>
          {!editing && (
            <p className="text-xs text-muted-foreground tabular-nums">
              {fmt.format(new Date(session.clock_in_at))} –{" "}
              {session.clock_out_at ? fmt.format(new Date(session.clock_out_at)) : "now"}
              {session.clock_out_at &&
                ` · ${formatSessionHours(session.clock_in_at, session.clock_out_at)}`}
            </p>
          )}
        </div>
        {!editing && (
          <div className="flex shrink-0">
            <Button variant="ghost" size="icon" title="Edit times" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Delete session"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {editing && (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-muted-foreground">
              Start
              <Input
                type="datetime-local"
                value={inValue}
                onChange={(e) => setInValue(e.target.value)}
              />
            </label>
            {!isOpen && (
              <label className="space-y-1 text-xs text-muted-foreground">
                End
                <Input
                  type="datetime-local"
                  value={outValue}
                  onChange={(e) => setOutValue(e.target.value)}
                />
              </label>
            )}
          </div>
          {isOpen && (
            <p className="text-xs text-muted-foreground">
              Still clocked in - to give it an end time, use &quot;Close session&quot; on the
              employee&apos;s row.
            </p>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      <DeleteSessionDialog
        sessionId={session.id}
        completed={session.clock_out_at !== null}
        description={`${employeeName} on ${session.job?.name ?? "a job"}, ${fmt.format(new Date(session.clock_in_at))}`}
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        onDeleted={() => onDeleted(session)}
      />
    </li>
  );
}

export function EmployeeSessionsDialog({
  employee,
  open,
  onOpenChange,
  onChanged,
}: {
  employee: { id: string; name: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // openSessionDeleted lets the parent drop its "clocked in since" badge for
  // an open session that was just deleted.
  onChanged: (change?: { openSessionDeleted?: boolean }) => void;
}) {
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !employee) return;
    let cancelled = false;
    fetch(`/api/time-sessions?employee_id=${employee.id}&limit=30`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Couldn't load sessions.");
        if (!cancelled) {
          setSessions(data.sessions as SessionRow[]);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load sessions.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, employee]);

  function handleDeleted(deleted: SessionRow) {
    setSessions((prev) => (prev ? prev.filter((s) => s.id !== deleted.id) : prev));
    onChanged({ openSessionDeleted: deleted.clock_out_at === null });
  }

  function handleSaved(updated: TimeSession) {
    setSessions((prev) =>
      prev ? prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)) : prev,
    );
    onChanged();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{employee?.name}&apos;s sessions</DialogTitle>
          <DialogDescription>
            Fix a wrong start or end time. Hours and job cost update automatically.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : sessions === null ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : sessions.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No clocked sessions yet.
          </p>
        ) : (
          <ul className="divide-y">
            {sessions.map((s) => (
              <SessionRowView
                key={s.id}
                session={s}
                employeeName={employee?.name ?? "Employee"}
                onSaved={handleSaved}
                onDeleted={handleDeleted}
              />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
