import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { openRowAriaLabel, type OpenRowKind } from "@/lib/open-row-link";

// A quiet "Open ›" link at the right end of a list row, straight to the full details page.
// Shared by the Invoices, Estimates, Jobs and Clients lists so they look and behave alike.
// The row itself is a role="button" card (click selects the preview, or navigates on mobile), so
// click AND key events stop here - Enter on the link would otherwise bubble to the card's handler.
// `iconOnly` drops the word on tight (mobile) rows; the aria-label carries the name either way.
export function OpenRowLink({
  href,
  kind,
  name,
  iconOnly = false,
  className,
}: {
  href: string;
  kind: OpenRowKind;
  name: string;
  iconOnly?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-label={openRowAriaLabel(kind, name)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className={cn(
        "-mr-1 inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-md px-2 text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {!iconOnly && <span>Open</span>}
      <ChevronRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  );
}
