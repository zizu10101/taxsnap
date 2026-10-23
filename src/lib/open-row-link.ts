// Accessible name for the quiet "Open" link on a list row, e.g. "Open invoice INV-1003" or
// "Open client Acme Ltd". Pure so it can be unit-tested with `node --test`.
export type OpenRowKind = "invoice" | "estimate" | "job" | "client";

export function openRowAriaLabel(kind: OpenRowKind, name: string): string {
  const trimmed = name.trim();
  return trimmed ? `Open ${kind} ${trimmed}` : `Open ${kind}`;
}
