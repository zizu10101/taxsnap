import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// "Automatic (Stripe)" on an expense TaxSnap created from Stripe data (a processing or dispute fee).
// Renders nothing for any other expense. The expense is otherwise ordinary: edit or delete it as usual.
export function AutoExpenseBadge({
  receipt,
  className,
}: {
  receipt: { origin?: string | null };
  className?: string;
}) {
  if (receipt.origin !== "stripe") return null;
  return (
    <Badge variant="outline" className={cn("max-w-full", className)} title="Recorded automatically from Stripe">
      <span className="truncate">Automatic (Stripe)</span>
    </Badge>
  );
}
