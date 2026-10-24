"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { reopenChecklistChoice } from "@/lib/checklist-view";

// Brings the dashboard's getting-started card back: clears the profile's dismissed flag
// and resets this browser's collapse choice to expanded, then goes to the dashboard.
export function ReopenSetupGuideButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function reopen() {
    setBusy(true);
    try {
      const res = await fetch("/api/onboarding/reopen-checklist", { method: "POST" });
      if (!res.ok) throw new Error();
      reopenChecklistChoice(userId);
      router.push("/dashboard");
      router.refresh();
    } catch {
      toast.error("Could not reopen the setup guide. Try again.");
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" disabled={busy} onClick={reopen}>
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      Reopen setup guide
    </Button>
  );
}
