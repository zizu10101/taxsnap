// State rules for the dashboard's getting-started card: collapsed/expanded (remembered per user
// in the browser, same storage as the "How this works" dropdowns) and what the card shows.
// The permanent "dismissed" flag is separate and still lives on the profile
// (checklist_dismissed_at). Import-light so it can be unit-tested with `node --test`.

import type { StoredChoice } from "./how-this-works.ts";

export function checklistStorageKey(userId: string): string {
  return `taxsnap:getting-started:${userId}`;
}

// "open" = expanded. With no remembered choice the card is expanded (it is the new-user
// guide); once the person collapses it, that choice always wins.
export function resolveChecklistExpanded(stored: StoredChoice | null): boolean {
  return stored !== "closed";
}

export type ChecklistView = "hidden" | "collapsed" | "expanded" | "all-set";

// Dismissed (the old X, or the new Dismiss) hides it for good. All steps done shows the
// "all set" state regardless of collapse. Otherwise the remembered choice decides.
export function checklistView(args: {
  total: number;
  done: number;
  dismissedAt: string | null;
  expanded: boolean;
}): ChecklistView {
  if (args.dismissedAt) return "hidden";
  if (args.total === 0) return "hidden";
  if (args.done >= args.total) return "all-set";
  return args.expanded ? "expanded" : "collapsed";
}

export function checklistSummary(done: number, total: number): string {
  return `Getting started · ${done} of ${total} done`;
}
