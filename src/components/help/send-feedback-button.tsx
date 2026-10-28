"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FEEDBACK_MESSAGE_MAX, FEEDBACK_TRYING_TO_DO_MAX } from "@/lib/feedback";

// "Send feedback": a small dialog that emails support. The page it was opened from is captured here
// so the team knows where the person was; nothing is stored.
export function SendFeedbackButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [tryingToDo, setTryingToDo] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    if (busy) return;
    setOpen(next);
    if (!next) {
      setMessage("");
      setTryingToDo("");
      setSent(false);
      setError(null);
    }
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, tryingToDo, pagePath: pathname }),
      });
      if (res.ok) {
        setSent(true);
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Could not send your feedback. Please try again.");
      }
    } catch {
      setError("Could not send your feedback. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Send feedback
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          {sent ? (
            <>
              <DialogHeader>
                <DialogTitle>Thank you</DialogTitle>
                <DialogDescription>Your feedback was sent. We read every message.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button onClick={() => handleOpenChange(false)}>Close</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Send feedback</DialogTitle>
                <DialogDescription>
                  Tell us what is working, what is not, or what you wish it did.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="feedback-message">Your feedback</Label>
                  <textarea
                    id="feedback-message"
                    rows={5}
                    maxLength={FEEDBACK_MESSAGE_MAX}
                    autoFocus
                    className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-base sm:text-sm"
                    value={message}
                    disabled={busy}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                  <p className="text-right text-xs text-muted-foreground" aria-live="polite">
                    {message.length} / {FEEDBACK_MESSAGE_MAX}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="feedback-trying">What were you trying to do? (optional)</Label>
                  <Input
                    id="feedback-trying"
                    maxLength={FEEDBACK_TRYING_TO_DO_MAX}
                    value={tryingToDo}
                    disabled={busy}
                    onChange={(e) => setTryingToDo(e.target.value)}
                  />
                </div>
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" disabled={busy} onClick={() => handleOpenChange(false)}>
                  Cancel
                </Button>
                <Button disabled={busy || !message.trim()} onClick={send}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Send
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
