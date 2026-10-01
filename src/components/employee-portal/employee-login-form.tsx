"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PinPad } from "@/components/ui/pin-pad";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function EmployeeLoginForm({
  token,
  employees,
}: {
  token: string;
  employees: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped after a rejected PIN to remount the pad blank (the same
  // remount-by-key reset PinPad's own docs prescribe).
  const [attempt, setAttempt] = useState(0);

  const items = Object.fromEntries(employees.map((e) => [e.id, e.name]));

  async function handlePin(pin: string) {
    if (!employeeId) {
      setError("Pick your name first.");
      setAttempt((a) => a + 1);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/employee-portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, employee_id: employeeId, pin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Couldn't sign in. Try again.");
        setAttempt((a) => a + 1);
        setSubmitting(false);
        return;
      }
      router.replace("/employee/hours");
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setAttempt((a) => a + 1);
      setSubmitting(false);
    }
  }

  if (employees.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          No one has been set up to sign in here yet. Ask your employer to create your PIN.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-6 py-6">
        <div className="space-y-2">
          <Label htmlFor="employee-name">Your name</Label>
          <Select
            items={items}
            value={employeeId}
            onValueChange={(v) => {
              setEmployeeId(v ?? "");
              setError(null);
            }}
          >
            <SelectTrigger id="employee-name" className="w-full">
              <SelectValue placeholder="Select your name" />
            </SelectTrigger>
            <SelectContent>
              {employees.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3">
          <p className="text-center text-sm font-medium text-muted-foreground">Enter your PIN</p>
          <PinPad key={attempt} onComplete={handlePin} disabled={submitting} />
          {submitting && (
            <div className="flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {error && (
            <p role="alert" className="text-center text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
