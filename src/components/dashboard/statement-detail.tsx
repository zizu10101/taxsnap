"use client";

import { useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteStatementDialog } from "@/components/dashboard/delete-statement-dialog";
import { formatDay, formatMoney, formatSavedDate } from "@/lib/statement-format";
import { expenseHref } from "@/lib/statement-routes";
import type { DetailLine, StatementDetail } from "@/lib/statement-groups-server";
import type { LineOutcome } from "@/lib/statement-summary";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// The order the groups appear in, and how each outcome is described.
const GROUPS: { outcomes: LineOutcome[]; title: string; help: string }[] = [
  { outcomes: ["new_expense"], title: "New expenses", help: "Saved as expenses. Click one to open it." },
  { outcomes: ["matched"], title: "Matched to your receipts", help: "Linked to a receipt you already had; nothing new was created." },
  {
    outcomes: ["expense_deleted", "match_removed"],
    title: "Expense deleted",
    help: "Saved earlier, since deleted. These can be brought back by re-importing the statement.",
  },
  { outcomes: ["excluded"], title: "Not saved", help: "Excluded when the statement was saved (or freed before this history was kept)." },
  { outcomes: ["payment"], title: "Payments to the card", help: "Not expenses." },
];

function LineRow({ line }: { line: DetailLine }) {
  return (
    <li className="flex items-start justify-between gap-3 border-b py-2.5 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{line.description}</p>
        <p className="text-xs text-muted-foreground">{formatDay(line.txn_date)}</p>
        {line.receipt && (
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
            <Link
              href={expenseHref(line.receipt.id)}
              className="text-primary underline underline-offset-2"
            >
              {line.outcome === "matched" ? "Open the receipt" : "Open the expense"}: {line.receipt.merchant_name}
            </Link>
            <Badge variant={line.receipt.has_receipt ? "secondary" : "outline"}>
              {line.receipt.has_receipt ? "Receipt attached" : "No receipt yet"}
            </Badge>
          </p>
        )}
        {(line.outcome === "expense_deleted" || line.outcome === "match_removed") && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {line.outcome === "expense_deleted" ? "The expense was deleted." : "The matched receipt was deleted."}
          </p>
        )}
      </div>
      <span className={`shrink-0 text-sm font-semibold tabular-nums ${line.amount < 0 ? "text-success" : ""}`}>
        {formatMoney(line.amount)}
      </span>
    </li>
  );
}

// A saved statement: its figures and reconcile status, and its transactions grouped by what became
// of them, each linking to its expense. Read-only except for "Delete statement", which always
// previews first and is never automatic. To re-import a statement, upload the file again from
// Expenses: the refusal then offers it.
export function StatementDetailView({ detail }: { detail: StatementDetail }) {
  const [deleting, setDeleting] = useState(false);
  const s = detail.summary;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">
              {detail.issuer ?? "Card statement"} · {detail.account_name}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {detail.period_start && detail.period_end
                ? `${formatDay(detail.period_start)} to ${formatDay(detail.period_end)} · `
                : ""}
              saved {formatSavedDate(detail.saved_at)}
            </p>
          </div>
          {!detail.deleted && (
            <Button variant="outline" size="sm" onClick={() => setDeleting(true)}>
              <Trash2 className="h-4 w-4" />
              Delete statement
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={detail.reconcile.tone === "ok" ? "secondary" : detail.reconcile.tone === "warn" ? "destructive" : "outline"}>
              {detail.reconcile.label}
            </Badge>
            {detail.deleted && <Badge variant="outline">Deleted</Badge>}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
            {detail.opening_balance !== null && (
              <div>
                <dt className="text-muted-foreground">Opening balance</dt>
                <dd className="tabular-nums">{formatMoney(detail.opening_balance)}</dd>
              </div>
            )}
            {detail.closing_balance !== null && (
              <div>
                <dt className="text-muted-foreground">Closing balance</dt>
                <dd className="tabular-nums">{formatMoney(detail.closing_balance)}</dd>
              </div>
            )}
            {detail.statement_total !== null && (
              <div>
                <dt className="text-muted-foreground">Statement total</dt>
                <dd className="tabular-nums">{formatMoney(detail.statement_total)}</dd>
              </div>
            )}
            <div>
              <dt className="text-muted-foreground">Lines</dt>
              <dd className="tabular-nums">{s.lines}</dd>
            </div>
          </dl>
          <p className="text-xs">
            {plural(s.created, "expense")} created
            {s.created_remaining < s.created && (
              <span className="text-muted-foreground"> ({s.created_remaining} still exist)</span>
            )}
            <span className="text-muted-foreground">
              {" "}
              · {s.matched} matched · {s.skipped} skipped
            </span>
          </p>
        </CardContent>
      </Card>

      {GROUPS.map((g) => {
        const lines = detail.lines.filter((l) => g.outcomes.includes(l.outcome));
        if (lines.length === 0) return null;
        return (
          <section key={g.title} className="space-y-2">
            <div>
              <h2 className="text-base font-semibold">
                {g.title} <span className="text-sm font-normal text-muted-foreground">({lines.length})</span>
              </h2>
              <p className="text-xs text-muted-foreground">{g.help}</p>
            </div>
            <ul className="rounded-lg border px-3">
              {lines.map((l) => (
                <LineRow key={l.id} line={l} />
              ))}
            </ul>
          </section>
        );
      })}

      {deleting && <DeleteStatementDialog importId={detail.id} onClose={() => setDeleting(false)} />}
    </div>
  );
}
