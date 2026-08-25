"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BusinessLogoUpload } from "@/components/invoices/business-logo";
import type { Profile } from "@/lib/database.types";

export type BusinessProfileFields = Pick<
  Profile,
  | "business_name"
  | "business_address"
  | "business_phone"
  | "business_email"
  | "business_profile_skipped"
  | "logo_url"
>;

export function BusinessProfileDialog({
  open,
  onOpenChange,
  profile,
  onSaved,
  allowSkip,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: BusinessProfileFields;
  onSaved: (profile: BusinessProfileFields) => void;
  allowSkip: boolean;
}) {
  const [logoPath, setLogoPath] = useState(profile.logo_url);
  const [name, setName] = useState(profile.business_name ?? "");
  const [address, setAddress] = useState(profile.business_address ?? "");
  const [phone, setPhone] = useState(profile.business_phone ?? "");
  const [email, setEmail] = useState(profile.business_email ?? "");
  const [saving, setSaving] = useState(false);

  async function patchProfile(body: Record<string, unknown>) {
    const res = await fetch("/api/profile/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to save");
    return data.profile as BusinessProfileFields;
  }

  async function handleSave() {
    setSaving(true);
    try {
      const saved = await patchProfile({
        business_name: name,
        business_address: address,
        business_phone: phone,
        business_email: email,
      });
      onSaved({ ...saved, logo_url: logoPath });
      toast.success("Business info saved");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function handleSkip() {
    setSaving(true);
    try {
      await patchProfile({ skipped: true });
      onSaved({ ...profile, logo_url: logoPath, business_profile_skipped: true });
      onOpenChange(false);
    } catch {
      // Skipping is best-effort - just close either way.
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Your business info</DialogTitle>
          <DialogDescription>
            Shown on every invoice and estimate you create. You can change
            this anytime.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <BusinessLogoUpload logoPath={logoPath} onLogoChange={setLogoPath} />

          <div className="space-y-2">
            <Label htmlFor="biz-name">Company name</Label>
            <Input
              id="biz-name"
              placeholder="e.g. Rivera Painting Co."
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="biz-address">Address</Label>
            <Input
              id="biz-address"
              placeholder="123 Main St, Portland, OR 97201"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="biz-phone">Phone</Label>
              <Input
                id="biz-phone"
                type="tel"
                placeholder="(555) 555-1234"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="biz-email">Email</Label>
              <Input
                id="biz-email"
                type="email"
                placeholder="you@business.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          {allowSkip && (
            <Button variant="outline" onClick={handleSkip} disabled={saving}>
              Skip for now
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
