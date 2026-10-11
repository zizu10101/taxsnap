"use client";

import { useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { VendorOption } from "@/lib/expenses-report";

// Searchable vendor picker for the Expenses report. An inline panel with a
// search box and a plain scrolling list, not a Select: a vendor list can be
// long, and Base UI's Select hides its scrollbar and aligns the selected item
// over the trigger (see CLAUDE.md, saved-item-picker). No portal either.
// `value` is a vendor key, or "all".
export function VendorFilter({
  options,
  value,
  onChange,
}: {
  options: VendorOption[];
  value: string;
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = options.find((o) => o.key === value);
  const label = value === "all" ? "All vendors" : (selected?.name ?? "Selected vendor");
  const needle = query.trim().toLowerCase();
  const shown = needle ? options.filter((o) => o.name.toLowerCase().includes(needle)) : options;

  function pick(key: string) {
    onChange(key);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="relative max-w-xs">
      <button
        type="button"
        aria-label="Vendor"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border bg-background px-3 text-sm"
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full min-w-[16rem] rounded-lg border bg-card p-2 shadow-md">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search vendors"
              aria-label="Search vendors"
              className="pl-8"
            />
          </div>
          <ul className="mt-2 max-h-60 overflow-y-auto text-sm">
            <li>
              <button
                type="button"
                onClick={() => pick("all")}
                className="w-full rounded-md px-2 py-1.5 text-left hover:bg-muted"
              >
                All vendors
              </button>
            </li>
            {shown.map((o) => (
              <li key={o.key}>
                <button
                  type="button"
                  onClick={() => pick(o.key)}
                  className={`w-full rounded-md px-2 py-1.5 text-left hover:bg-muted ${
                    o.key === value ? "font-semibold text-primary" : ""
                  }`}
                >
                  {o.name}
                </button>
              </li>
            ))}
            {shown.length === 0 && (
              <li className="px-2 py-1.5 text-muted-foreground">No vendor matches.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
