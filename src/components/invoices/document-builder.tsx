"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BookmarkPlus, Clock, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ONTARIO_HST_RATE } from "@/lib/hst";
import type {
  Client,
  DocumentType,
  DocumentWithRelations,
  HourEntryWithRelations,
  LineItem,
} from "@/lib/database.types";

const NEW_CLIENT = "__new__";

// Sentinel values for the job Select, same inline-create pattern as the
// client picker above and the receipt job picker in upload-receipt.tsx.
const NO_JOB = "__no_job__";
const NEW_JOB = "__new_job__";

interface LineItemDraft {
  description: string;
  quantity: number;
  unit_price: number;
  /** Save this item to the reusable saved-items list on submit. */
  saveForReuse?: boolean;
}

const EMPTY_ITEM: LineItemDraft = { description: "", quantity: 1, unit_price: 0 };

const INSERT_SAVED_PLACEHOLDER = "__pick_saved_item__";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function DocumentBuilder({
  open,
  onOpenChange,
  defaultType,
  document,
  clients,
  jobs = [],
  savedLineItems = [],
  presetJob = null,
  onSaved,
  onClientCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultType: DocumentType;
  document?: DocumentWithRelations | null;
  clients: Client[];
  // Real ids, not just names - lets "+ Add labor" below resolve a job's
  // id (to fetch its hours) the moment the user picks it from this
  // dialog's own job Select, not only when pre-seeded via presetJob or
  // when editing an already-saved document.
  jobs?: { id: string; name: string }[];
  savedLineItems?: LineItem[];
  // Pre-selects a job with a real, already-known id (e.g. opened from the
  // Job Detail page's "New Invoice for this job").
  presetJob?: { id: string; name: string } | null;
  onSaved: (document: DocumentWithRelations) => void;
  onClientCreated: (client: Client) => void;
}) {
  const isEditing = !!document;

  const [type, setType] = useState<DocumentType>(document?.type ?? defaultType);
  const [clientId, setClientId] = useState<string>(document?.client_id ?? NEW_CLIENT);
  const [newClient, setNewClient] = useState({ name: "", email: "", address: "" });
  const [issueDate, setIssueDate] = useState(document?.issue_date ?? todayIso());
  const [dueDate, setDueDate] = useState(document?.due_date ?? "");
  const [items, setItems] = useState<LineItemDraft[]>(
    document?.items?.length
      ? document.items.map((i) => ({
          description: i.description,
          quantity: i.quantity,
          unit_price: i.unit_price,
        }))
      : [{ ...EMPTY_ITEM }],
  );
  const [saving, setSaving] = useState(false);
  const initialJobName = document?.job?.name ?? presetJob?.name ?? null;
  const initialJobId = document?.job_id ?? presetJob?.id ?? null;
  const [jobMode, setJobMode] = useState<string>(initialJobName ?? NO_JOB);
  const [newJobName, setNewJobName] = useState("");
  const [loadingLabor, setLoadingLabor] = useState(false);
  const router = useRouter();

  // Resolves as soon as jobMode names any real, existing job - not just
  // the one the dialog opened with. NEW_JOB (a job typed inline that
  // doesn't exist yet) and NO_JOB both correctly miss this map, so
  // "+ Add labor" stays unavailable for them - a job with no id can't
  // have logged hours yet anyway. Falls back to initialJobId for the
  // presetJob/editing-existing-document case on the off chance that job
  // isn't present in the `jobs` list passed in (shouldn't normally
  // happen, since it's fetched from the same table, but costs nothing to
  // guard against).
  const jobIdByName = useMemo(() => new Map(jobs.map((j) => [j.name, j.id])), [jobs]);
  const effectiveJobId =
    jobIdByName.get(jobMode) ?? (jobMode === initialJobName ? initialJobId : null);

  async function handleAddLabor() {
    if (!effectiveJobId) return;
    setLoadingLabor(true);
    try {
      const res = await fetch(`/api/hours?job_id=${effectiveJobId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load logged hours");

      const entries = (data.hourEntries ?? []) as HourEntryWithRelations[];
      if (entries.length === 0) {
        toast.info("No hours logged for this job yet.");
        return;
      }

      // Grouped by employee_id (not name - two employees could share a
      // name) rather than blended across the whole job, so a lead at
      // $40/hr and a helper at $20/hr each get their own accurate line
      // instead of averaging into one misleading rate. The rate is still
      // blended *within* one employee's own entries (revenue/hours),
      // which correctly handles a rate change mid-job rather than
      // assuming one employee only ever has one rate.
      const byEmployee = new Map<string, { name: string; hours: number; revenue: number }>();
      for (const entry of entries) {
        const existing = byEmployee.get(entry.employee_id);
        if (existing) {
          existing.hours += entry.hours;
          existing.revenue += entry.labor_revenue;
        } else {
          byEmployee.set(entry.employee_id, {
            name: entry.employee.name,
            hours: entry.hours,
            revenue: entry.labor_revenue,
          });
        }
      }

      // Sorted by name for a stable order (so the same employee always
      // lands on the same "Labor N" across repeated clicks) - the name
      // itself is never shown on the invoice, real employee names
      // shouldn't appear on a client-facing document.
      const perEmployee = [...byEmployee.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      const newRows = perEmployee.map((emp, index) => {
        const rate = emp.hours > 0 ? Math.round((emp.revenue / emp.hours) * 100) / 100 : 0;
        return {
          description: `Labor ${index + 1}: ${emp.hours} hrs @ ${formatCurrency(rate)}/hr`,
          quantity: emp.hours,
          unit_price: rate,
        };
      });

      setItems((prev) => {
        const emptyIndex = prev.findIndex((i) => !i.description.trim());
        if (emptyIndex === -1) return [...prev, ...newRows];
        const [first, ...rest] = newRows;
        const withFirstFilled = prev.map((it, idx) => (idx === emptyIndex ? first : it));
        return [...withFirstFilled, ...rest];
      });
      toast.success(
        `${newRows.length} labor line item${newRows.length === 1 ? "" : "s"} added`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load logged hours");
    } finally {
      setLoadingLabor(false);
    }
  }

  // Client select's value (a uuid) never matches its displayed label (the
  // client's name), which Base UI's Select can't resolve without an
  // explicit items map - see the date range / job filters for the same fix.
  const clientSelectItems = useMemo(() => {
    const map: Record<string, string> = { [NEW_CLIENT]: "+ Add new client" };
    for (const c of clients) map[c.id] = c.name;
    return map;
  }, [clients]);

  const jobSelectItems = useMemo(() => {
    const map: Record<string, string> = { [NO_JOB]: "No job", [NEW_JOB]: "+ Add new job" };
    for (const job of jobs) map[job.name] = job.name;
    return map;
  }, [jobs]);

  // Saved-item picker's value (an id) never matches its displayed label
  // (description + price), same fix as the client/job selects above.
  const [insertPick, setInsertPick] = useState(INSERT_SAVED_PLACEHOLDER);
  const savedItemSelectItems = useMemo(() => {
    const map: Record<string, string> = {
      [INSERT_SAVED_PLACEHOLDER]: "Insert a saved item...",
    };
    for (const item of savedLineItems) {
      map[item.id] = `${item.description} — ${formatCurrency(item.unit_price)}`;
    }
    return map;
  }, [savedLineItems]);

  function insertSavedItem(id: string | null) {
    const saved = savedLineItems.find((i) => i.id === id);
    if (!saved) return;
    setItems((prev) => {
      // Reuse the first still-empty row instead of always appending, so
      // picking a saved item right after opening the dialog (still just
      // one blank row) doesn't leave that blank row behind.
      const emptyIndex = prev.findIndex((i) => !i.description.trim());
      const filled = {
        description: saved.description,
        quantity: 1,
        unit_price: saved.unit_price,
      };
      if (emptyIndex === -1) return [...prev, filled];
      return prev.map((i, idx) => (idx === emptyIndex ? filled : i));
    });
    setInsertPick(INSERT_SAVED_PLACEHOLDER);
  }

  function handleJobModeChange(value: string) {
    setJobMode(value);
    if (value === NEW_JOB) setNewJobName("");
  }

  const totals = useMemo(() => {
    const subtotal = items.reduce(
      (sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0),
      0,
    );
    const hst = subtotal * ONTARIO_HST_RATE;
    return { subtotal, hst, total: subtotal + hst };
  }, [items]);

  function updateItem(index: number, patch: Partial<LineItemDraft>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  async function handleSave() {
    if (clientId === NEW_CLIENT && !newClient.name.trim()) {
      toast.error("Select an existing client or enter a name for a new one.");
      return;
    }
    const cleanItems = items.filter((i) => i.description.trim());
    if (cleanItems.length === 0) {
      toast.error("Add at least one line item.");
      return;
    }

    const jobName =
      jobMode === NO_JOB ? null : jobMode === NEW_JOB ? newJobName.trim() : jobMode;

    setSaving(true);
    try {
      const body = {
        type,
        issue_date: issueDate,
        due_date: dueDate || null,
        client_id: clientId === NEW_CLIENT ? null : clientId,
        new_client: clientId === NEW_CLIENT ? newClient : undefined,
        ...(jobName ? { job_name: jobName } : { job_id: null }),
        items: cleanItems,
      };

      const res = await fetch(
        isEditing ? `/api/documents/${document!.id}` : "/api/documents",
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        // Either the monthly invoice cap or the total client cap (see
        // src/lib/plan-limits.ts) - both surface through this same field,
        // since the client-create and document-create checks share one
        // FREE_LIMIT_REACHED shape server-side.
        if (data.code === "FREE_LIMIT_REACHED") {
          toast.error(data.error, {
            action: { label: "Upgrade", onClick: () => router.push("/billing") },
          });
          return;
        }
        throw new Error(data.error || "Failed to save");
      }

      const saved = data.document as DocumentWithRelations;
      if (saved.client && clientId === NEW_CLIENT) {
        onClientCreated(saved.client);
      }
      onSaved(saved);

      // Best-effort: save any items the user flagged for reuse. Failures
      // here (e.g. the saved-items cap) shouldn't block the document save
      // that already succeeded, so these are fire-and-forget.
      const toSave = cleanItems.filter((i) => i.saveForReuse);
      for (const item of toSave) {
        fetch("/api/line-items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: item.description,
            unit_price: item.unit_price,
          }),
        }).catch(() => {});
      }

      toast.success(isEditing ? `${type === "invoice" ? "Invoice" : "Estimate"} updated` : `${type === "invoice" ? "Invoice" : "Estimate"} created`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit" : "New"} {type === "invoice" ? "Invoice" : "Estimate"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <Tabs value={type} onValueChange={(v) => v && setType(v as DocumentType)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="estimate">Estimate</TabsTrigger>
              <TabsTrigger value="invoice">Invoice</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="space-y-2">
            <Label htmlFor="doc-client">Client</Label>
            <Select
              items={clientSelectItems}
              value={clientId}
              onValueChange={(v) => v && setClientId(v)}
            >
              <SelectTrigger id="doc-client" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW_CLIENT}>+ Add new client</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {clientId === NEW_CLIENT && (
            <div className="grid gap-3 rounded-lg border p-3">
              <div className="space-y-1.5">
                <Label htmlFor="client-name">Name</Label>
                <Input
                  id="client-name"
                  value={newClient.name}
                  onChange={(e) =>
                    setNewClient({ ...newClient, name: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="client-email">Email (optional)</Label>
                <Input
                  id="client-email"
                  type="email"
                  value={newClient.email}
                  onChange={(e) =>
                    setNewClient({ ...newClient, email: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="client-address">Address (optional)</Label>
                <Input
                  id="client-address"
                  value={newClient.address}
                  onChange={(e) =>
                    setNewClient({ ...newClient, address: e.target.value })
                  }
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="doc-job">Job (optional)</Label>
            <Select
              items={jobSelectItems}
              value={jobMode}
              onValueChange={(v) => v && handleJobModeChange(v)}
            >
              <SelectTrigger id="doc-job" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_JOB}>No job</SelectItem>
                <SelectItem value={NEW_JOB}>+ Add new job</SelectItem>
                {jobs.map((job) => (
                  <SelectItem key={job.id} value={job.name}>
                    {job.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {jobMode === NEW_JOB && (
              <Input
                placeholder="e.g. 123 Main St or Job #4521"
                value={newJobName}
                onChange={(e) => setNewJobName(e.target.value)}
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="issue-date">Issue date</Label>
              <Input
                id="issue-date"
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="due-date">Due date (optional)</Label>
              <Input
                id="due-date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>Line items</Label>
              <div className="flex items-center gap-2">
                {effectiveJobId && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={handleAddLabor}
                    disabled={loadingLabor}
                  >
                    {loadingLabor ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Clock className="h-3.5 w-3.5" />
                    )}
                    Add labor
                  </Button>
                )}
                {savedLineItems.length > 0 && (
                  <Select
                    value={insertPick}
                    onValueChange={insertSavedItem}
                    items={savedItemSelectItems}
                  >
                    <SelectTrigger className="h-8 w-auto max-w-[200px] text-xs">
                      <BookmarkPlus className="h-3.5 w-3.5" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {savedLineItems.map((saved) => (
                        <SelectItem key={saved.id} value={saved.id}>
                          {saved.description} — {formatCurrency(saved.unit_price)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
            {items.map((item, i) => {
              const lineTotal =
                (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
              return (
                <div key={i} className="space-y-1.5 rounded-lg border p-2.5">
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Description (e.g. Potlights)"
                      className="flex-1"
                      value={item.description}
                      onChange={(e) =>
                        updateItem(i, { description: e.target.value })
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      onClick={() =>
                        setItems((prev) => prev.filter((_, idx) => idx !== i))
                      }
                      title="Remove line item"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm">
                    <NumberInput
                      placeholder="Qty"
                      className="w-16"
                      value={item.quantity}
                      onValueChange={(quantity) => updateItem(i, { quantity })}
                    />
                    <span className="text-muted-foreground">×</span>
                    <NumberInput
                      placeholder="Price"
                      className="w-24"
                      value={item.unit_price}
                      onValueChange={(unit_price) =>
                        updateItem(i, { unit_price })
                      }
                    />
                    <span className="text-muted-foreground">=</span>
                    <span className="ml-auto shrink-0 font-semibold tabular-nums">
                      {formatCurrency(lineTotal)}
                    </span>
                  </div>
                  {item.description.trim() && (
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Checkbox
                        checked={!!item.saveForReuse}
                        onCheckedChange={(checked) =>
                          updateItem(i, { saveForReuse: !!checked })
                        }
                      />
                      Save for next time
                    </label>
                  )}
                </div>
              );
            })}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setItems((prev) => [...prev, { ...EMPTY_ITEM }])}
            >
              <Plus className="h-4 w-4" />
              Add line item
            </Button>
          </div>

          <div className="space-y-1.5 rounded-lg bg-muted/40 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="tabular-nums">{formatCurrency(totals.subtotal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">HST (13%)</span>
              <span className="tabular-nums">{formatCurrency(totals.hst)}</span>
            </div>
            <div className="flex items-center justify-between font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{formatCurrency(totals.total)}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEditing ? "Save changes" : `Create ${type === "invoice" ? "invoice" : "estimate"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
