"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

// Lateral nav between the two pages under the Employees tab (the people, and
// the hours they've worked - including clocked sessions), same pattern as
// the Invoices/Estimates toggle at the top of DocumentList. Jobs is its own
// top-level tab now, so it's no longer part of this toggle.
export function EmployeesNav({ active }: { active: "employees" | "hours" }) {
  const links = [
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
