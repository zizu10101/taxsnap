"use client";

import { useState } from "react";
import { Building2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  BusinessProfileDialog,
  type BusinessProfileFields,
} from "@/components/invoices/business-profile-dialog";
import { LogoImage } from "@/components/invoices/business-logo";

export function BusinessProfileCard({
  initialProfile,
}: {
  initialProfile: BusinessProfileFields;
}) {
  const [profile, setProfile] = useState(initialProfile);
  // Auto-open once on first visit: no business name yet and the user hasn't
  // explicitly dismissed the prompt before. A lazy initializer reads this
  // from props at mount instead of an effect, so there's nothing to
  // "reset" later and no synchronous setState-in-effect to worry about.
  const [dialogOpen, setDialogOpen] = useState(
    () => !initialProfile.business_name && !initialProfile.business_profile_skipped,
  );

  const hasInfo = !!profile.business_name;

  return (
    <>
      <div className="flex items-center gap-3 rounded-lg border p-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
          {profile.logo_url ? (
            <LogoImage
              key={profile.logo_url}
              path={profile.logo_url}
              className="h-full w-full object-contain"
            />
          ) : (
            <Building2 className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {hasInfo ? profile.business_name : "Add your business info"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {hasInfo
              ? [profile.business_phone, profile.business_email]
                  .filter(Boolean)
                  .join(" · ") || "Shown on every invoice and estimate"
              : "Shown on every invoice and estimate you create"}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => setDialogOpen(true)}
        >
          <Pencil className="h-4 w-4" />
          {hasInfo ? "Edit" : "Add"}
        </Button>
      </div>

      <BusinessProfileDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        profile={profile}
        onSaved={setProfile}
        allowSkip={!hasInfo}
      />
    </>
  );
}
