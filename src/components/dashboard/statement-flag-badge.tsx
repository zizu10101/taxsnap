import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { statementExpenseFlag, type FlagInput } from "@/lib/statement-flags";

// "No receipt, needs a tax code" / "Tax calculated from statement" (and the refund variants) on an
// expense a card statement import created. Renders nothing for an ordinary receipt. Red means
// nothing was calculated (no ITC counted); grey means a calculated figure that a receipt can replace.
export function StatementFlagBadge({
  receipt,
  className,
}: {
  receipt: FlagInput;
  className?: string;
}) {
  const flag = statementExpenseFlag(receipt);
  if (!flag) return null;
  return (
    <Badge
      variant={flag.tone === "needs_code" ? "destructive" : "secondary"}
      className={cn("max-w-full", className)}
      title={flag.label}
    >
      <span className="truncate">{flag.label}</span>
    </Badge>
  );
}
