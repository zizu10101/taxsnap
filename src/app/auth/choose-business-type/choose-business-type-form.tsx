"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BusinessTypeToggle } from "@/app/auth/business-type-toggle";
import { PENDING_BUSINESS_TYPE_COOKIE } from "@/lib/auth-redirect";
import type { BusinessType } from "@/lib/database.types";

export function ChooseBusinessTypeForm({
  defaultBusinessType,
}: {
  // Pre-selects the toggle when this Google signup came from /salons
  // (?business=salon) - see the page's own comment for why that has to
  // travel via a cookie for this specific path. Still just a default;
  // the toggle stays fully changeable either way.
  defaultBusinessType: BusinessType;
}) {
  const [businessType, setBusinessType] = useState<BusinessType>(defaultBusinessType);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function handleContinue() {
    setSaving(true);
    try {
      const res = await fetch("/api/profile/business-type", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_type: businessType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      // Clears the pending-plan cookie's counterpart for business_type -
      // its one job (pre-selecting the toggle above) is done now.
      document.cookie = `${PENDING_BUSINESS_TYPE_COOKIE}=; path=/; max-age=0`;
      router.push("/dashboard");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      setSaving(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">One quick thing</CardTitle>
          <CardDescription>This helps us show you the right features.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <BusinessTypeToggle value={businessType} onChange={setBusinessType} />
          <Button className="w-full" onClick={handleContinue} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Continue
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
