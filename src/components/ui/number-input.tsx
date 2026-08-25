"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";

// A plain `<Input type="number" value={n} onChange={...}>` bound straight to
// a number forces the box back to "0" the instant it's cleared (parseFloat("")
// is NaN, coerced to 0, which re-renders as "0" before the user can type a
// replacement digit). This keeps its own text buffer so the field can sit
// empty while the caller still gets a plain number for calculations.
export function NumberInput({
  value,
  onValueChange,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: number;
  onValueChange: (value: number) => void;
}) {
  const [text, setText] = useState(value === 0 ? "" : String(value));
  // Adjusting state during render (React's documented pattern for syncing
  // from a prop) rather than in an effect - this only resyncs when `value`
  // actually changes from outside (e.g. this row got reused for a
  // different item after one above it was deleted), not on every render,
  // so it doesn't fight the user's own in-progress typing.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setText(value === 0 ? "" : String(value));
  }

  return (
    <Input
      type="number"
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        onValueChange(parseFloat(raw) || 0);
      }}
      {...props}
    />
  );
}
