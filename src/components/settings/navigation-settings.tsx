"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PanelLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { HideableNavKey } from "@/components/dashboard/nav-config";

export interface NavSettingsRow {
  key: HideableNavKey;
  label: string;
  // Records behind this tab (invoices, jobs, ...). 0 for the tabs that are
  // views over other data (Overview, Reports) and so have nothing of their own.
  recordCount: number;
  // What the records are called in the confirmation note ("invoices").
  recordNoun: string;
}

// Per-tab "Hide from my menu" switches. Cosmetic only: it tidies this owner's
// own sidebar / bottom bar and changes nothing about access, permissions or the
// records themselves. Hiding a tab that still has records behind it asks first
// ("this still has data, hide anyway?") instead of silently tucking real
// records out of sight; un-hiding, and hiding an empty tab, are immediate.
export function NavigationSettings({
  rows,
  initialHidden,
}: {
  rows: NavSettingsRow[];
  initialHidden: HideableNavKey[];
}) {
  const router = useRouter();
  const [hidden, setHidden] = useState<Set<HideableNavKey>>(new Set(initialHidden));
  // The tab whose "this still has data" note is showing, waiting on a decision.
  const [confirming, setConfirming] = useState<HideableNavKey | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(next: Set<HideableNavKey>) {
    setBusy(true);
    try {
      const res = await fetch("/api/profile/nav", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden_nav_keys: [...next] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't save that.");
      setHidden(next);
      setConfirming(null);
      // Re-runs the dashboard layout, which is what builds the menu.
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function toggle(row: NavSettingsRow, wantHidden: boolean) {
    if (!wantHidden) {
      const next = new Set(hidden);
      next.delete(row.key);
      setConfirming(null);
      save(next);
      return;
    }
    if (row.recordCount > 0) {
      // Real records behind it - ask before hiding, don't just do it.
      setConfirming(row.key);
      return;
    }
    save(new Set(hidden).add(row.key));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PanelLeft className="h-4 w-4" />
          Navigation
        </CardTitle>
        <CardDescription>
          Hide tabs you don&apos;t use from your sidebar and bottom bar. This only tidies your menu:
          nothing is deleted or turned off, your plan doesn&apos;t change, and you can still open any
          page from a link or from inside the app.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="divide-y rounded-lg border">
          <li className="flex items-center justify-between gap-3 p-2.5 text-sm">
            <span className="font-medium">Dashboard</span>
            <span className="text-xs text-muted-foreground">Always shown</span>
          </li>
          {rows.map((row) => (
            <li key={row.key} className="space-y-2 p-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-sm font-medium">{row.label}</span>
                  {row.recordCount > 0 && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {row.recordCount} {row.recordNoun}
                    </span>
                  )}
                </div>
                <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  Hide
                  <Switch
                    aria-label={`Hide ${row.label} from my menu`}
                    checked={hidden.has(row.key) || confirming === row.key}
                    disabled={busy}
                    onCheckedChange={(checked) => toggle(row, checked)}
                  />
                </label>
              </div>

              {confirming === row.key && (
                <div
                  role="alert"
                  className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-2.5 text-xs"
                >
                  <p>
                    <span className="font-semibold">
                      {row.label} still has data ({row.recordCount} {row.recordNoun}).
                    </span>{" "}
                    Hiding it only removes the tab from your menu. Nothing is deleted, and you can
                    show it again here any time. Hide anyway?
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => save(new Set(hidden).add(row.key))}
                    >
                      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Hide anyway
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setConfirming(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>

        {hidden.size > 0 && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => save(new Set())}>
            Show all tabs
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
