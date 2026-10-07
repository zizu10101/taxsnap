import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatementsList } from "@/components/dashboard/statements-list";
import { Button } from "@/components/ui/button";
import { getStatementPageCtx } from "@/lib/statement-server";
import { countDeletedStatements, loadStatementList } from "@/lib/statement-groups-server";
import { STATEMENTS_DELETED_HREF, STATEMENTS_HREF } from "@/lib/statement-routes";

export const metadata: Metadata = {
  title: "Statements — TaxSnap",
};

// Every SAVED card statement: what it created, matched and skipped, and whether it reconciled.
// Allowlist-only like the rest of statement import (anyone else gets a plain 404). Deleted
// statements are hidden unless asked for (?deleted=1). The data is read through the user's own
// session, so it is only ever their own statements.
export default async function StatementsPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  const ctx = await getStatementPageCtx();
  if (!ctx) notFound();

  const { deleted } = await searchParams;
  const showDeleted = deleted === "1";
  const [items, deletedCount] = await Promise.all([
    loadStatementList(ctx.supabase, ctx.user.id, { includeDeleted: showDeleted }),
    countDeletedStatements(ctx.supabase, ctx.user.id),
  ]);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 lg:max-w-none">
      <PageHeader
        backHref="/dashboard/expenses"
        backLabel="Back to expenses"
        title="Statements"
        subtitle="Every card statement you've saved, and what it created."
        actions={
          deletedCount > 0 || showDeleted ? (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={showDeleted ? STATEMENTS_HREF : STATEMENTS_DELETED_HREF} />}
            >
              {showDeleted ? "Hide deleted" : `Show deleted (${deletedCount})`}
            </Button>
          ) : undefined
        }
      />
      <StatementsList items={items} />
    </div>
  );
}
