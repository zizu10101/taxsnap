"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// A selectable card: icon tile on the left (neutral when off, filled when on), bold
// title, one-line subtitle, and a round check indicator on the right. Tapping it
// toggles. Shared by onboarding's goals step and the Customize menu panel so the two
// always look the same.
export function ChoiceCard({
  icon: Icon,
  title,
  description,
  selected,
  onToggle,
  disabled = false,
  size = "default",
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
  // "compact" is the denser one-line version (Customize menu); default is the large goal card.
  size?: "default" | "compact";
  className?: string;
}) {
  const compact = size === "compact";
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "flex w-full items-center rounded-xl border-2 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60",
        compact ? "min-h-0 gap-3 px-3 py-2" : "min-h-20 gap-4 p-4",
        selected ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/50",
        className,
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center",
          compact ? "h-8 w-8 rounded-md" : "h-12 w-12 rounded-lg",
          selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className={compact ? "h-4 w-4" : "h-6 w-6"} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block font-semibold", compact && "truncate text-sm")}>{title}</span>
        <span className={cn("block text-muted-foreground", compact ? "truncate text-xs" : "text-sm")}>{description}</span>
      </span>
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full border-2",
          compact ? "h-5 w-5" : "h-7 w-7",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-border",
        )}
      >
        {selected && <Check className={compact ? "h-3 w-3" : "h-4 w-4"} />}
      </span>
    </button>
  );
}
