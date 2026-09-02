"use client";

import Link from "next/link";
import { Briefcase, ClipboardList, FileText, LogOut, Scissors, Settings, ShieldOff } from "lucide-react";
import { signOut } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAppLock } from "@/components/app-lock/app-lock-context";
import { LogoImage } from "@/components/invoices/business-logo";
import type { BusinessType, SubscriptionStatus } from "@/lib/database.types";

const TIER_LABEL: Record<SubscriptionStatus, string> = {
  free: "Free",
  basic: "Basic",
  pro: "Pro",
};

export function DashboardHeader({
  email,
  subscriptionStatus,
  businessType,
  logoPath,
  active,
}: {
  email: string;
  subscriptionStatus: SubscriptionStatus;
  businessType: BusinessType;
  // profiles.logo_url - null on every page until a caller opts in. When
  // set, it replaces the TaxSnap icon/wordmark below with the business's
  // own logo (any tier - logo upload itself isn't Pro-gated, see
  // api/profile/logo/route.ts) with a small "Powered by TaxSnap" line
  // underneath, keeping the brand attributed without crowding it out.
  logoPath: string | null;
  active?: "estimates" | "invoices" | "jobs" | "commission";
}) {
  const { role, exitStaffMode } = useAppLock();
  const isStaffMode = role === "staff";

  return (
    <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-4 py-3">
        <Link
          href={isStaffMode ? "/dashboard/commission" : "/dashboard"}
          className="flex items-center gap-2 font-semibold"
        >
          {logoPath ? (
            <LogoImage
              key={logoPath}
              path={logoPath}
              className="h-8 w-8 shrink-0 rounded-md object-contain"
            />
          ) : (
            <img src="/logo-mark.png" alt="" className="h-8 w-8 shrink-0" />
          )}
          <span className="flex min-w-0 flex-col leading-tight">
            {logoPath ? (
              <span className="text-xs font-normal text-muted-foreground">
                Powered by TaxSnap
              </span>
            ) : (
              "TaxSnap"
            )}
            <span className="max-w-[160px] truncate text-xs font-normal text-muted-foreground">
              {isStaffMode ? "Staff mode" : email}
            </span>
          </span>
        </Link>
        <div className="flex items-center gap-1">
          {isStaffMode ? (
            <Button variant="outline" size="sm" onClick={exitStaffMode}>
              <ShieldOff className="h-4 w-4" />
              Exit staff mode
            </Button>
          ) : (
            <>
              {/* Persistent upgrade entry point for free/basic - previously
                  the only way to discover /billing was to hit a locked
                  feature and get bounced there. Pro has nothing left to
                  upgrade to, so it keeps the plain tier badge instead. */}
              {subscriptionStatus === "pro" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  nativeButton={false}
                  render={<Link href="/billing" />}
                >
                  <Badge variant="outline" className="mr-1">
                    {TIER_LABEL[subscriptionStatus]}
                  </Badge>
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-primary text-primary hover:bg-primary/10"
                  nativeButton={false}
                  render={<Link href="/billing" />}
                >
                  Upgrade
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                title="Settings"
                nativeButton={false}
                render={<Link href="/dashboard/settings" />}
              >
                <Settings className="h-4 w-4" />
              </Button>
              <form action={signOut}>
                <Button variant="ghost" size="icon" title="Sign out" type="submit">
                  <LogOut className="h-4 w-4" />
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
      {/* Staff mode is only ever navigable to the Commission Log page, so
          the tab row (which links to everything else) is hidden outright
          rather than left visible-but-blocked. The row itself now renders
          for a free-tier salon account too - Commission gives Free a
          capped preview (see lib/free-tier-limits.ts), unlike
          Estimates/Invoices/Jobs, which stay Pro-only and are individually
          hidden below rather than gating the whole row. Estimates is
          additionally hidden for every salon account regardless of tier -
          it doesn't apply to that business type (see
          dashboard/estimates/layout.tsx for the matching route-level
          block). */}
      {!isStaffMode && (subscriptionStatus === "pro" || businessType === "salon") && (
        <nav className="border-t bg-background">
          <div className="mx-auto flex max-w-2xl gap-2 px-4 py-2">
            {subscriptionStatus === "pro" && (
              <>
                {businessType !== "salon" && (
                  <Button
                    variant={active === "estimates" ? "default" : "outline"}
                    size="sm"
                    className="flex-1 justify-center gap-1.5 hover:bg-primary/10 hover:text-primary"
                    nativeButton={false}
                    render={<Link href="/dashboard/estimates" />}
                  >
                    <ClipboardList className="h-4 w-4" />
                    Estimates
                  </Button>
                )}
                <Button
                  variant={active === "invoices" ? "default" : "outline"}
                  size="sm"
                  className="flex-1 justify-center gap-1.5 hover:bg-primary/10 hover:text-primary"
                  nativeButton={false}
                  render={<Link href="/dashboard/invoices" />}
                >
                  <FileText className="h-4 w-4" />
                  Invoices
                </Button>
                <Button
                  variant={active === "jobs" ? "default" : "outline"}
                  size="sm"
                  className="flex-1 justify-center gap-1.5 hover:bg-primary/10 hover:text-primary"
                  nativeButton={false}
                  render={<Link href="/dashboard/jobs" />}
                >
                  <Briefcase className="h-4 w-4" />
                  Jobs
                </Button>
              </>
            )}
            {businessType === "salon" && (
              <Button
                variant={active === "commission" ? "default" : "outline"}
                size="sm"
                className="flex-1 justify-center gap-1.5 hover:bg-primary/10 hover:text-primary"
                nativeButton={false}
                render={<Link href="/dashboard/commission" />}
              >
                <Scissors className="h-4 w-4" />
                Commission
              </Button>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
