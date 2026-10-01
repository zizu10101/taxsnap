"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PinSetupFlow } from "@/components/ui/pin-setup-flow";

// Shared by Settings (first-time creation) and the Employees page (reset).
// "create" POSTs - the server rejects it with PIN_ALREADY_SET if one exists,
// so an employee can never be set up twice even from a stale list. "reset"
// PUTs - rejected if there is no PIN yet.
export function EmployeePinDialog({
  employee,
  mode,
  open,
  onOpenChange,
  onDone,
}: {
  employee: { id: string; name: string } | null;
  mode: "create" | "reset";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (employeeId: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  // Remount the flow blank after a server-side rejection.
  const [flowKey, setFlowKey] = useState(0);

  async function handleSubmit(pin: string) {
    if (!employee) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/employees/${employee.id}/pin`, {
        method: mode === "create" ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Couldn't save the PIN.");
        if (data.code === "PIN_ALREADY_SET") {
          // Stale list: someone already set this one up.
          onDone(employee.id);
          onOpenChange(false);
        }
        setFlowKey((k) => k + 1);
        return;
      }
      toast.success(
        mode === "create"
          ? `${employee.name} can now sign in with their PIN`
          : `${employee.name}'s PIN was reset and any active sign-in ended`,
      );
      onDone(employee.id);
      onOpenChange(false);
    } catch {
      toast.error("Something went wrong. Try again.");
      setFlowKey((k) => k + 1);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Set PIN" : "Reset PIN"}
            {employee ? ` for ${employee.name}` : ""}
          </DialogTitle>
          <DialogDescription>
            A 4-digit PIN they&apos;ll use with your shared link to clock in and out.
          </DialogDescription>
        </DialogHeader>
        {open && employee && (
          <PinSetupFlow
            key={`${employee.id}-${flowKey}`}
            onSubmit={handleSubmit}
            submitting={submitting}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
