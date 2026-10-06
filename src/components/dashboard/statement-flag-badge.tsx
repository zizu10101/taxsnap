import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { statementExpenseFlag, type FlagInput } from "@/lib/statement-flags";

// "No receipt, ITC not claimed" (and the refund variants) on an expense a card
// statement import created. Renders nothing for an ordinary receipt.
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
    <Badge variant="destructive" className={cn("max-w-full", className)} title={flag.label}>
      <span className="truncate">{flag.label}</span>
    </Badge>
  );
}
