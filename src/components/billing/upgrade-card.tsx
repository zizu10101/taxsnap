import Link from "next/link";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// The ONE locked-feature card: shown in place of a Pro-only page or section
// for a Free account (the API routes behind it are separately gated with
// requireProUser, so this is only the explanation, never the protection).
// For a Free cap being hit, use showUpgradePrompt (lib/upgrade-prompt.ts).
export function UpgradeCard({ feature, message }: { feature: string; message: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Lock className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="font-medium">{feature} is a Pro feature</p>
        <p className="max-w-xs text-sm text-muted-foreground">{message}</p>
        <Button nativeButton={false} render={<Link href="/billing" />}>
          Upgrade to Pro
        </Button>
      </CardContent>
    </Card>
  );
}
