"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Check, FileText, Loader2, Receipt, Scissors } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BusinessLogoUpload } from "@/components/invoices/business-logo";
import { OnboardingStepShell } from "./onboarding-step-shell";
import {
  AFTER_ONBOARDING,
  CURRENCY,
  PROVINCES,
  goalsFor,
  taxRateForProvince,
  type OnboardingGoal,
} from "@/lib/onboarding";

const GOAL_ICONS: Record<OnboardingGoal, typeof FileText> = {
  invoices: FileText,
  expenses: Receipt,
  job_profit: Briefcase,
  salon: Scissors,
};

async function patchJson(url: string, method: string, body: unknown) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed to save");
  return data;
}

// Two steps, nothing else - the point is a first invoice or a first scanned
// receipt within minutes. Everything entered here is saved to the profile fields
// Settings and the invoice PDF already read (business_name, business_phone,
// business_address, business_number, logo_url), through the same
// PATCH /api/profile/business and logo route. Deliberately free of any upgrade
// prompt: nothing here is gated, and it must stay that way.
export function OnboardingFlow({
  businessType,
  initial,
}: {
  businessType: "general" | "salon";
  initial: {
    name: string | null;
    province: string;
    phone: string | null;
    address: string | null;
    businessNumber: string | null;
    logoPath: string | null;
    goals: OnboardingGoal[];
  };
}) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState(initial.name ?? "");
  const [province, setProvince] = useState(initial.province);
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [address, setAddress] = useState(initial.address ?? "");
  const [businessNumber, setBusinessNumber] = useState(initial.businessNumber ?? "");
  const [logoPath, setLogoPath] = useState(initial.logoPath);
  const [goals, setGoals] = useState<OnboardingGoal[]>(initial.goals);
  const [saving, setSaving] = useState(false);

  const taxRate = taxRateForProvince(province);
  const offered = goalsFor(businessType);

  async function saveBusiness() {
    if (!name.trim()) {
      toast.error("Enter your business name.");
      return;
    }
    setSaving(true);
    try {
      await patchJson("/api/profile/business", "PATCH", {
        business_name: name,
        business_phone: phone,
        business_address: address,
        business_number: businessNumber,
      });
      await patchJson("/api/onboarding/setup", "POST", { province });
      setStep(2);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  function toggleGoal(goal: OnboardingGoal) {
    setGoals((prev) => (prev.includes(goal) ? prev.filter((g) => g !== goal) : [...prev, goal]));
  }

  async function finish() {
    if (goals.length === 0) return;
    setSaving(true);
    try {
      // Always the dashboard: the checklist there has the first step as a button
      // the person presses - nothing is opened for them.
      await patchJson("/api/onboarding/complete", "POST", { goals });
      router.push(AFTER_ONBOARDING);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      setSaving(false);
    }
  }

  if (step === 1) {
    return (
      <OnboardingStepShell
        stepNumber={1}
        totalSteps={2}
        title="Tell us about your business"
        description="This is what your clients see on every invoice. It takes about a minute."
      >
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="onboarding-name">Business name</Label>
            <Input
              id="onboarding-name"
              autoFocus
              className="h-11 text-base"
              placeholder="e.g. Rivera Painting Co."
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="onboarding-province">Province</Label>
            <select
              id="onboarding-province"
              value={province}
              onChange={(e) => setProvince(e.target.value)}
              className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base"
            >
              {PROVINCES.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </select>
            {taxRate !== null ? (
              <p className="text-xs text-muted-foreground">
                Invoices and your HST estimate use {Math.round(taxRate * 100)}% HST. Currency: {CURRENCY}.
              </p>
            ) : (
              <p className="text-xs text-warning">
                TaxSnap only calculates Ontario&apos;s 13% HST so far. Your other provincial tax rates
                aren&apos;t supported yet, so check the tax on anything you send.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <Label>Logo</Label>
              <span className="text-xs text-muted-foreground">Optional - skip, add later</span>
            </div>
            <BusinessLogoUpload logoPath={logoPath} onLogoChange={setLogoPath} />
          </div>

          <div className="space-y-4 rounded-xl border border-dashed border-border p-4">
            <p className="text-xs text-muted-foreground">
              Optional. These appear on your invoices and estimates, and you can edit them anytime in
              Settings.
            </p>
            <div className="space-y-2">
              <Label htmlFor="onboarding-phone">Phone</Label>
              <Input
                id="onboarding-phone"
                type="tel"
                className="h-11 text-base"
                placeholder="(555) 555-1234"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="onboarding-address">Address</Label>
              <Input
                id="onboarding-address"
                className="h-11 text-base"
                placeholder="123 Main St, Toronto, ON"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="onboarding-bn">HST/BN number</Label>
              <Input
                id="onboarding-bn"
                className="h-11 text-base"
                placeholder="123456789 RT0001"
                value={businessNumber}
                onChange={(e) => setBusinessNumber(e.target.value)}
              />
            </div>
          </div>

          <Button className="h-12 w-full text-base" onClick={saveBusiness} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Continue
          </Button>
        </div>
      </OnboardingStepShell>
    );
  }

  return (
    <OnboardingStepShell
      stepNumber={2}
      totalSteps={2}
      title="What do you want to do with TaxSnap?"
      description="Pick all that apply. We'll build your checklist around it."
    >
      <div className="space-y-3" role="group" aria-label="What you want to do">
        {offered.map((g) => {
          const Icon = GOAL_ICONS[g.value];
          const selected = goals.includes(g.value);
          return (
            <button
              key={g.value}
              type="button"
              role="checkbox"
              aria-checked={selected}
              disabled={saving}
              onClick={() => toggleGoal(g.value)}
              className={`flex min-h-20 w-full items-center gap-4 rounded-xl border-2 p-4 text-left transition-colors disabled:opacity-60 ${
                selected ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/50"
              }`}
            >
              <span
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${
                  selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
              >
                <Icon className="h-6 w-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{g.label}</span>
                <span className="block text-sm text-muted-foreground">{g.hint}</span>
              </span>
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${
                  selected ? "border-primary bg-primary text-primary-foreground" : "border-border"
                }`}
              >
                {selected && <Check className="h-4 w-4" />}
              </span>
            </button>
          );
        })}

        <div className="flex gap-3 pt-2">
          <Button
            variant="outline"
            className="h-12 flex-1 text-base"
            onClick={() => setStep(1)}
            disabled={saving}
          >
            Back
          </Button>
          <Button
            className="h-12 flex-[2] text-base"
            onClick={finish}
            disabled={saving || goals.length === 0}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Continue
          </Button>
        </div>
        {goals.length === 0 && (
          <p className="text-center text-xs text-muted-foreground">Pick at least one to continue.</p>
        )}
      </div>
    </OnboardingStepShell>
  );
}
