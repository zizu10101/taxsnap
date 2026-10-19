"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { BusinessType } from "@/lib/database.types";

// Works for both business types - flips onboarding_completed back to
// false and sends the account through /onboarding again, which itself
// shows the same two steps for either business type. Nothing is cleared.
export function RedoSetupButton({ businessType }: { businessType: BusinessType }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetch("/api/onboarding/redo", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to restart setup");
      router.push("/onboarding");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Redo Setup</CardTitle>
        <CardDescription>
          {businessType === "salon"
            ? "Re-run the setup wizard (business name, province, what you want to do first)."
            : "Re-run the setup wizard (business name, province, what you want to do first)."}{" "}
          Anything already set stays as-is &mdash; you&apos;ll only be
          prompted for what&apos;s still missing.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" variant="outline" onClick={handleClick} disabled={loading}>
          <RotateCcw className="h-4 w-4" />
          Redo Setup
        </Button>
      </CardContent>
    </Card>
  );
}
