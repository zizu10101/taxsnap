"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Client, Job } from "@/lib/database.types";
import { MAX_PLACE_LENGTH, validateJobPatch } from "@/lib/job-fields";
import { useRouter } from "next/navigation";

const NO_CUSTOMER = "__none__";

// Edits a job's name, location, customer, contract value and retainage. The rules are the shared
// ones in lib/job-fields.ts (also enforced by PATCH /api/jobs/[id], which additionally freezes the
// contract numbers once the job has progress draws or change orders). Same shape as
// EditClientDialog - PATCH, then onSaved bubbles the fresh row back up.
export function EditJobDialog({
  open,
  onOpenChange,
  job,
  clients,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job;
  clients: Pick<Client, "id" | "name">[];
  onSaved: (job: Job) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(job.name);
  const [location, setLocation] = useState(job.location ?? "");
  const [clientId, setClientId] = useState(job.client_id ?? NO_CUSTOMER);
  const [contractValue, setContractValue] = useState(job.contract_value ?? 0);
  const [retainageRate, setRetainageRate] = useState(job.retainage_rate ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientItems = useMemo(() => {
    const map: Record<string, string> = { [NO_CUSTOMER]: "No customer" };
    for (const c of clients) map[c.id] = c.name;
    return map;
  }, [clients]);

  async function handleSave() {
    // 0 / blank in a number box means "none" (null), as in Start Progress Billing.
    const body = {
      name,
      location,
      client_id: clientId === NO_CUSTOMER ? null : clientId,
      contract_value: contractValue > 0 ? contractValue : null,
      retainage_rate: retainageRate > 0 ? retainageRate : null,
    };

    // Instant feedback from the same rules the server applies (the server is still the authority).
    const checked = validateJobPatch(
      body,
      { contract_value: job.contract_value, retainage_rate: job.retainage_rate },
      { hasDraws: false, hasChanges: false },
    );
    if (!checked.ok) {
      setError(checked.error);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");

      onSaved(data.job as Job);
      toast.success("Job updated");
      router.refresh();
      onOpenChange(false);
    } catch (err) {
      // Inline as well as a toast - a toast alone lands dimmed behind the
      // modal and reads as "nothing happened".
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit job</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-job-name">Name</Label>
            <Input
              id="edit-job-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-job-location">Location (optional)</Label>
            <Input
              id="edit-job-location"
              placeholder="e.g. 123 Main St, Toronto"
              maxLength={MAX_PLACE_LENGTH}
              value={location}
              onChange={(e) => {
                setLocation(e.target.value);
                setError(null);
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-job-customer">Customer (optional)</Label>
            <Select
              items={clientItems}
              value={clientId}
              onValueChange={(v) => v && setClientId(v)}
            >
              <SelectTrigger id="edit-job-customer" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CUSTOMER}>No customer</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-job-contract">Contract value ($, optional)</Label>
            <NumberInput
              id="edit-job-contract"
              value={contractValue}
              onValueChange={(v) => {
                setContractValue(v);
                setError(null);
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-job-retainage">Retainage % (optional)</Label>
            <NumberInput
              id="edit-job-retainage"
              value={retainageRate}
              onValueChange={(v) => {
                setRetainageRate(v);
                setError(null);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Once a job has progress draws or change orders, its contract value and retainage
              are locked - use a change order to adjust the contract.
            </p>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
