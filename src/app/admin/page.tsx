import Link from "next/link";
import { requireAdmin } from "@/lib/require-admin";
import { getMetrics, listAccounts } from "@/lib/admin-data";
import { SignupsChart } from "@/components/admin/signups-chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "UTC" });
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requireAdmin();

  const { q = "", page: pageParam } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);

  const [metrics, accounts] = await Promise.all([getMetrics(), listAccounts(q, page)]);
  const lastPage = Math.max(1, Math.ceil(accounts.total / accounts.pageSize));

  function pageHref(p: number) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/admin?${qs}` : "/admin";
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Total accounts</p>
              <p className="text-2xl font-bold tabular-nums">{metrics.total}</p>
            </CardContent>
          </Card>
          {(["free", "basic", "pro"] as const).map((tier) => (
            <Card key={tier}>
              <CardContent className="pt-4">
                <p className="text-xs capitalize text-muted-foreground">{tier}</p>
                <p className="text-2xl font-bold tabular-nums">{metrics.byTier[tier]}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Signups, last 30 days ({metrics.signupsLast30})</CardTitle>
            </CardHeader>
            <CardContent>
              <SignupsChart buckets={metrics.signups} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>By business type</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {(["general", "salon"] as const).map((type) => (
                <div key={type} className="flex items-center justify-between">
                  <span className="capitalize">{type}</span>
                  <span className="font-bold tabular-nums">{metrics.byBusinessType[type]}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-heading text-lg font-bold">
            Accounts <span className="text-sm font-normal text-muted-foreground">({accounts.total})</span>
          </h2>
          <form action="/admin" className="flex gap-2">
            <Input
              name="q"
              defaultValue={q}
              placeholder="Search email…"
              className="w-56"
              aria-label="Search accounts by email"
            />
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Tier</th>
                <th className="px-3 py-2 font-medium">Interval</th>
                <th className="px-3 py-2 font-medium">Joined</th>
                <th className="px-3 py-2 font-medium">Stripe</th>
              </tr>
            </thead>
            <tbody>
              {accounts.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                    No accounts match.
                  </td>
                </tr>
              )}
              {accounts.rows.map((a) => {
                // A paid tier with no Stripe customer is the sync gap this
                // page exists to surface - flag it rather than a bare "No".
                const gap = !a.stripeSynced && a.subscription_status !== "free";
                return (
                  <tr key={a.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                    <td className="px-3 py-2">
                      <Link href={`/admin/accounts/${a.id}`} className="font-medium underline-offset-2 hover:underline">
                        {a.email}
                      </Link>
                    </td>
                    <td className="px-3 py-2 capitalize">{a.business_type}</td>
                    <td className="px-3 py-2 capitalize">{a.subscription_status}</td>
                    <td className="px-3 py-2 capitalize">{a.billing_interval ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{formatDate(a.created_at)}</td>
                    <td className={`px-3 py-2 ${gap ? "font-medium text-destructive" : ""}`}>
                      {a.stripeSynced ? "Synced" : gap ? "Missing" : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {lastPage > 1 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Page {page} of {lastPage}
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Button variant="outline" nativeButton={false} render={<Link href={pageHref(page - 1)} />}>
                  Previous
                </Button>
              )}
              {page < lastPage && (
                <Button variant="outline" nativeButton={false} render={<Link href={pageHref(page + 1)} />}>
                  Next
                </Button>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
