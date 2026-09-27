"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useAppLock } from "@/components/app-lock/app-lock-context";

// Lateral nav between the commission pages, same pattern as JobCostNav.
export function CommissionNav({
  active,
  isPro,
}: {
  active: "log" | "services" | "products" | "stylists" | "reports" | "overview" | "rentals";
  // Overview is entirely built on payout/adjustment data free/basic
  // accounts can never have (unlike the other four tabs, which all have
  // real free-tier content) - hidden rather than shown-and-locked, same
  // convention DashboardHeader uses for Estimates/Invoices/Jobs.
  isPro: boolean;
}) {
  const { role } = useAppLock();

  // Staff mode can only ever reach the Log page (AppLockProvider redirects
  // anything else back to it) - with nothing to switch to, the nav itself
  // is just noise, so it renders nothing rather than a single active tab.
  if (role === "staff") return null;

  const links = [
    { key: "services", href: "/dashboard/commission/services", label: "Services" },
    { key: "products", href: "/dashboard/commission/products", label: "Products" },
    { key: "stylists", href: "/dashboard/commission/stylists", label: "Stylists" },
    { key: "reports", href: "/dashboard/commission/reports", label: "Reports" },
    ...(isPro
      ? [{ key: "overview", href: "/dashboard/commission/overview", label: "Overview" } as const]
      : []),
    // Chair Rental is deliberately last and visually identical to every
    // other tab here - the separation from Commission/Register is a data
    // model boundary (see 0037_chair_rental.sql), not a UI one; renters
    // are still part of "running the salon," just not stylists.
    { key: "rentals", href: "/dashboard/commission/rentals", label: "Rentals" },
  ] as const;

  return (
    <div className="flex flex-wrap gap-2">
      {links.map((link) => (
        <Button
          key={link.key}
          variant={active === link.key ? "default" : "outline"}
          size="sm"
          className="hover:bg-primary/10 hover:text-primary"
          nativeButton={false}
          render={<Link href={link.href} />}
        >
          {link.label}
        </Button>
      ))}
    </div>
  );
}
