import type { DocumentStatus } from "./database.types";

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Recomputes a document's status from its payment total rather than
// trusting the client - a deposit only ever brings it to "partial", and
// it only reaches "paid" once payments cover the full total. Shared by
// every route that inserts a payment (single-document and, since the
// contract-level bulk allocator, multi-document at once).
export function statusFromPaid(paid: number, total: number): DocumentStatus {
  if (paid <= 0) return "sent";
  if (paid >= total) return "paid";
  return "partial";
}
