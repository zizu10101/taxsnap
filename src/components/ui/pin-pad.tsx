"use client";

import { useEffect, useState } from "react";
import { Delete } from "lucide-react";
import { cn } from "@/lib/utils";

// Shared numeric dial pad for every 4-digit PIN screen in the app (app-lock
// unlock, app-lock Settings setup, stylist payout PIN setup/confirm) - large
// touch targets instead of a plain text `<Input>`, since these screens are
// meant to be used at a front counter, often by someone other than the
// person who typed the last thing into the browser.
//
// Auto-submits on the 4th digit (no separate submit button) and has no
// internal "wrong PIN" state of its own - a caller that needs to clear the
// pad after a rejected PIN (or move from "enter" to "confirm" in a
// set/change flow) does it the same way the rest of this codebase resets
// per-item child state: changing this component's `key` to force a fresh
// mount, rather than adding a resync-from-props effect here.
export function PinPad({
  length = 4,
  onComplete,
  disabled = false,
}: {
  length?: number;
  onComplete: (pin: string) => void;
  disabled?: boolean;
}) {
  const [digits, setDigits] = useState("");

  // Both use the functional setState form exclusively - neither reads
  // `digits` from the render closure at all - so they can never lose a
  // keystroke to a stale closure, even when multiple keydowns land
  // back-to-back in the same tick (found in review: several keydown
  // events dispatched synchronously one after another silently collapsed
  // into a single digit, because the old version computed `digits + digit`
  // from a `digits` snapshot that only refreshed on the next render).
  function pressDigit(digit: string) {
    setDigits((prev) => (disabled || prev.length >= length ? prev : prev + digit));
  }

  function pressBackspace() {
    setDigits((prev) => (disabled || prev.length === 0 ? prev : prev.slice(0, -1)));
  }

  // Reacts to `digits` reaching full length, rather than checking inside
  // pressDigit synchronously (the old approach) - decoupling "append a
  // digit" from "notice we're full and call onComplete" is what lets
  // pressDigit above be a pure functional update with no closure over
  // component state.
  useEffect(() => {
    if (digits.length === length) {
      onComplete(digits);
    }
    // onComplete is a caller-supplied callback, not reactive state this
    // effect needs to resync on - only `digits` reaching `length` should
    // ever (re-)trigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digits, length]);

  // Window-level, not focus-scoped - there's no dedicated focus target on
  // this screen to require tabbing into first (the buttons aren't inputs),
  // and every screen this renders on shows exactly one PinPad at a time,
  // so listening globally while mounted is safe and matches how someone
  // would actually expect a full-screen PIN entry to behave: start typing,
  // it works. Redeps on disabled/length (not digits - pressDigit/
  // pressBackspace no longer read it) so a mid-entry `disabled` flip (e.g.
  // the caller starts verifying) is picked up without needing digits to
  // change first.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        pressDigit(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        pressBackspace();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, length]);

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex gap-3">
        {Array.from({ length }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-3.5 w-3.5 rounded-full border-2 border-primary transition-colors",
              i < digits.length ? "bg-primary" : "bg-transparent",
            )}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
          <button
            key={digit}
            type="button"
            onClick={() => pressDigit(digit)}
            disabled={disabled}
            className="flex h-16 w-16 items-center justify-center rounded-full text-2xl font-semibold text-foreground transition-colors hover:bg-muted active:scale-95 disabled:pointer-events-none disabled:opacity-30"
          >
            {digit}
          </button>
        ))}
        <div />
        <button
          type="button"
          onClick={() => pressDigit("0")}
          disabled={disabled}
          className="flex h-16 w-16 items-center justify-center rounded-full text-2xl font-semibold text-foreground transition-colors hover:bg-muted active:scale-95 disabled:pointer-events-none disabled:opacity-30"
        >
          0
        </button>
        <button
          type="button"
          onClick={pressBackspace}
          disabled={disabled || digits.length === 0}
          aria-label="Backspace"
          className="flex h-16 w-16 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted active:scale-95 disabled:pointer-events-none disabled:opacity-30"
        >
          <Delete className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
