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

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
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
