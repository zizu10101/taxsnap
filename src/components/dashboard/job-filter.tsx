"use client";

import { Briefcase } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL_JOBS = "__all__";

export function JobFilter({
  jobs,
  value,
  onChange,
}: {
  jobs: string[];
  value: string | null;
  onChange: (job: string | null) => void;
}) {
  if (jobs.length === 0) return null;

  // "All Jobs" is a sentinel value whose displayed label doesn't match its
  // value, which Base UI's Select can't resolve to a label before the popup
  // has ever been opened - pass an explicit items map so it always shows
  // the right label immediately (see the date range filter for the same fix).
  const items: Record<string, string> = { [ALL_JOBS]: "All Jobs" };
  for (const job of jobs) items[job] = job;

  return (
    <Select
      items={items}
      value={value ?? ALL_JOBS}
      onValueChange={(v) => onChange(v && v !== ALL_JOBS ? v : null)}
    >
      <SelectTrigger className="w-full sm:w-52">
        <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_JOBS}>All Jobs</SelectItem>
        {jobs.map((job) => (
          <SelectItem key={job} value={job}>
            {job}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
