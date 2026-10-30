import { TriangleAlert } from "lucide-react";
import { TRUNCATED_NOTICE } from "@/lib/select-all";

// Shown when a loader hit its 20,000-row safety ceiling (select-all.ts): a user with that many records gets
// the first 20,000 and is told so, instead of totals that are quietly short.
export function TruncationNotice({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
    >
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        <strong>Some totals may be incomplete.</strong> {TRUNCATED_NOTICE.replace("Some totals may be incomplete: ", "")}
      </span>
    </p>
  );
}
