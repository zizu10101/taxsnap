"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// Shared header shape introduced for the Dashboard redesign
// (eyebrow/title/subtitle/actions, border-bottom, same type scale as the
// mockup) - this centralizes it so the rest of /dashboard/** picks up the
// same look by using this instead of a hand-rolled h1/p pair per page.
//
// Two ways to get a back-link, deliberately not unified into one:
// - `backHref` (+ optional `backLabel`) renders a plain Link - fine for
//   Jobs/Employees/Invoices/Estimates/Hours, none of which a salon account
//   in staff mode can ever reach (see nav-config.ts - businessType `salon`
//   never gets those nav items), so there's no double-navigation risk to
//   guard against.
// - `back` takes a ready-made node instead - every other converted page
//   (Expenses, Overview, Progress Billing, the Commission suite, Line
//   Items) passes `<BackToDashboardLink />` here, which renders nothing in
//   staff mode. That guard exists because two rapid client-side
//   navigations to different routes can crash this Next.js version's
//   Turbopack dev server - see that component's own comment. Don't swap
//   these pages to plain `backHref` even though it looks identical outside
//   staff mode.
export function PageHeader({
  eyebrow,
  title,
  titleBadge,
  subtitle,
  actions,
  backHref,
  backLabel = "Back to dashboard",
  back,
}: {
  eyebrow?: string;
  title: string;
  // Inline element next to the title itself (e.g. a status pill) - for
  // when the badge is conceptually part of "what is this record," not a
  // page-level action. Document Detail's status Select is the first user
  // of this (see that component).
  titleBadge?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
  // Alternative to backHref - a ready-made back-link node, for pages that
  // need BackToDashboardLink's staff-mode-aware behavior instead of a
  // plain Link (see the comment above).
  back?: ReactNode;
}) {
  return (
    // No outer margin - the parent's own space-y-* gap handles spacing to
    // whatever comes next, same as every other sibling block on these
    // pages. Adding one here would double up with that gap.
    <div>
      {back}
      {!back && backHref && (
        <Link
          href={backHref}
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {backLabel}
        </Link>
      )}
      <div className="flex flex-col gap-4 border-b pb-4.5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          {eyebrow && (
            <p className="font-mono text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">
              {eyebrow}
            </p>
          )}
          <h1 className="flex flex-wrap items-center gap-2.5 text-3xl font-bold tracking-tight sm:text-[34px]">
            {title}
            {titleBadge}
          </h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
