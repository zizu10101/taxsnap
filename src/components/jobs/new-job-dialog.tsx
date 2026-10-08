"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { MAX_PLACE_LENGTH } from "@/lib/job-fields";

const NO_CUSTOMER = "__none__";

export function NewJobDialog({
  open,
  onOpenChange,
  clients,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: Pick<Client, "id" | "name">[];
  onCreated: (job: Job) => void;
}) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [clientId, setClientId] = useState(NO_CUSTOMER);
  const clientItems = useMemo(() => {
    const map: Record<string, string> = { [NO_CUSTOMER]: "No customer" };
    for (const c of clients) map[c.id] = c.name;
    return map;
  }, [clients]);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function handleCreate() {
    if (!name.trim()) {
      toast.error("Enter a job name.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          location,
          client_id: clientId === NO_CUSTOMER ? null : clientId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Every tier gets a capped number of jobs (see
        // lib/plan-limits.ts) - same upgrade-toast pattern used for
        // services/stylists.
        if (data.code === "FREE_LIMIT_REACHED") {
          toast.error(data.error, {
            action: { label: "Upgrade", onClick: () => router.push("/billing") },
          });
          return;
        }
        throw new Error(data.error || "Failed to create");
      }

      // 200 (vs 201) means POST /api/jobs found an existing job with this
      // name (case-insensitive) rather than creating one - say so, since the
      // caller is about to navigate to it.
      if (res.status === 200) {
        toast.info(`A job named "${(data.job as Job).name}" already exists, opening it.`);
      }

      onCreated(data.job as Job);
      router.refresh();
      setName("");
      setLocation("");
      setClientId(NO_CUSTOMER);
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
          <DialogTitle>New job</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="job-name">Job name</Label>
          <Input
            id="job-name"
            placeholder="e.g. 123 Maple St - Kitchen Repaint"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="job-location">Location (optional)</Label>
          <Input
            id="job-location"
            placeholder="e.g. 123 Main St, Toronto"
            maxLength={MAX_PLACE_LENGTH}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>

        {clients.length > 0 && (
          <div className="space-y-2">
            <Label htmlFor="job-customer">Customer (optional)</Label>
            <Select
              items={clientItems}
              value={clientId}
              onValueChange={(v) => v && setClientId(v)}
            >
              <SelectTrigger id="job-customer" className="w-full">
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
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Create job
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
