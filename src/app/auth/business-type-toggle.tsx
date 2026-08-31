"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { BusinessType } from "@/lib/database.types";

// Shared two-option choice used both inline on the password sign-up form
// and on the standalone /auth/choose-business-type screen (shown once to a
// brand-new Google OAuth signup, which has no equivalent moment on its own
// sign-up form to ask this during).
export function BusinessTypeToggle({
  value,
  onChange,
  label = "What kind of business is this?",
}: {
  value: BusinessType;
  onChange: (value: BusinessType) => void;
  label?: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Button
          type="button"
          variant={value === "salon" ? "default" : "outline"}
          className="flex-1"
          onClick={() => onChange("salon")}
        >
          Salon / Barbershop
        </Button>
        <Button
          type="button"
          variant={value === "general" ? "default" : "outline"}
          className="flex-1"
          onClick={() => onChange("general")}
        >
          General Business
        </Button>
      </div>
    </div>
  );
}
