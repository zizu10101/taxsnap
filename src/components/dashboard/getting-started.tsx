"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Circle, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { checklistVisible, nextChecklistItem, type ChecklistItem } from "@/lib/onboarding";

// The dashboard's "Get started" checklist plus the sample-data controls. The
// checklist is dismissible and disappears once every item is done; the sample
// banner stays for as long as sample rows exist, so they can always be removed.
// No upgrade prompt belongs here - the first minutes are for getting a first
// invoice or receipt done.
export function GettingStarted({
  items,
  dismissedAt,
  sampleExists,
}: {
  items: ChecklistItem[];
  dismissedAt: string | null;
  sampleExists: boolean;
}) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState<"dismiss" | "add-sample" | "remove-sample" | null>(null);

  const showChecklist = !hidden && checklistVisible(items, dismissedAt);
  const doneCount = items.filter((i) => i.done).length;
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
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-base">
              Get started{" "}
              <span className="text-sm font-normal text-muted-foreground tabular-nums">
                {doneCount} of {items.length}
              </span>
            </CardTitle>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close checklist"
              disabled={busy !== null}
              onClick={dismiss}
            >
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
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
