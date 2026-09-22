"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ellipsis, Lock, LogOut, Moon, Settings, Sun } from "lucide-react";
import { signOut } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { LogoImage } from "@/components/invoices/business-logo";
import { NavItemButton } from "@/components/dashboard/nav-item";
import { ModeToggle } from "@/components/dashboard/mode-toggle";
import { getActiveNavKey, getNavItems, splitMobileNav } from "@/components/dashboard/nav-config";
import { useAppLock } from "@/components/app-lock/app-lock-context";
import { useTheme } from "@/components/theme-sync";
import type { BusinessType, SubscriptionStatus } from "@/lib/database.types";

const TIER_LABEL: Record<SubscriptionStatus, string> = {
  free: "Free",
  basic: "Basic",
  pro: "Pro",
};

// Sticky dark app bar, phone-width equivalent of DashboardTopBar - see that
// file for the desktop version. PRO/Upgrade badge + Settings live here only
// when not in staff mode, same as desktop - everything else non-critical
// (sign out, overflow nav items) moves into the bottom nav's "More" sheet
// to keep this bar compact. Theme toggle and, for a salon manager,
// ModeToggle + Lock are the exception: the bottom nav (and its More sheet)
// is fully hidden in staff mode, so those three have to live here instead -
// otherwise a staff session on a phone would have no way back to Manager
// mode at all.
export function DashboardMobileHeader({
  email,
  businessName,
  subscriptionStatus,
  businessType,
  logoPath,
}: {
  email: string;
  businessName: string | null;
  subscriptionStatus: SubscriptionStatus;
  businessType: BusinessType;
  logoPath: string | null;
}) {
  const { role, hasOwnerPin, relock } = useAppLock();
  const isStaffMode = role === "staff";
  const { resolvedTheme, setPreference } = useTheme();

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-2 bg-sidebar px-4 py-2.5 lg:hidden">
      <Link href={isStaffMode ? "/dashboard/commission" : "/dashboard"} className="flex min-w-0 items-center gap-2">
        {logoPath ? (
          <LogoImage key={logoPath} path={logoPath} className="h-7 w-7 shrink-0 rounded-md object-contain" />
        ) : (
          <img src="/logo-mark.png" alt="" className="h-7 w-7 shrink-0" />
        )}
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-[13px] font-semibold text-sidebar-foreground">
            {businessName || "TaxSnap"}
          </span>
          <span className="truncate font-mono text-[10px] text-sidebar-foreground/50">
            {isStaffMode ? "Staff mode" : email}
          </span>
        </span>
      </Link>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          title={resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          onClick={() => setPreference(resolvedTheme === "dark" ? "light" : "dark")}
        >
          {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        {businessType === "salon" && hasOwnerPin && (
          <>
            <ModeToggle isStaffMode={isStaffMode} onRequestSwitch={relock} onDark />
            {!isStaffMode && (
              <Button
                variant="ghost"
                size="icon"
                className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                title="Lock now"
                onClick={relock}
              >
                <Lock className="h-4 w-4" />
              </Button>
            )}
          </>
        )}
        {!isStaffMode && (
          <>
            {subscriptionStatus === "pro" ? (
              <Badge
                variant="outline"
                className="border-sidebar-primary/40 bg-sidebar-primary/10 font-mono text-[10px] text-sidebar-primary tracking-wide"
              >
                {TIER_LABEL[subscriptionStatus]}
              </Badge>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                nativeButton={false}
                render={<Link href="/billing" />}
              >
                Upgrade
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              title="Settings"
              nativeButton={false}
              render={<Link href="/dashboard/settings" />}
            >
              <Settings className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
    </header>
  );
}

// Sticky dark bottom nav - 4 primary items + "More" (see nav-config.ts for
// how the primary/overflow split is chosen per business type). Entirely
// hidden in staff mode, matching the old DashboardHeader's tab row being
// hidden there - staff mode stays a single reachable page
// (/dashboard/commission) with no nav at all.
export function DashboardMobileBottomNav({
  businessType,
  subscriptionStatus,
}: {
  businessType: BusinessType;
  subscriptionStatus: SubscriptionStatus;
}) {
  const pathname = usePathname();
  const { role } = useAppLock();
  const isStaffMode = role === "staff";
  const [moreOpen, setMoreOpen] = useState(false);

  if (isStaffMode) return null;

  const activeKey = getActiveNavKey(pathname);
  const items = getNavItems({
    businessType: businessType === "salon" ? "salon" : "general",
    isPro: subscriptionStatus === "pro",
  });
  const { primary, overflow } = splitMobileNav(items);
  const overflowActive = overflow.some((i) => i.key === activeKey);

  return (
    <nav
      className="sticky bottom-0 z-20 grid gap-1 border-t border-sidebar-border bg-sidebar px-1.5 pt-1.5 pb-[calc(env(safe-area-inset-bottom)+0.375rem)] lg:hidden"
      style={{ gridTemplateColumns: `repeat(${primary.length + 1}, minmax(0, 1fr))` }}
    >
      {primary.map((item) => (
        <NavItemButton key={item.key} item={item} active={item.key === activeKey} size="bottomnav" />
      ))}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetTrigger
          render={
            <Button
              variant="ghost"
              className={`flex h-auto w-full flex-col items-center justify-center gap-1 rounded-lg px-0.5 py-2 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground ${
                overflowActive ? "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground" : ""
              }`}
            />
          }
        >
          <Ellipsis className="h-5 w-5" strokeWidth={1.6} />
          <span className={`text-[10px] leading-tight ${overflowActive ? "font-semibold" : "font-medium"}`}>More</span>
        </SheetTrigger>
        <SheetContent>
          <SheetTitle>More</SheetTitle>
          {overflow.map((item) => (
            <Button
              key={item.key}
              variant="ghost"
              nativeButton={false}
              render={<Link href={item.href} />}
              onClick={() => setMoreOpen(false)}
              className={`h-auto w-full justify-start gap-3 rounded-lg px-3 py-2.5 text-sidebar-foreground hover:bg-sidebar-accent ${
                item.key === activeKey ? "bg-sidebar-accent" : ""
              }`}
            >
              <item.icon className="h-4 w-4" strokeWidth={1.6} />
              {item.label}
            </Button>
          ))}

          {/* Theme toggle and (for a salon manager) ModeToggle/Lock live in
              DashboardMobileHeader instead, not here - that bar has to
              carry them regardless of staff mode (this sheet is hidden
              entirely in staff mode), so duplicating them here would just
              be the same three controls reachable two ways. */}
          <form action={signOut}>
            <Button
              variant="ghost"
              type="submit"
              className="h-auto w-full justify-start gap-3 rounded-lg px-3 py-2.5 text-sidebar-foreground hover:bg-sidebar-accent"
            >
              <LogOut className="h-4 w-4" strokeWidth={1.6} />
              Sign out
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </nav>
  );
}
