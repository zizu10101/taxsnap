"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

// Lateral nav between the three job-cost pages, same pattern as the
// Invoices/Estimates toggle at the top of DocumentList.
export function JobCostNav({ active }: { active: "jobs" | "employees" | "hours" }) {
  const links = [
    { key: "jobs", href: "/dashboard/jobs", label: "Jobs" },
    { key: "employees", href: "/dashboard/employees", label: "Employees" },
    { key: "hours", href: "/dashboard/hours", label: "Hours" },
  ] as const;

  return (
    <div className="flex gap-2">
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
