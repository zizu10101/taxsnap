"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Client } from "@/lib/database.types";

// Standalone counterpart to the "+ Add new client" fields embedded inline
// in DocumentBuilder (invoices/document-builder.tsx) - same three fields,
// same POST /api/clients endpoint, but reachable directly from the
// dashboard's "New Client" quick-action tile instead of only appearing
// mid-invoice. Two call sites hitting the same cap-checked endpoint means
// the same FREE_LIMIT_REACHED handling (see lib/plan-limits.ts) has to be
// duplicated here rather than shared - there's no single shared "client
// form" component today, just the same field shape re-typed twice, same
// as NewJobDialog/EmployeeDialog re-typing their own POST bodies rather
// than importing each other.
export function NewClientDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (client: Client) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function handleCreate() {
    if (!name.trim()) {
      toast.error("Enter the client's name.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, address }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Every tier gets a capped number of clients (see
        // lib/plan-limits.ts) - same upgrade-toast pattern used for
        // jobs/employees/services/stylists.
        if (data.code === "FREE_LIMIT_REACHED") {
          toast.error(data.error, {
            action: { label: "Upgrade", onClick: () => router.push("/billing") },
          });
          return;
        }
        throw new Error(data.error || "Failed to create");
      }

      onCreated(data.client as Client);
      toast.success("Client added");
      setName("");
      setEmail("");
      setAddress("");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New client</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-client-name">Name</Label>
            <Input
              id="new-client-name"
              placeholder="e.g. Jordan Reyes"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-client-email">Email (optional)</Label>
            <Input
              id="new-client-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-client-address">Address (optional)</Label>
            <Input
              id="new-client-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Add client
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
