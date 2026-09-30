import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/require-admin";
import { getAccountDetail } from "@/lib/admin-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function AdminAccountPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();

  const { id } = await params;
  const detail = await getAccountDetail(id);
  if (!detail) notFound();

  const { profile, receiptCount, invoiceCount, stripeLive, rows } = detail;
  const mismatches = rows.filter((r) => r.mismatch);
  const hasStripeIds = !!(profile.stripe_customer_id || profile.stripe_subscription_id);
  const paidWithoutStripe = !hasStripeIds && profile.subscription_status !== "free";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-muted-foreground hover:underline">
          ← Accounts
        </Link>
        <h2 className="mt-1 font-heading text-lg font-bold">{profile.email}</h2>
        <p className="text-xs text-muted-foreground tabular-nums">{profile.id}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Receipts</p>
            <p className="text-2xl font-bold tabular-nums">{receiptCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Invoices</p>
            <p className="text-2xl font-bold tabular-nums">{invoiceCount}</p>
          </CardContent>
        </Card>
        <Card className="col-span-2 sm:col-span-1">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Joined</p>
            <p className="text-2xl font-bold tabular-nums">
              {new Date(profile.created_at).toLocaleDateString("en-CA", { timeZone: "UTC" })}
            </p>
          </CardContent>
        </Card>
      </div>

      {paidWithoutStripe && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Stored tier is <strong>{profile.subscription_status}</strong> but this account has no Stripe
          customer or subscription ID on file.
        </p>
      )}
      {stripeLive?.error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Stripe lookup failed: {stripeLive.error}. If this is local, STRIPE_SECRET_KEY points at the
          sandbox account, which can&apos;t see production customers.
        </p>
      )}
      {stripeLive && !stripeLive.found && !stripeLive.error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Stripe has no subscription for this customer, but profiles stores{" "}
          <strong>{profile.subscription_status}</strong>
          {profile.stripe_subscription_id ? ` (${profile.stripe_subscription_id})` : ""}.
        </p>
      )}
      {mismatches.length > 0 && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {mismatches.length} field{mismatches.length === 1 ? "" : "s"} differ between profiles and
          Stripe: {mismatches.map((m) => m.field).join(", ")}.
        </p>
      )}
      {stripeLive?.found && mismatches.length === 0 && (
        <p className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
          Profile and Stripe agree.
        </p>
      )}
      {!hasStripeIds && !paidWithoutStripe && (
        <p className="text-sm text-muted-foreground">No Stripe customer on file (free account).</p>
      )}

      {stripeLive?.found && (
        <Card>
          <CardHeader>
            <CardTitle>Stored vs. live Stripe</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Field</th>
                  <th className="py-1.5 pr-3 font-medium">Stored in profiles</th>
                  <th className="py-1.5 font-medium">Live from Stripe</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.field}
                    className={`border-t border-border ${r.mismatch ? "bg-destructive/10 text-destructive" : ""}`}
                  >
                    <td className="py-1.5 pr-3 font-medium">{r.field}</td>
                    <td className="py-1.5 pr-3 break-all tabular-nums">{r.stored}</td>
                    <td className="py-1.5 break-all tabular-nums">{r.live}</td>
                  </tr>
                ))}
                <tr className="border-t border-border text-muted-foreground">
                  <td className="py-1.5 pr-3 font-medium">Stripe status</td>
                  <td className="py-1.5 pr-3">—</td>
                  <td className="py-1.5">{stripeLive.status}</td>
                </tr>
                <tr className="border-t border-border text-muted-foreground">
                  <td className="py-1.5 pr-3 font-medium">Period end</td>
                  <td className="py-1.5 pr-3 tabular-nums">
                    {profile.current_period_end?.slice(0, 10) ?? "—"}
                  </td>
                  <td className="py-1.5 tabular-nums">{stripeLive.currentPeriodEnd?.slice(0, 10) ?? "—"}</td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
