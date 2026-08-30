"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useAppLock } from "@/components/app-lock/app-lock-context";

// Every commission-suite page renders this independently of
// DashboardHeader's nav and CommissionNav (both already staff-mode-gated) -
// this is the one other clickable path off the Commission Log page, and
// needs the same treatment. Beyond just "staff shouldn't wander off" (the
// original nav-gating goal), clicking this in staff mode used to trigger a
// real navigation to /dashboard followed immediately by AppLockProvider's
// guard replacing it back to /dashboard/commission - two client-side
// navigations to different routes in quick succession, which reliably
// crashes this Next.js version's Turbopack dev server
// ("Cannot read properties of null (reading 'enqueueModel')") if the
// first navigation's RSC stream hadn't finished resolving yet. Rendering
// nothing here removes the only normal way a staff session could trigger
// that double-navigation, rather than just reacting to it after the fact.
export function BackToDashboardLink() {
  const { role } = useAppLock();
  if (role === "staff") return null;

  return (
    <Link
      href="/dashboard"
      className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to dashboard
    </Link>
  );
}
