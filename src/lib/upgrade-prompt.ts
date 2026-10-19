import { toast } from "sonner";

// The ONE client-side prompt for "you've hit a Free cap" (a FREE_LIMIT_REACHED
// answer from the API). Every capped create/reactivate flow calls this instead
// of building its own toast, so the wording and the Upgrade action can't drift.
// The message comes from the server (limitReachedMessage in plan-limits.ts).
// For a whole locked page or section, use <UpgradeCard> instead.
export function showUpgradePrompt(message: string, router: { push: (href: string) => void }) {
  toast.error(message, {
    action: { label: "Upgrade", onClick: () => router.push("/billing") },
  });
}
