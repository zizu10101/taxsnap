import Link from "next/link";
import { requireAdmin } from "@/lib/require-admin";
import { listActions } from "@/lib/admin-data";
import { ActionLogTable } from "@/components/admin/action-log-table";
import { Button } from "@/components/ui/button";

export default async function AdminLogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireAdmin();

  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const { rows, total, pageSize } = await listActions({ page });
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div>
        <Link href="/admin" className="text-sm text-muted-foreground hover:underline">
          ← Accounts
        </Link>
        <h2 className="mt-1 font-heading text-lg font-bold">
          Action log <span className="text-sm font-normal text-muted-foreground">({total})</span>
        </h2>
        <p className="text-xs text-muted-foreground">
          Every manual change and note across all accounts, newest first.
        </p>
      </div>

      <ActionLogTable rows={rows} />

      {lastPage > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page} of {lastPage}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link href={page - 1 > 1 ? `/admin/log?page=${page - 1}` : "/admin/log"} />}
              >
                Previous
              </Button>
            )}
            {page < lastPage && (
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link href={`/admin/log?page=${page + 1}`} />}
              >
                Next
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
