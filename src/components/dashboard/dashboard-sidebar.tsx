"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { LogoImage } from "@/components/invoices/business-logo";
import { NavItemButton } from "@/components/dashboard/nav-item";
import { getActiveNavKey, getNavItems } from "@/components/dashboard/nav-config";
import type { BusinessType, SubscriptionStatus } from "@/lib/database.types";

// Desktop-only left rail (hidden below lg - the mobile bottom nav in
// dashboard-mobile-nav.tsx covers phone widths instead). Hidden entirely in
// staff mode by the caller (DashboardShell), same rule as the old
// DashboardHeader's tab row.
export function DashboardSidebar({
  businessType,
  subscriptionStatus,
  logoPath,
}: {
  businessType: BusinessType;
  subscriptionStatus: SubscriptionStatus;
  logoPath: string | null;
}) {
  const pathname = usePathname();
  const activeKey = getActiveNavKey(pathname);
  const items = getNavItems({
    businessType: businessType === "salon" ? "salon" : "general",
    isPro: subscriptionStatus === "pro",
  });

  return (
    <aside className="hidden w-24 shrink-0 flex-col gap-1.5 bg-sidebar px-2.5 pt-4.5 pb-6 lg:flex">
      <Link href="/dashboard" className="mb-4.5 flex items-center justify-center">
        {logoPath ? (
          <LogoImage
            key={logoPath}
            path={logoPath}
            className="h-8 w-8 shrink-0 rounded-md object-contain"
          />
        ) : (
          <img src="/logo-mark.png" alt="" className="h-8 w-8 shrink-0" />
        )}
      </Link>
      {items.map((item) => (
        <NavItemButton key={item.key} item={item} active={item.key === activeKey} size="sidebar" />
      ))}
    </aside>
  );
}
