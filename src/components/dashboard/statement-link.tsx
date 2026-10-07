"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import { formatDay } from "@/components/dashboard/statement-review-line";
import { statementHref } from "@/lib/statement-routes";
import type { StatementForReceipt } from "@/lib/statement-groups-server";

// In the expense drawer: "From statement: TD, Jan 6 to Feb 5 - View", for an expense a saved card
// statement created or was matched to. Renders nothing for an ordinary receipt, while loading, or
// for anyone the feature is off for (the request is only made when it's enabled). Keyed by the
// expense in the drawer, so it starts fresh for each one.
export function StatementLink({ receiptId, enabled }: { receiptId: string; enabled: boolean }) {
  const [statement, setStatement] = useState<StatementForReceipt | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch(`/api/statements/for-receipt/${receiptId}`)
      .then((res) => (res.ok ? res.json() : { statement: null }))
      .then((data) => {
        if (!cancelled) setStatement((data.statement as StatementForReceipt | null) ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [receiptId, enabled]);

  if (!statement) return null;
  const period =
    statement.period_start && statement.period_end
      ? `${formatDay(statement.period_start)} to ${formatDay(statement.period_end)}`
      : null;
  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
      <FileText className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 truncate">
        From {statement.deleted ? "a deleted statement" : "statement"}: {statement.issuer ?? "card"}
        {period ? `, ${period}` : ""}
      </span>
      <Link href={statementHref(statement.import_id)} className="shrink-0 text-primary underline underline-offset-2">
        View
      </Link>
    </p>
  );
}
