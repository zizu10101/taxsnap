"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  RANGE_PRESET_LABELS,
  getPresetRange,
  type DateRange,
  type RangePreset,
} from "@/lib/date-range";

const PRESET_ORDER: RangePreset[] = [
  "today",
  "this-week",
  "this-month",
  "last-month",
  "this-quarter",
  "this-year",
  "all-time",
  "custom",
];

export function DateRangeFilter({
  preset,
  range,
  onChange,
}: {
  preset: RangePreset;
  range: DateRange;
  onChange: (preset: RangePreset, range: DateRange) => void;
}) {
  function handlePresetChange(value: string | null) {
    if (!value) return;
    const next = value as RangePreset;
    onChange(next, next === "custom" ? range : getPresetRange(next));
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Select
        items={RANGE_PRESET_LABELS}
        value={preset}
        onValueChange={handlePresetChange}
      >
        <SelectTrigger className="w-full sm:w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRESET_ORDER.map((p) => (
            <SelectItem key={p} value={p}>
              {RANGE_PRESET_LABELS[p]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {preset === "custom" && (
        <div className="flex items-center gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="range-start" className="sr-only">
              Start date
            </Label>
            <Input
              id="range-start"
              type="date"
              value={range.start ?? ""}
              onChange={(e) =>
                onChange(preset, {
                  ...range,
                  start: e.target.value || null,
                })
              }
            />
          </div>
          <span className="text-sm text-muted-foreground">to</span>
          <div className="flex-1 space-y-1">
            <Label htmlFor="range-end" className="sr-only">
              End date
            </Label>
            <Input
              id="range-end"
              type="date"
              value={range.end ?? ""}
              onChange={(e) =>
                onChange(preset, {
                  ...range,
                  end: e.target.value || null,
                })
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
