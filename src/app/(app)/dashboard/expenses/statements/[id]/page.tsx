import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatementReview } from "@/components/dashboard/statement-review";
import { getStatementPageCtx, loadOwnImport } from "@/lib/statement-server";
import { loadStatementReview } from "@/lib/statement-review-data";
import { loadStatementDetail } from "@/lib/statement-groups-server";
import { StatementDetailView } from "@/components/dashboard/statement-detail";
import { STATEMENTS_HREF } from "@/lib/statement-routes";
import { logTiming, shortId, stopwatch } from "@/lib/statement-timing";

export const metadata: Metadata = {
  title: "Review statement — TaxSnap",
};

// A draft is the review screen. A SAVED statement (or one deleted since) is its read-only detail:
// the transactions grouped by outcome, each linking to its expense, plus Delete statement.
//
// Allowlist-only (see lib/statement-config.ts): anyone else gets a plain 404, as
// if the page didn't exist. The data is loaded on the server through the user's
// own session, so what renders is only ever their own import.
export default async function StatementReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getStatementPageCtx();
  if (!ctx) notFound();

  const { id } = await params;
  const imp = await loadOwnImport(ctx, id);
  if (!imp) notFound();

  if (imp.status !== "draft") {
    const detail = await loadStatementDetail(ctx.supabase, ctx.user.id, id);
    // An abandoned or purged draft has nothing to show.
    if (!detail) redirect("/dashboard/expenses");
    return (
      <div className="mx-auto w-full max-w-2xl space-y-6 lg:max-w-none">
        <PageHeader
          backHref={STATEMENTS_HREF}
          backLabel="Back to statements"
          title={detail.issuer ?? "Card statement"}
          subtitle={detail.deleted ? "This statement was deleted." : "A saved statement."}
        />
        <StatementDetailView detail={detail} />
      </div>
    );
  }

  // First paint of the review screen: timed like every reload (trigger: "page"), re-match included.
  const timer = stopwatch();
  const data = await loadStatementReview(ctx, id, timer);
  if (!data) notFound();
  logTiming("review-load", {
    import: shortId(id),
    trigger: "page",
    started_at: timer.startedAt(),
    finished_at: new Date().toISOString(),
    lines: data.lines.length,
    ...timer.snapshot(),
  });

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 lg:max-w-none">
      <PageHeader
        backHref="/dashboard/expenses"
        backLabel="Back to expenses"
        title="Review statement"
        subtitle="Nothing is saved until you press Save at the bottom."
      />
      <StatementReview initial={data} />
    </div>
  );
}
