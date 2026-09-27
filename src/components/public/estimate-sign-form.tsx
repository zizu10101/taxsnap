"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function formatSignedDate(isoStr: string) {
  return new Date(isoStr).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// Confirmation state, shared by "just signed this second" (a local state
// transition, no reload) and "revisited this link after already signing
// on a previous visit" (the page itself renders this directly, without
// ever mounting this component at all - see /sign/[token]/page.tsx).
export function SignedConfirmation({ signedAt }: { signedAt: string }) {
  return (
    <Card className="border-success/30 bg-success/5">
      <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
        <CheckCircle2 className="h-8 w-8 text-success" />
        <p className="font-medium">Signed on {formatSignedDate(signedAt)} — thank you!</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Your invoice is on its way. If you don&apos;t see it soon, reach out to the
          business directly.
        </p>
      </CardContent>
    </Card>
  );
}

export function EstimateSignForm({ token }: { token: string }) {
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedAt, setSignedAt] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    if (!name.trim()) {
      setError("Enter your full name.");
      return;
    }
    if (!agreed) {
      setError("Check the box to agree to this estimate before signing.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/sign/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signer_name: name, agreed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to sign");

      setSignedAt(data.signed_at);
    } catch (err) {
      // Stays on the form with whatever was typed still in place, same
      // "a failed save shouldn't make you retype everything" pattern used
      // throughout this app's other submit flows.
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (signedAt) {
    return <SignedConfirmation signedAt={signedAt} />;
  }

  return (
    <Card>
      <CardContent className="space-y-4 py-6">
        <p className="font-medium">Sign this estimate</p>
        <div className="space-y-2">
          <Label htmlFor="signer-name">Full name</Label>
          <Input
            id="signer-name"
            placeholder="Type your full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex items-start gap-2">
          <Checkbox
            id="signer-agree"
            checked={agreed}
            onCheckedChange={(checked) => setAgreed(checked === true)}
          />
          <Label htmlFor="signer-agree" className="text-sm font-normal leading-tight">
            I agree to this estimate.
          </Label>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button className="w-full" size="lg" onClick={handleSubmit} disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Sign &amp; Submit
        </Button>
      </CardContent>
    </Card>
  );
}
