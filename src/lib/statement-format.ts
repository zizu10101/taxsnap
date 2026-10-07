// How statement money and dates are written. Pure and import-free, with NO "use client": server
// components (the Statements list) and client components both import from here. They used to live in
// statement-review-line.tsx, a "use client" file, and a server component that imported them from there
// crashed at runtime ("Attempted to call formatDay() from the server but formatDay is on the client").
// A function a server component needs must never live in a "use client" file.

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

/** A plain calendar date ("2026-02-08") in words: "Feb 8, 2026". No timezone shift. */
export function formatDay(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** A saved-at INSTANT as Toronto's calendar day ("Oct 7, 2026"), so it matches what the owner sees. */
export function formatSavedDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Toronto",
  });
}
