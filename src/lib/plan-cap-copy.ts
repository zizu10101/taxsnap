// Marketing copy for "included on every plan, with a limit" notes, built from
// the real caps in plan-limits.ts so the wording can't drift from what the app
// enforces (e.g. "1 employee on Free, up to 5 on Plus, unlimited on Pro").
// Kept import-free so it can be unit-tested with `node --test`.

export interface TierCaps {
  free: number | null;
  basic: number | null;
  pro: number | null;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

// null = no cap (unlimited). The Free number is stated outright; paid tiers
// read "up to N" (or "unlimited"), matching how the pricing table words them.
export function everyPlanCapNote(noun: string, caps: TierCaps): string {
  const free = caps.free === null ? `unlimited ${noun}s` : count(caps.free, noun);
  const plus = caps.basic === null ? "unlimited" : `up to ${caps.basic}`;
  const pro = caps.pro === null ? "unlimited" : `up to ${caps.pro}`;
  return `Included on every plan: ${free} on Free, ${plus} on Plus, ${pro} on Pro.`;
}
