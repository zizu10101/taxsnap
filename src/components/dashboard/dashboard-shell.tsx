"use client";

import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
import { DashboardTopBar } from "@/components/dashboard/dashboard-topbar";
import {
  DashboardMobileHeader,
  DashboardMobileBottomNav,
} from "@/components/dashboard/dashboard-mobile-nav";
import { useAppLock } from "@/components/app-lock/app-lock-context";
import type { BusinessType, SubscriptionStatus } from "@/lib/database.types";

// One responsive shell, not two separate desktop/mobile components at the
// page level - both layouts are always mounted, Tailwind breakpoints (the
// same lg: cutoff used throughout: DashboardSidebar is lg:flex/hidden,
// DashboardMobileHeader/BottomNav are lg:hidden) decide which renders.
// Mounted once from dashboard/layout.tsx around every /dashboard/** page,
// replacing each page's own DashboardHeader render.
export function DashboardShell({
  email,
  businessName,
  subscriptionStatus,
  businessType,
  logoPath,
  children,
}: {
  email: string;
  businessName: string | null;
  subscriptionStatus: SubscriptionStatus;
  businessType: BusinessType;
  logoPath: string | null;
  children: React.ReactNode;
}) {
  const { role } = useAppLock();
  const isStaffMode = role === "staff";

  return (
    <div className="flex min-h-screen flex-col bg-muted/30 lg:flex-row">
      {!isStaffMode && (
        <DashboardSidebar
          businessType={businessType}
          subscriptionStatus={subscriptionStatus}
          logoPath={logoPath}
        />
      )}
      <DashboardMobileHeader
        email={email}
        businessName={businessName}
        subscriptionStatus={subscriptionStatus}
        businessType={businessType}
        logoPath={logoPath}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="hidden lg:block">
          <DashboardTopBar
            email={email}
            businessName={businessName}
            subscriptionStatus={subscriptionStatus}
            businessType={businessType}
          />
        </div>
        <main className="mx-auto w-full flex-1 space-y-6 p-4 lg:w-[90%] lg:p-7">
          {children}
        </main>
      </div>
      <DashboardMobileBottomNav businessType={businessType} subscriptionStatus={subscriptionStatus} />
    </div>
  );
}
