import Link from "next/link";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// Same lock-card-plus-upgrade pattern already shown on the real
// Services/Stylists pages for a non-Pro visitor (see
// dashboard/commission/services/page.tsx) - onboarding shows the identical
// thing for any step whose underlying action is Pro-gated
// (logo/services/stylists), rather than a separate onboarding-specific
// upsell.
export function ProLockCard() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Lock className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="font-medium">This is a Pro feature</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          Upgrade to the Pro plan ($29/mo) to unlock it - you can always come back to this later.
        </p>
        <Button nativeButton={false} render={<Link href="/billing" />}>
          Upgrade to Pro
        </Button>
      </CardContent>
    </Card>
  );
}
