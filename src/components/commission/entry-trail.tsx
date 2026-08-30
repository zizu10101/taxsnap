import { Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";

// Shared strikethrough-original/current rendering for any field a
// commission entry edit can touch (service name, stylist name, price) -
// used anywhere an edited entry displays (staff Today's entries, owner
// Reports), per the same original_*/edited_at columns
// (0018_commission_entry_edits.sql). Renders just `current` with no
// strikethrough when there's nothing to compare against (never edited) or
// this particular field didn't change - a stylist-only correction, for
// instance, leaves the service name/price display unchanged even though
// the entry as a whole was edited.
export function FieldTrail({
  original,
  current,
}: {
  original: string | null;
  current: string;
}) {
  if (!original || original === current) return <>{current}</>;
  return (
    <>
      <span className="text-muted-foreground line-through">{original}</span> {current}
    </>
  );
}

export function PriceTrail({
  original,
  current,
  format,
}: {
  original: number | null;
  current: number;
  format: (amount: number) => string;
}) {
  if (original == null || original === current) return <>{format(current)}</>;
  return (
    <>
      <span className="text-muted-foreground line-through">{format(original)}</span>{" "}
      {format(current)}
    </>
  );
}

// One marker per row, shown once regardless of how many individual fields
// above actually changed - distinguishes "this entry has a trail" from
// having to notice a strikethrough buried in the text.
export function EditedBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={`h-4 gap-1 px-1 text-[10px] font-normal text-muted-foreground ${className ?? ""}`}
    >
      <Pencil className="h-2.5 w-2.5" />
      Edited
    </Badge>
  );
}
