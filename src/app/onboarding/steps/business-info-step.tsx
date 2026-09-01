"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OnboardingStepShell } from "../onboarding-step-shell";
import { ProLockCard } from "../pro-lock-card";

// Same fields/endpoint as BusinessProfileDialog (invoices/business-profile-
// dialog.tsx), but without its embedded logo upload - onboarding already
// has its own Logo step, so showing that control twice would be redundant
// and, worse, out of sync (this step would render Logo Step's freshly-
// uploaded path only after a refresh, not within the same wizard session).
export function BusinessInfoStep({
  isPro,
  initialProfile,
  onNext,
}: {
  isPro: boolean;
  initialProfile: {
    business_name: string | null;
    business_address: string | null;
    business_phone: string | null;
    business_email: string | null;
  };
  onNext: () => void;
}) {
  const [name, setName] = useState(initialProfile.business_name ?? "");
  const [address, setAddress] = useState(initialProfile.business_address ?? "");
  const [phone, setPhone] = useState(initialProfile.business_phone ?? "");
  const [email, setEmail] = useState(initialProfile.business_email ?? "");
  const [saving, setSaving] = useState(false);

  async function handleContinue() {
    setSaving(true);
    try {
      const res = await fetch("/api/profile/business", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_name: name,
          business_address: address,
          business_phone: phone,
          business_email: email,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      onNext();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <OnboardingStepShell
      stepNumber={2}
      totalSteps={3}
      title="Your business info"
      description="Shown on every invoice and estimate you create. You can change this anytime from Invoices."
      onSkip={onNext}
    >
      {isPro ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="onboarding-biz-name">Company name</Label>
            <Input
              id="onboarding-biz-name"
              placeholder="e.g. Rivera Painting Co."
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="onboarding-biz-address">Address</Label>
            <Input
              id="onboarding-biz-address"
              placeholder="123 Main St, Portland, OR 97201"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="onboarding-biz-phone">Phone</Label>
              <Input
                id="onboarding-biz-phone"
                type="tel"
                placeholder="(555) 555-1234"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="onboarding-biz-email">Email</Label>
              <Input
                id="onboarding-biz-email"
                type="email"
                placeholder="you@business.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <Button className="w-full" onClick={handleContinue} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Continue
          </Button>
        </div>
      ) : (
        <ProLockCard />
      )}
    </OnboardingStepShell>
  );
}
