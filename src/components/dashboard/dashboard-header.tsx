import Link from "next/link";
import { Briefcase, ClipboardList, FileText, LogOut, Scissors } from "lucide-react";
import { signOut } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { SubscriptionStatus } from "@/lib/database.types";

const TIER_LABEL: Record<SubscriptionStatus, string> = {
  free: "Free",
  basic: "Basic",
  pro: "Pro",
};

export function DashboardHeader({
  email,
  subscriptionStatus,
  active,
}: {
  email: string;
  subscriptionStatus: SubscriptionStatus;
  active?: "estimates" | "invoices" | "jobs" | "commission";
}) {
  return (
    <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-4 py-3">
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
          <img src="/logo-mark.png" alt="" className="h-8 w-8 shrink-0" />
          <span className="flex min-w-0 flex-col leading-tight">
            TaxSnap
            <span className="max-w-[160px] truncate text-xs font-normal text-muted-foreground">
              {email}
            </span>
          </span>
        </Link>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/billing" />}
          >
            <Badge variant="outline" className="mr-1">
              {TIER_LABEL[subscriptionStatus]}
            </Badge>
          </Button>
          <form action={signOut}>
            <Button variant="ghost" size="icon" title="Sign out" type="submit">
              <LogOut className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </div>
      {subscriptionStatus === "pro" && (
        <nav className="border-t bg-background">
          <div className="mx-auto flex max-w-2xl gap-2 px-4 py-2">
            <Button
              variant={active === "estimates" ? "default" : "outline"}
              size="sm"
              className="flex-1 justify-center gap-1.5 hover:bg-primary/10 hover:text-primary"
              nativeButton={false}
              render={<Link href="/dashboard/estimates" />}
            >
              <ClipboardList className="h-4 w-4" />
              Estimates
            </Button>
            <Button
              variant={active === "invoices" ? "default" : "outline"}
              size="sm"
              className="flex-1 justify-center gap-1.5 hover:bg-primary/10 hover:text-primary"
              nativeButton={false}
              render={<Link href="/dashboard/invoices" />}
            >
              <FileText className="h-4 w-4" />
              Invoices
            </Button>
            <Button
              variant={active === "jobs" ? "default" : "outline"}
              size="sm"
              className="flex-1 justify-center gap-1.5 hover:bg-primary/10 hover:text-primary"
              nativeButton={false}
              render={<Link href="/dashboard/jobs" />}
            >
              <Briefcase className="h-4 w-4" />
              Jobs
            </Button>
            <Button
              variant={active === "commission" ? "default" : "outline"}
              size="sm"
              className="flex-1 justify-center gap-1.5 hover:bg-primary/10 hover:text-primary"
              nativeButton={false}
              render={<Link href="/dashboard/commission" />}
            >
              <Scissors className="h-4 w-4" />
              Commission
            </Button>
          </div>
        </nav>
      )}
    </header>
  );
}
