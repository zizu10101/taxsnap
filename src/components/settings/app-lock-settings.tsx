"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PinSetupFlow } from "@/components/ui/pin-setup-flow";

// One card per PIN (owner/staff) - independent set/change actions, each its
// own PinSetupFlow instance, so setting one never touches the other's
// saved state. `open`/`onOpenChange` are controlled by the parent rather
// than local state - see AppLockSettings for why: PinPad listens on
// `window` for keydown with no scoping, on the documented assumption that
// exactly one PinPad is ever mounted at a time. Each card independently
// defaulting to `open = !initialHasPin` broke that on a brand-new account
// (neither PIN set yet, so both auto-opened simultaneously, mounting two
// PinPads whose keydown handlers both fired on every digit, corrupting
// both pads' entry at once) - lifting "which one is open" to a single
// parent-owned value makes at most one ever mountable, structurally.
function PinCard({
  title,
  description,
  initialHasPin,
  endpoint,
  savedMessage,
  changedMessage,
  open,
  onOpenChange,
}: {
  title: string;
  description: string;
  initialHasPin: boolean;
  endpoint: string;
  savedMessage: string;
  changedMessage: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [hasPin, setHasPin] = useState(initialHasPin);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped to force-remount PinSetupFlow back to its blank "enter" step
  // after the server rejects a PIN.
  const [flowAttempt, setFlowAttempt] = useState(0);

  async function handleSubmit(pin: string) {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save PIN");

      const wasSet = hasPin;
      setHasPin(true);
      onOpenChange(false);
      toast.success(wasSet ? changedMessage : savedMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save PIN");
      setFlowAttempt((a) => a + 1);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {hasPin && !open ? (
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2">
            <span className="text-sm text-muted-foreground">PIN is set</span>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(true)}>
              Change PIN
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <PinSetupFlow key={flowAttempt} onSubmit={handleSubmit} submitting={saving} />
            {error && <p className="text-center text-sm text-destructive">{error}</p>}
            {hasPin && (
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    onOpenChange(false);
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AppLockSettings({
  hasOwnerPin,
  hasStaffPin,
}: {
  hasOwnerPin: boolean;
  hasStaffPin: boolean;
}) {
  // At most one of these is ever "owner" or "staff" - see PinCard's own
  // comment for why that matters. Defaults to whichever one still needs
  // setup, owner taking priority when both do (the more critical one to
  // set first); null (both collapsed) once both already have a PIN.
  const [expanded, setExpanded] = useState<"owner" | "staff" | null>(
    !hasOwnerPin ? "owner" : !hasStaffPin ? "staff" : null,
  );

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">App Lock</h2>
      <PinCard
        title="Manager PIN"
        description="Unlocks the full app."
        initialHasPin={hasOwnerPin}
        endpoint="/api/app-lock/set-owner-pin"
        savedMessage="Manager PIN saved"
        changedMessage="Manager PIN changed"
        open={expanded === "owner"}
        onOpenChange={(open) => setExpanded(open ? "owner" : null)}
      />
      <PinCard
        title="Staff PIN"
        description="Unlocks a restricted view - Commission Log only, no Reports, Stylists, Services, or payout actions."
        initialHasPin={hasStaffPin}
        endpoint="/api/app-lock/set-staff-pin"
        savedMessage="Staff PIN saved"
        changedMessage="Staff PIN changed"
        open={expanded === "staff"}
        onOpenChange={(open) => setExpanded(open ? "staff" : null)}
      />
    </div>
  );
}
