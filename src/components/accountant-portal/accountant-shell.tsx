"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/accountant/reports", label: "Reports" },
  { href: "/accountant/expenses", label: "Expenses" },
  { href: "/accountant/invoices", label: "Invoices & estimates" },
  { href: "/accountant/hours", label: "Hours" },
  { href: "/accountant/export", label: "Export" },
] as const;

export function AccountantShell({
  businessName,
  showNav,
  children,
}: {
  businessName: string | null;
  // false on the "not available" screen: nothing to navigate to.
  showNav: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await fetch("/api/accountant-portal/logout", { method: "POST" }).catch(() => {});
    router.replace("/accountant/reports");
    router.refresh();
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Accountant access
          </p>
          <h1 className="truncate text-2xl font-bold">{businessName ?? "Business records"}</h1>
          <Badge variant="secondary">Read-only</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={signOut}>
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </header>

      {showNav && (
        <nav aria-label="Accountant sections" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "shrink-0 rounded-md px-3 py-1.5 text-sm font-medium",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      )}

      {children}
    </div>
  );
}
