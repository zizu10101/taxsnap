"use client";

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { isCustomUnit, OTHER_UNIT, UNIT_MAX_LENGTH, UNIT_PRESETS, unitSelectValue } from "@/lib/line-format";

const NO_UNIT = "__no_unit__";

export interface LineFieldsValue {
  name: string;
  description: string;
  /** "" = no unit. A preset, or the owner's own text ("other"). */
  unit: string;
  quantity: number;
  unit_price: number;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

/**
 * The unit picker: no unit (the default), the presets, or "Other..." which shows a text box. The
 * Select gets an `items` map because the sentinel values ("No unit", "Other...") differ from their labels.
 */
export function UnitSelect({
  unit,
  onChange,
  id,
  className,
}: {
  unit: string;
  onChange: (unit: string) => void;
  id?: string;
  className?: string;
}) {
  // "Other" with nothing typed yet can't be told from "no unit" by the value alone, so it is kept here.
  const [otherMode, setOtherMode] = useState(isCustomUnit(unit));
  const items = useMemo(() => {
    const map: Record<string, string> = { [NO_UNIT]: "No unit", [OTHER_UNIT]: "Other..." };
    for (const u of UNIT_PRESETS) map[u] = u;
    return map;
  }, []);
  const selectValue = otherMode ? OTHER_UNIT : unitSelectValue(unit) || NO_UNIT;

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Select
        items={items}
        value={selectValue}
        onValueChange={(v) => {
          if (!v) return;
          if (v === OTHER_UNIT) {
            setOtherMode(true);
            if (!isCustomUnit(unit)) onChange("");
            return;
          }
          setOtherMode(false);
          onChange(v === NO_UNIT ? "" : v);
        }}
      >
        <SelectTrigger id={id} className="w-28" aria-label="Unit">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_UNIT}>No unit</SelectItem>
          {UNIT_PRESETS.map((u) => (
            <SelectItem key={u} value={u}>
              {u}
            </SelectItem>
          ))}
          <SelectItem value={OTHER_UNIT}>Other...</SelectItem>
        </SelectContent>
      </Select>
      {otherMode && (
        <Input
          aria-label="Custom unit"
          placeholder="Unit"
          maxLength={UNIT_MAX_LENGTH}
          className="w-24"
          value={unit}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

/**
 * One line of an estimate / invoice in the builder and the editor: a NAME, an optional longer
 * DESCRIPTION, then quantity, unit, price and the line total. The save-for-next-time checkbox stays
 * with the caller (it needs the caller's own draft shape).
 */
export function LineItemFields({
  index,
  value,
  onChange,
  onRemove,
  totalClassName,
}: {
  /** Position in the form; the quantity field carries it so a picked saved item can focus it. */
  index: number;
  value: LineFieldsValue;
  onChange: (patch: Partial<LineFieldsValue>) => void;
  onRemove: () => void;
  totalClassName?: string;
}) {
  const lineTotal = (Number(value.quantity) || 0) * (Number(value.unit_price) || 0);
  return (
    <>
      <div className="flex items-center gap-2">
        <Input
          placeholder="Name (e.g. Potlights)"
          aria-label="Line name"
          className="flex-1 font-semibold"
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          title="Remove line item"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <textarea
        rows={1}
        placeholder="Description (optional)"
        aria-label="Line description"
        className="field-sizing-content min-h-8 w-full resize-none rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        value={value.description}
        onChange={(e) => onChange({ description: e.target.value })}
      />
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <NumberInput
          placeholder="Qty"
          className="w-16"
          data-line-qty={index}
          value={value.quantity}
          onValueChange={(quantity) => onChange({ quantity })}
        />
        <UnitSelect unit={value.unit} onChange={(unit) => onChange({ unit })} />
        <span className="text-muted-foreground">×</span>
        <NumberInput
          placeholder="Price"
          className="w-24"
          value={value.unit_price}
          onValueChange={(unit_price) => onChange({ unit_price })}
        />
        <span className="text-muted-foreground">=</span>
        <span className={cn("ml-auto shrink-0 font-semibold tabular-nums", totalClassName)}>
          {formatCurrency(lineTotal)}
        </span>
      </div>
    </>
  );
}
