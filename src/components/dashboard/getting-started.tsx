"use client";

import { useId, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, Circle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { nextChecklistItem, type ChecklistItem } from "@/lib/onboarding";
import { readChoice, subscribeChoice, writeChoice } from "@/lib/how-this-works";
import {
  checklistStorageKey,
  checklistSummary,
  checklistView,
  resolveChecklistExpanded,
} from "@/lib/checklist-view";

// Before hydration the server never reads storage, so the card renders collapsed (the same
// rule as the "How this works" rows) and then settles on the remembered choice.
const SERVER = "server" as const;

// The dashboard's "Getting started" checklist plus the sample-data controls. The
// checklist collapses to one line (remembered per user in the browser); once every
// item is done it reads "You're all set" with a Dismiss button, which hides it for
// good (profiles.checklist_dismissed_at, the same flag the old X set); the sample
// banner stays for as long as sample rows exist, so they can always be removed.
// No upgrade prompt belongs here - the first minutes are for getting a first
// invoice or receipt done.
export function GettingStarted({
  userId,
  items,
  dismissedAt,
  sampleExists,
}: {
  userId: string;
  items: ChecklistItem[];
  dismissedAt: string | null;
  sampleExists: boolean;
}) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState<"dismiss" | "add-sample" | "remove-sample" | null>(null);

  const doneCount = items.filter((i) => i.done).length;
  const storageKey = checklistStorageKey(userId);
  const stored = useSyncExternalStore(
    subscribeChoice,
    () => readChoice(storageKey) ?? "none",
    () => SERVER,
  );
  const expanded = stored === SERVER ? false : resolveChecklistExpanded(stored === "none" ? null : stored);
  const view = hidden
    ? "hidden"
    : checklistView({ total: items.length, done: doneCount, dismissedAt, expanded });
  const showChecklist = view !== "hidden";
  const panelId = `${useId()}-checklist`;
  const next = nextChecklistItem(items);

  async function dismiss() {
    setBusy("dismiss");
    setHidden(true);
    try {
      const res = await fetch("/api/onboarding/dismiss-checklist", { method: "POST" });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setHidden(false);
      toast.error("Could not close the checklist. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function sample(method: "POST" | "DELETE") {
    const action = method === "POST" ? "add-sample" : "remove-sample";
    setBusy(action);
    try {
      const res = await fetch("/api/onboarding/sample-data", { method });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      toast.success(method === "POST" ? "Sample client and job added" : "Sample data removed");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  function scanReceipt() {
    // The dashboard's own Scan Receipt tile does the work.
    document.querySelector<HTMLElement>("[data-scan-receipt]")?.click();
  }

  return (
    <>
      {sampleExists && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-muted/40 p-3 text-sm">
          <span className="text-muted-foreground">
            Sample data is on: a demo client and job for looking around. They never appear on
            invoices, reports or exports.
          </span>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            disabled={busy !== null}
            onClick={() => sample("DELETE")}
          >
            {busy === "remove-sample" && <Loader2 className="h-4 w-4 animate-spin" />}
            Remove sample data
          </Button>
        </div>
      )}

      {showChecklist && (
        <Card>
          <CardHeader className="pb-2">
            {view === "all-set" ? (
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Check className="h-5 w-5 text-success" />
                  You&apos;re all set
                </CardTitle>
                <Button size="sm" disabled={busy !== null} onClick={dismiss}>
                  {busy === "dismiss" && <Loader2 className="h-4 w-4 animate-spin" />}
                  Dismiss
                </Button>
              </div>
            ) : (
              <button
                type="button"
                aria-expanded={view === "expanded"}
                aria-controls={panelId}
                onClick={() => writeChoice(storageKey, view === "expanded" ? "closed" : "open")}
                className="flex min-h-10 w-full items-center justify-between gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CardTitle className="text-base">
                  {view === "collapsed" ? (
                    <span className="tabular-nums">{checklistSummary(doneCount, items.length)}</span>
                  ) : (
                    <>
                      Getting started{" "}
                      <span className="text-sm font-normal text-muted-foreground tabular-nums">
                        {doneCount} of {items.length}
                      </span>
                    </>
                  )}
                </CardTitle>
                <ChevronRight
                  className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", view === "expanded" && "rotate-90")}
                  aria-hidden="true"
                />
              </button>
            )}
          </CardHeader>
          <CardContent id={panelId} className="space-y-3" hidden={view !== "expanded"}>
            {/* The first thing left to do, as one large button. Nothing is started for
                them: an invoice opens only when this is pressed. */}
            {next && (
              <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-primary">Up next</p>
                <p className="mt-1 text-lg font-semibold">{next.label}</p>
                {next.key === "receipt" ? (
                  <Button size="lg" className="mt-3 h-12 w-full text-base" onClick={scanReceipt}>
                    {next.label}
                  </Button>
                ) : (
                  <Button
                    size="lg"
                    className="mt-3 h-12 w-full text-base"
                    nativeButton={false}
                    render={<Link href={next.href} />}
                  >
                    {next.label}
                  </Button>
                )}
              </div>
            )}
            <div className="space-y-1">
              {items.map((item) => {
                const isNext = next?.key === item.key;
                const row = (
                  <>
                    {item.done ? (
                      <Check className="h-5 w-5 shrink-0 text-success" />
                    ) : (
                      <Circle className={`h-5 w-5 shrink-0 ${isNext ? "text-primary" : "text-muted-foreground"}`} />
                    )}
                    <span
                      className={
                        item.done
                          ? "text-muted-foreground line-through"
                          : isNext
                            ? "font-semibold"
                            : "font-medium"
                      }
                    >
                      {item.label}
                    </span>
                  </>
                );
                const className = "flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-left text-sm";
                if (item.done || isNext) {
                  return (
                    <div key={item.key} className={className}>
                      {row}
                    </div>
                  );
                }
                return item.key === "receipt" ? (
                  <button
                    key={item.key}
                    type="button"
                    onClick={scanReceipt}
                    className={`${className} hover:bg-muted`}
                  >
                    {row}
                  </button>
                ) : (
                  <Link key={item.key} href={item.href} className={`${className} hover:bg-muted`}>
                    {row}
                  </Link>
                );
              })}
            </div>
            {!sampleExists && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 w-full"
                disabled={busy !== null}
                onClick={() => sample("POST")}
              >
                {busy === "add-sample" && <Loader2 className="h-4 w-4 animate-spin" />}
                Try with sample data
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
