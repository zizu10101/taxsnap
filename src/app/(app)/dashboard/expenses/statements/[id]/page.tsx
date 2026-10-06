import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatementReview } from "@/components/dashboard/statement-review";
import { getStatementPageCtx } from "@/lib/statement-server";
import { loadStatementReview } from "@/lib/statement-review-data";

export const metadata: Metadata = {
  title: "Review statement — TaxSnap",
};

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
  const data = await loadStatementReview(ctx, id);
  if (!data) notFound();
  // Saved, discarded or purged imports have nothing left to review.
  if (data.import.status !== "draft") redirect("/dashboard/expenses");

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
