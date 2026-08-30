"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useAppLock } from "@/components/app-lock/app-lock-context";

// Lateral nav between the four commission pages, same pattern as JobCostNav.
export function CommissionNav({
  active,
}: {
  active: "log" | "services" | "stylists" | "reports";
}) {
  const { role } = useAppLock();

  // Staff mode can only ever reach the Log page (AppLockProvider redirects
  // anything else back to it) - with nothing to switch to, the nav itself
  // is just noise, so it renders nothing rather than a single active tab.
  if (role === "staff") return null;

  const links = [
    { key: "log", href: "/dashboard/commission", label: "Log" },
    { key: "services", href: "/dashboard/commission/services", label: "Services" },
    { key: "stylists", href: "/dashboard/commission/stylists", label: "Stylists" },
    { key: "reports", href: "/dashboard/commission/reports", label: "Reports" },
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
