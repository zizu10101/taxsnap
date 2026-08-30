export type RangePreset =
  | "today"
  | "this-week"
  | "this-month"
  | "last-month"
  | "this-quarter"
  | "this-year"
  | "all-time"
  | "custom";

export interface DateRange {
  // Inclusive bounds as YYYY-MM-DD strings (matching `receipts.transaction_date`).
  // null means unbounded on that side.
  start: string | null;
  end: string | null;
}

// Local calendar date, not UTC - `date.toISOString().slice(0, 10)` (the
// previous implementation) converts to UTC first, which silently shifts
// the date by one in either direction depending on the time of day and
// the runtime's UTC offset. For a shop in a negative-UTC-offset timezone
// (all of North America), that meant "Today" already rolled over to
// tomorrow's date every evening, well before local midnight - e.g. 8pm EST
// is already past midnight UTC. `getFullYear`/`getMonth`/`getDate` read
// the Date object's local representation directly, so this is correct
// wherever it runs: the shop's own local time in the browser (the
// reasonable stand-in for "shop timezone" this app uses everywhere, since
// it's built for a single physical location), or the server's own local
// time for any SSR-only default that a client-side refetch overwrites
// immediately after.
export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Exclusive upper bound for a date-only range end - e.g. "2026-08-30" ->
// "2026-08-31" - for comparing against a timestamptz column, where a plain
// `<= "2026-08-30"` bound would exclude anything logged later that same
// day. Built entirely from local Date construction/extraction (no UTC
// round-trip anywhere in it), so - unlike the two near-identical
// `nextDayIso` helpers this replaces in the commission-entries/payouts API
// routes - it can't drift by a day depending on the runtime's timezone
// offset either.
export function nextDayIso(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return toIsoDate(new Date(year, month - 1, day + 1));
}

// Converts a shop-local calendar date into the UTC instant of that day's
// local midnight - the correct way to compare a local calendar boundary
// against a `timestamptz` column (commission_entries.created_at,
// payouts.paid_at). A bare "YYYY-MM-DD" string compared directly against a
// timestamptz is implicitly cast in the *database's* session timezone (UTC
// on Supabase), not the shop's local timezone - so "today >= 2026-08-30"
// really means ">= 2026-08-30T00:00:00Z", which for any North American shop
// is several hours before actual local midnight, letting the tail end of
// the previous local day leak into "Today". `new Date(y, m, d, ...)`
// resolves the correct local-to-UTC offset for that specific calendar day
// (DST included), so `.toISOString()` here is the correct use of a UTC
// round-trip - unlike toIsoDate above, which deliberately avoids
// toISOString() because it's extracting a calendar-date *label*, this is
// converting a known-correct local instant into its UTC equivalent for a
// precise timestamp comparison.
export function localDateToUtcInstant(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0).toISOString();
}

// Exclusive upper-bound instant - local midnight at the *start* of the day
// after `dateStr`, for a `< upperBound` comparison against a timestamptz
// column.
export function localDateExclusiveEndUtc(dateStr: string): string {
  return localDateToUtcInstant(nextDayIso(dateStr));
}

// Converts a date-only DateRange (as produced by getPresetRange/the
// DateRangeFilter) into UTC instant bounds ready to send to any API route
// that filters a timestamptz column - see localDateToUtcInstant above for
// why the conversion can't happen server-side (the server has no idea what
// the shop's local offset is).
export function rangeToUtcBounds(range: DateRange): { from: string | null; to: string | null } {
  return {
    from: range.start ? localDateToUtcInstant(range.start) : null,
    to: range.end ? localDateExclusiveEndUtc(range.end) : null,
  };
}

function lastDayOfMonth(year: number, monthIndex: number): Date {
  return new Date(year, monthIndex + 1, 0);
}

// Sunday-start week, matching the en-US locale convention used everywhere
// else in this file's date formatting.
function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - d.getDay());
  return d;
}

export const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
  today: "Today",
  "this-week": "This Week",
  "this-month": "This Month",
  "last-month": "Last Month",
  "this-quarter": "This Quarter",
  "this-year": "This Year",
  "all-time": "All Time",
  custom: "Custom Range",
};

export function getPresetRange(preset: RangePreset): DateRange {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  switch (preset) {
    case "today": {
      const today = toIsoDate(now);
      return { start: today, end: today };
    }
    case "this-week": {
      const start = startOfWeek(now);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      return { start: toIsoDate(start), end: toIsoDate(end) };
    }
    case "this-month":
      return {
        start: toIsoDate(new Date(year, month, 1)),
        end: toIsoDate(lastDayOfMonth(year, month)),
      };
    case "last-month":
      return {
        start: toIsoDate(new Date(year, month - 1, 1)),
        end: toIsoDate(lastDayOfMonth(year, month - 1)),
      };
    case "this-quarter": {
      const quarterStartMonth = Math.floor(month / 3) * 3;
      return {
        start: toIsoDate(new Date(year, quarterStartMonth, 1)),
        end: toIsoDate(lastDayOfMonth(year, quarterStartMonth + 2)),
      };
    }
    case "this-year":
      return {
        start: toIsoDate(new Date(year, 0, 1)),
        end: toIsoDate(new Date(year, 11, 31)),
      };
    case "all-time":
    case "custom":
    default:
      return { start: null, end: null };
  }
}

function formatDateLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function describeRange(preset: RangePreset, range: DateRange): string {
  if (preset === "all-time") return "All Time";
  if (preset === "today" && range.start) return formatDateLabel(range.start);
  if (preset === "this-week" && range.start && range.end) {
    return `${formatDateLabel(range.start)} – ${formatDateLabel(range.end)}`;
  }

  if (preset === "this-month" || preset === "last-month") {
    const iso = range.start ?? toIsoDate(new Date());
    return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  }

  if (preset === "this-quarter" && range.start) {
    const d = new Date(`${range.start}T00:00:00`);
    const quarter = Math.floor(d.getMonth() / 3) + 1;
    return `Q${quarter} ${d.getFullYear()}`;
  }

  if (preset === "this-year" && range.start) {
    return `${new Date(`${range.start}T00:00:00`).getFullYear()}`;
  }

  // Custom range.
  if (range.start && range.end) {
    return `${formatDateLabel(range.start)} – ${formatDateLabel(range.end)}`;
  }
  if (range.start) return `Since ${formatDateLabel(range.start)}`;
  if (range.end) return `Through ${formatDateLabel(range.end)}`;
  return "All Time";
}

export function filterByRange<T>(
  items: T[],
  range: DateRange,
  dateField: keyof T = "transaction_date" as keyof T,
): T[] {
  return items.filter((item) => {
    const value = item[dateField] as unknown as string;
    if (range.start && value < range.start) return false;
    if (range.end && value > range.end) return false;
    return true;
  });
}
