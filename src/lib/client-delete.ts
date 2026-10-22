// Deleting a client. Pure wording and shapes, shared by the route, the dialogs and the tests.
//
// Why a client with records is never deleted: documents.client_id and jobs.client_id are ON DELETE SET NULL,
// so the database would happily delete the client and leave its invoices, estimates and jobs pointing at nobody
// (the invoice would lose its "Bill to"). The check lives in the route (client-delete-server.ts), not the schema.

export const CLIENT_HAS_RECORDS_CODE = "CLIENT_HAS_RECORDS" as const;

export interface ClientReferenceCounts {
  invoices: number;
  estimates: number;
  jobs: number;
}

export function totalReferences(c: ClientReferenceCounts): number {
  return c.invoices + c.estimates + c.jobs;
}

function plural(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? "" : "s"}`;
}

// "3 invoices and 1 estimate", "2 invoices, 1 estimate and 1 job"; zero counts are left out.
export function describeReferences(c: ClientReferenceCounts): string {
  const parts = [
    c.invoices > 0 ? plural(c.invoices, "invoice") : null,
    c.estimates > 0 ? plural(c.estimates, "estimate") : null,
    c.jobs > 0 ? plural(c.jobs, "job") : null,
  ].filter((p): p is string => p !== null);
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export function blockedMessage(name: string, c: ClientReferenceCounts): string {
  const what = c.jobs > 0 && c.invoices + c.estimates === 0 ? "Remove them from those jobs" : "Delete or reassign those";
  return `${name.trim()} has ${describeReferences(c)}, so it can't be deleted. ${what} first.`;
}
