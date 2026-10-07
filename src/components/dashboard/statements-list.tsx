import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDay, formatSavedDate } from "@/lib/statement-format";
import { statementHref } from "@/lib/statement-routes";
import type { StatementListItem } from "@/lib/statement-groups-server";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Every saved statement: its card, period, when it was saved, what it created / matched / skipped,
// and whether it reconciled. A server component with plain links, so it can move under another tab
// (the Bank tab, later) without change. An acknowledged difference is NEVER shown as "reconciled".
export function StatementsList({ items }: { items: StatementListItem[] }) {
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No saved statements yet. Import one from the Expenses page.
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((s) => {
        const { summary } = s;
        return (
          <li key={s.id}>
            <Link href={statementHref(s.id)} className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Card className={s.deleted ? "opacity-70" : "hover:bg-muted/40"}>
                <CardContent className="flex items-center justify-between gap-3 py-4">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate font-medium">
                      {s.issuer ?? "Card statement"} · {s.account_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {s.period_start && s.period_end
                        ? `${formatDay(s.period_start)} to ${formatDay(s.period_end)} · `
                        : ""}
                      saved {formatSavedDate(s.saved_at)}
                    </p>
                    <p className="text-xs">
                      {plural(summary.created, "expense")} created
                      {summary.created_remaining < summary.created && (
                        <span className="text-muted-foreground"> ({summary.created_remaining} still exist)</span>
                      )}
                      <span className="text-muted-foreground">
                        {" "}
                        · {summary.matched} matched · {summary.skipped} skipped
                      </span>
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <Badge variant={s.reconcile.tone === "ok" ? "secondary" : s.reconcile.tone === "warn" ? "destructive" : "outline"}>
                        {s.reconcile.label}
                      </Badge>
                      {s.deleted && <Badge variant="outline">Deleted</Badge>}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
