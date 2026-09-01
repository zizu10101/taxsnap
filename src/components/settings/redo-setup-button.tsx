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

// Salon-only - flips onboarding_completed back to false and sends the
// account through /onboarding again. Nothing already set (logo, PINs,
// services, stylists) is cleared; OnboardingFlow's visibleSteps logic
// already skips steps that are satisfied, so this just re-opens whatever
// was skipped the first time.
export function RedoSetupButton() {
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
          Re-run the setup wizard (logo, PINs, services, stylists). Anything
          already set stays as-is &mdash; you&apos;ll only be prompted for
          what&apos;s still missing.
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
