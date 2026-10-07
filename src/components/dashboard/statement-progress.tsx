"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { formatElapsed } from "@/lib/statement-timing";

// A clock that counts up from `since` (a Date.now() value). It ticks twice a second from inside an
// interval callback, so nothing sets state synchronously in an effect. `since === null` shows nothing.
export function ElapsedClock({ since, className }: { since: number | null; className?: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (since === null) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [since]);

  if (since === null) return null;
  return <span className={`tabular-nums ${className ?? ""}`}>{formatElapsed(now - since)}</span>;
}

// A PDF that couldn't be split (usually password-protected by the bank) is read in ONE piece, so
// there is no per-page progress to show - only one long call. Say so plainly, with the clock, rather
// than leaving a spinner that looks frozen. After a while it says the wait is still normal.
export function WholeFileStatus({ since, pages }: { since: number | null; pages: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (since === null) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [since]);

  const seconds = since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
  return (
    <div className="flex items-start gap-3 rounded-md border bg-muted/40 p-3 text-sm">
      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium">Reading your statement (this takes about 10-15 seconds)</p>
        <p className="text-xs text-muted-foreground">
          {pages} page{pages === 1 ? "" : "s"}, read in one piece · <ElapsedClock since={since} />
        </p>
        {seconds >= 25 && (
          <p className="text-xs text-muted-foreground">
            Still working - a longer statement can take up to a minute. Please keep this window open.
          </p>
        )}
      </div>
    </div>
  );
}
