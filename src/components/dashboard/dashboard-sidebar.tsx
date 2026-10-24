"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { LogoImage } from "@/components/invoices/business-logo";
import { Button } from "@/components/ui/button";
import { CustomizeMenuDialog } from "@/components/dashboard/customize-menu";
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
  hiddenNavKeys,
  unsortedPhotoCount,
}: {
  businessType: BusinessType;
  subscriptionStatus: SubscriptionStatus;
  logoPath: string | null;
  hiddenNavKeys: readonly string[];
  unsortedPhotoCount: number;
}) {
  const pathname = usePathname();
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const activeKey = getActiveNavKey(pathname);
  const items = getNavItems({
    businessType: businessType === "salon" ? "salon" : "general",
    isPro: subscriptionStatus === "pro",
    hiddenKeys: hiddenNavKeys,
    keepKey: activeKey,
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
      {/* A salon's menu is fixed (Dashboard + Register), so it has nothing to customize. */}
      {businessType !== "salon" && (
        <div className="mb-0.5 flex items-center justify-between pl-1.5">
          <span className="text-[10px] font-semibold tracking-wider text-sidebar-foreground/50 uppercase">Menu</span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            title="Customize menu"
            aria-label="Customize menu"
            onClick={() => setCustomizeOpen(true)}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </Button>
          <CustomizeMenuDialog
            open={customizeOpen}
            onOpenChange={setCustomizeOpen}
            isPro={subscriptionStatus === "pro"}
            hiddenNavKeys={hiddenNavKeys}
          />
        </div>
      )}
      {items.map((item) => (
        <NavItemButton
          key={item.key}
          item={item}
          active={item.key === activeKey}
          size="sidebar"
          badge={item.key === "photos" ? unsortedPhotoCount : 0}
        />
      ))}
    </aside>
  );
}
