// Rules for deleting a job. A job is a label other records point at, so deleting it must never take
// those records with it: invoices, estimates, expenses and expense templates are UNLINKED (their
// job_id becomes null - the foreign keys are `on delete set null`). What can't be unlinked or
// would be lost blocks the delete until the owner has dealt with it:
//   * progress draws and change orders (the contract history; change orders would even cascade),
//   * any linked document with a payment (revenue / HST records),
//   * logged hours and clock sessions (hour_entries.job_id / time_sessions.job_id are NOT NULL with
//     `on delete restrict`, so the database refuses too - unlinking them would need a schema change).
// Pure, so the rules are tested; the route supplies the counts.

export interface JobDeleteFacts {
  draws: number;
  changeOrders: number;
  documentsWithPayments: number;
  hourEntries: number;
  timeSessions: number;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

// null = free to delete, otherwise one message naming everything in the way.
export function jobDeleteBlocker(f: JobDeleteFacts): string | null {
  const reasons: string[] = [];
  const fixes: string[] = [];
  if (f.draws > 0) {
    reasons.push(plural(f.draws, "progress billing draw"));
    fixes.push("delete the progress billing draws");
  }
  if (f.changeOrders > 0) {
    reasons.push(plural(f.changeOrders, "change order"));
    fixes.push("delete the change orders");
  }
  if (f.documentsWithPayments > 0) {
    reasons.push(`${plural(f.documentsWithPayments, "invoice or estimate", "invoices or estimates")} with payments recorded`);
    fixes.push("remove those payments");
  }
  const hours = f.hourEntries + f.timeSessions;
  if (hours > 0) {
    reasons.push(plural(hours, "hours or clock-in record"));
    fixes.push("remove the hours");
  }
  if (reasons.length === 0) return null;
  // The hint names only what is actually in the way, never a blocker the job doesn't have.
  return `This job can't be deleted yet: it has ${reasons.join(", ")}. Deal with those first (${fixes.join(", ")}), then delete the job.`;
}

export interface UnlinkCounts {
  documents: number;
  expenses: number;
  templates: number;
}

// "3 invoices/estimates and 2 expenses", or "" when nothing is linked.
export function unlinkSummary(c: UnlinkCounts): string {
  const parts: string[] = [];
  if (c.documents > 0) parts.push(plural(c.documents, "invoice/estimate", "invoices/estimates"));
  if (c.expenses > 0) parts.push(plural(c.expenses, "expense"));
  if (c.templates > 0) parts.push(plural(c.templates, "recurring expense template"));
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export function deleteConfirmText(c: UnlinkCounts): string {
  const list = unlinkSummary(c);
  return list
    ? `${list} linked to this job will be kept and unlinked from it - nothing else is deleted. This can't be undone.`
    : "Nothing is linked to this job. This can't be undone.";
}
