"use client";

import { Tag } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL_CATEGORIES = "__all__";

// Same shape as JobFilter. The "All Categories" sentinel's label differs from its value, so the
// explicit `items` map is what makes the trigger show its label before the popup is first opened.
export function CategoryFilter({
  categories,
  value,
  onChange,
}: {
  categories: string[];
  value: string | null;
  onChange: (category: string | null) => void;
}) {
  if (categories.length === 0) return null;

  const items: Record<string, string> = { [ALL_CATEGORIES]: "All Categories" };
  for (const c of categories) items[c] = c;

  return (
    <Select
      items={items}
      value={value ?? ALL_CATEGORIES}
      onValueChange={(v) => onChange(v && v !== ALL_CATEGORIES ? v : null)}
    >
      <SelectTrigger className="w-full sm:w-52">
        <Tag className="h-3.5 w-3.5 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_CATEGORIES}>All Categories</SelectItem>
        {categories.map((c) => (
          <SelectItem key={c} value={c}>
            {c}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
