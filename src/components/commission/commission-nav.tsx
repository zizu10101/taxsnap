"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

// Lateral nav between the four commission pages, same pattern as JobCostNav.
export function CommissionNav({
  active,
}: {
  active: "log" | "services" | "stylists" | "reports";
}) {
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
