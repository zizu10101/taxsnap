import Link from "next/link";
import { Camera, ClipboardList, FileText, LogOut } from "lucide-react";
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
}: {
  email: string;
  subscriptionStatus: SubscriptionStatus;
}) {
  return (
    <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-4 py-3">
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Camera className="h-4 w-4" />
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            TaxSnap
            <span className="max-w-[160px] truncate text-xs font-normal text-muted-foreground">
              {email}
            </span>
          </span>
        </Link>
        <div className="flex items-center gap-1">
          {subscriptionStatus === "pro" && (
            <>
              <Button
                variant="ghost"
                size="icon"
                title="Estimates"
                nativeButton={false}
                render={<Link href="/dashboard/estimates" />}
              >
                <ClipboardList className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title="Invoices"
                nativeButton={false}
                render={<Link href="/dashboard/invoices" />}
              >
                <FileText className="h-4 w-4" />
              </Button>
            </>
          )}
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
    </header>
  );
}
