"use client";

import Link from "next/link";
import { Lock, LogOut, Moon, Settings, Sun } from "lucide-react";
import { signOut } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAppLock } from "@/components/app-lock/app-lock-context";
import { useTheme } from "@/components/theme-sync";
import { ModeToggle } from "@/components/dashboard/mode-toggle";
import type { BusinessType, SubscriptionStatus } from "@/lib/database.types";

const TIER_LABEL: Record<SubscriptionStatus, string> = {
  free: "Free",
  basic: "Basic",
  pro: "Pro",
};

// Desktop-only top strip, sitting beside DashboardSidebar rather than above
// a mobile-shaped column - see dashboard-mobile-nav.tsx for the phone-width
// equivalent (a much smaller icon set, the rest moved into the More sheet).
export function DashboardTopBar({
  email,
  businessName,
  subscriptionStatus,
  businessType,
}: {
  email: string;
  businessName: string | null;
  subscriptionStatus: SubscriptionStatus;
  businessType: BusinessType;
}) {
  const { role, hasOwnerPin, relock } = useAppLock();
  const isStaffMode = role === "staff";
  const { resolvedTheme, setPreference } = useTheme();

  return (
    <header className="flex items-center justify-between gap-2 border-b border-border bg-card px-7 py-3">
      <div className="min-w-0 leading-tight">
        <p className="truncate text-xs font-semibold text-foreground">
          {businessName || "TaxSnap"}
        </p>
        <p className="truncate font-mono text-[11px] text-muted-foreground">
          {isStaffMode ? "Staff mode" : email}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          variant="outline"
          size="icon-sm"
          title={resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          onClick={() => setPreference(resolvedTheme === "dark" ? "light" : "dark")}
        >
          {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        {businessType === "salon" && hasOwnerPin && (
          <>
            <ModeToggle isStaffMode={isStaffMode} onRequestSwitch={relock} />
            {!isStaffMode && (
              <Button variant="outline" size="icon-sm" title="Lock now" onClick={relock}>
                <Lock className="h-4 w-4" />
              </Button>
            )}
          </>
        )}
        {!isStaffMode && (
          <>
            {subscriptionStatus === "pro" ? (
              <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/billing" />}>
                <Badge variant="outline">{TIER_LABEL[subscriptionStatus]}</Badge>
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
            <Button variant="outline" size="icon-sm" title="Settings" nativeButton={false} render={<Link href="/dashboard/settings" />}>
              <Settings className="h-4 w-4" />
            </Button>
            <form action={signOut}>
              <Button variant="outline" size="icon-sm" title="Sign out" type="submit">
                <LogOut className="h-4 w-4" />
              </Button>
            </form>
          </>
        )}
      </div>
    </header>
  );
}
