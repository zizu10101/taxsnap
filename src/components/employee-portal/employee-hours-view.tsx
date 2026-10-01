"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Clock, Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDuration, formatSessionHours } from "@/lib/format-duration";

type OpenSession = { clockInAt: string; jobName: string };
type HistoryRow = { id: string; clockInAt: string; clockOutAt: string; jobName: string };

// One-second ticker for the live elapsed time. A primitive snapshot (whole
// seconds) is stable between calls, as useSyncExternalStore requires. The
// server snapshot is 0 so SSR never renders a time that would mismatch the
// client's first paint - the elapsed text is only shown once it's non-zero.
function subscribeTick(callback: () => void) {
  const id = setInterval(callback, 1000);
  return () => clearInterval(id);
}
const getTick = () => Math.floor(Date.now() / 1000);
const getServerTick = () => 0;

const dateFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

export function EmployeeHoursView({
  employeeName,
  businessName,
  jobs,
  openSession,
  history,
}: {
  employeeName: string;
  businessName: string | null;
  jobs: { id: string; name: string }[];
  openSession: OpenSession | null;
  history: HistoryRow[];
}) {
  const router = useRouter();
  const [jobId, setJobId] = useState("");
  const [busy, setBusy] = useState(false);
  const tick = useSyncExternalStore(subscribeTick, getTick, getServerTick);

  const jobItems = Object.fromEntries(jobs.map((j) => [j.id, j.name]));

  async function post(url: string, body?: unknown) {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        router.replace("/employee/hours");
        router.refresh();
        return;
      }
      if (!res.ok) {
        toast.error(data.error || "Something went wrong. Try again.");
        // A blocked double clock-in means the view is stale (second tab):
        // refresh so it shows the open session that actually exists.
        if (data.code === "ALREADY_CLOCKED_IN") router.refresh();
        return;
      }
      router.refresh();
    } catch {
      toast.error("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await fetch("/api/employee-portal/logout", { method: "POST" }).catch(() => {});
    router.replace("/employee/hours");
    router.refresh();
  }

  const elapsedSeconds =
    openSession && tick > 0
      ? Math.max(0, tick - Math.floor(new Date(openSession.clockInAt).getTime() / 1000))
      : null;

  return (
    <main className="mx-auto w-full max-w-md space-y-5 px-4 py-6">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold">{employeeName}</h1>
          {businessName && (
            <p className="truncate text-sm text-muted-foreground">{businessName}</p>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={signOut}>
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </header>

      {openSession ? (
        <Card>
          <CardContent className="space-y-4 py-6 text-center">
            <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Clocked in
            </p>
            <p className="text-lg font-semibold">{openSession.jobName}</p>
            <p className="font-mono text-4xl font-semibold tabular-nums" suppressHydrationWarning>
              {elapsedSeconds === null ? "–:––:––" : formatDuration(elapsedSeconds)}
            </p>
            <p className="text-sm text-muted-foreground">
              Since {timeFormat.format(new Date(openSession.clockInAt))}
            </p>
            <Button
              size="lg"
              className="w-full"
              disabled={busy}
              onClick={() => post("/api/employee-portal/clock-out")}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
              Clock out
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-4 py-6">
            <div className="space-y-2">
              <Label htmlFor="clock-job">Job</Label>
              <Select items={jobItems} value={jobId} onValueChange={(v) => setJobId(v ?? "")}>
                <SelectTrigger id="clock-job" className="w-full">
                  <SelectValue placeholder="Select a job" />
                </SelectTrigger>
                <SelectContent>
                  {jobs.map((j) => (
                    <SelectItem key={j.id} value={j.id}>
                      {j.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {jobs.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No jobs yet. Ask your employer to add one.
                </p>
              )}
            </div>
            <Button
              size="lg"
              className="w-full"
              disabled={busy || !jobId}
              onClick={() => post("/api/employee-portal/clock-in", { job_id: jobId })}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
              Clock in
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Switching jobs? Clock out, then clock in to the new one.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Your recent hours</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {history.length === 0 ? (
            <p className="px-4 pb-6 text-center text-sm text-muted-foreground">
              Nothing yet. Your finished sessions will show up here.
            </p>
          ) : (
            <ul className="divide-y">
              {history.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.jobName}</p>
                    <p className="text-xs text-muted-foreground">
                      {dateFormat.format(new Date(row.clockInAt))} ·{" "}
                      {timeFormat.format(new Date(row.clockInAt))}–
                      {timeFormat.format(new Date(row.clockOutAt))}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums">
                    {formatSessionHours(row.clockInAt, row.clockOutAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
