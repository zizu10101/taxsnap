"use client";

import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

// The one search box every list tab uses, so they all look and behave the same. The parent owns
// the text (its own useState - never a default prop of a synced list) and filters data it already
// loaded with searchList() from lib/list-search.ts. The box is a fixed-height row: the clear
// button sits inside it, so typing never moves anything around.
export function ListSearch({
  value,
  onChange,
  placeholder = "Search...",
  label = "Search",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className ?? ""}`}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="text"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            onChange("");
          }
        }}
        className="h-9 pl-8 pr-8"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// "Nothing matches what you typed" - deliberately different from a list's own "nothing here yet"
// empty state, which stays for a list that is actually empty.
export function NoSearchResults({
  query,
  onClear,
}: {
  query: string;
  onClear: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
        <Search className="h-8 w-8" />
        <p className="text-sm">No results for &ldquo;{query.trim()}&rdquo;</p>
        <Button variant="outline" size="sm" onClick={onClear}>
          Clear search
        </Button>
      </CardContent>
    </Card>
  );
}
