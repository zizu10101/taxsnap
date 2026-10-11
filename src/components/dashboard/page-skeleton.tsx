import type { ReactNode } from "react";
import { PageHeader } from "@/components/dashboard/page-header";
import { BackToDashboardLink } from "@/components/dashboard/back-to-dashboard-link";
import { Skeleton } from "@/components/ui/skeleton";

// Light placeholder shown by each tab's loading.tsx while the server page
// streams in. It renders the page's REAL PageHeader (same title, subtitle and
// back link as the page) inside the same wrapper classes, so the header does
// not move when the page arrives; only the body below it is grey blocks.
//
// variant:
//  - "list":   a search/filter bar, then a stack of rows (Invoices, Estimates,
//              Jobs, Clients, Employees, Hours, Expenses)
//  - "cards":  a row of figure cards, then rows (Home, Reports)
//  - "grid":   a grid of tap-target tiles (Register)
export function PageSkeleton({
  title,
  subtitle,
  variant = "list",
  back = "link",
  narrow = false,
  actions,
}: {
  title: string;
  subtitle: ReactNode;
  variant?: "list" | "cards" | "grid";
  // "link" = BackToDashboardLink (Expenses, Overview, Register); "plain" =
  // the plain /dashboard Link the list pages use.
  back?: "link" | "plain";
  // Register keeps the mobile reading width at every size.
  narrow?: boolean;
  actions?: ReactNode;
}) {
  return (
    <div
      className={
        narrow
          ? "mx-auto w-full max-w-2xl space-y-6"
          : "mx-auto w-full max-w-2xl space-y-6 lg:max-w-none"
      }
      role="status"
      aria-label={`Loading ${title}`}
    >
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={actions}
        {...(back === "link"
          ? { back: <BackToDashboardLink /> }
          : { backHref: "/dashboard" })}
      />

      {variant === "cards" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      )}

      {variant === "grid" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <Skeleton className="h-9 flex-1" />
            <Skeleton className="h-9 w-28" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Detail / form pages (an invoice, a job, New invoice...): a back link, a title
// bar and a couple of blocks. Generic on purpose - these pages differ too much
// to mimic one by one.
export function DetailSkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-2xl space-y-6 lg:max-w-none"
      role="status"
      aria-label="Loading"
    >
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-56 rounded-xl" />
    </div>
  );
}
