"use client";

import { useSyncExternalStore } from "react";
import { Clock, History, KeyRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatElapsedShort } from "@/lib/format-duration";
import type { OpenSessionInfo } from "@/components/employees/close-session-dialog";

// A session open this long almost certainly means a forgotten clock-out.
export const STALE_SESSION_HOURS = 12;

// Minute-resolution tick for "clocked in for 3h 12m". 0 on the server so
// SSR and the first client paint agree; the elapsed text appears once mounted.
function subscribeTick(callback: () => void) {
  const id = setInterval(callback, 30_000);
  return () => clearInterval(id);
}
const getTick = () => Math.floor(Date.now() / 30_000) * 30_000;
const getServerTick = () => 0;

const timeFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

export function EmployeeAccessRow({
  hasPin,
  openSession,
  onResetPin,
  onCloseSession,
  onViewSessions,
}: {
  hasPin: boolean;
  openSession: OpenSessionInfo | null;
  onResetPin: () => void;
  onCloseSession: () => void;
  onViewSessions: () => void;
}) {
  const now = useSyncExternalStore(subscribeTick, getTick, getServerTick);
  const stale =
    openSession !== null &&
    now > 0 &&
    now - new Date(openSession.clockInAt).getTime() > STALE_SESSION_HOURS * 3600_000;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 sm:col-span-full sm:mt-0 sm:border-t-0 sm:pt-1">
      <div className="flex items-center gap-2">
        {hasPin ? (
          <>
            <Badge variant="secondary">
              <KeyRound />
              PIN set
            </Badge>
            <Button variant="ghost" size="sm" onClick={onResetPin}>
              Reset PIN
            </Button>
          </>
        ) : (
          <Badge variant="outline">No login set up</Badge>
        )}
      </div>

      {openSession && (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={stale ? "destructive" : "default"}>
            <Clock />
            Clocked in since {timeFormat.format(new Date(openSession.clockInAt))}
          </Badge>
          <span className="text-xs text-muted-foreground" suppressHydrationWarning>
            {openSession.jobName}
            {now > 0 && ` · ${formatElapsedShort(openSession.clockInAt, now)}`}
          </span>
          {stale && (
            <span className="text-xs font-medium text-destructive">
              Possibly forgotten - check the end time
            </span>
          )}
          <Button variant={stale ? "default" : "outline"} size="sm" onClick={onCloseSession}>
            Close session
          </Button>
        </div>
      )}

      <Button variant="ghost" size="sm" className="ml-auto" onClick={onViewSessions}>
        <History className="h-4 w-4" />
        Sessions
      </Button>
    </div>
  );
}
