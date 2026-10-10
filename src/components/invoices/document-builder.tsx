"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveReusableItems, savedItemsFailureMessage } from "@/lib/save-line-items";
import { Clock, Loader2, Plus, Trash2 } from "lucide-react";
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
import { SavedItemPicker } from "@/components/invoices/saved-item-picker";
import { insertLine, lineFromSavedItem, type SavedItemLike } from "@/lib/saved-items";
import { lineDescription, lineName } from "@/lib/line-format";
import { LineItemFields } from "@/components/invoices/line-item-fields";
import { dueDateLabel } from "@/lib/document-labels";
import {
  MAX_PLACE_LENGTH,
  clientForJobChange,
  defaultPlaceOfWork,
  jobClientIdByName,
  jobPickerOptions,
  type ClientPick,
} from "@/lib/job-fields";
import type {
  Client,
  DocumentType,
  DocumentWithRelations,
  LineItem,
} from "@/lib/database.types";

const NEW_CLIENT = "__new__";

// Sentinel values for the job Select, same inline-create pattern as the
// client picker above and the receipt job picker in upload-receipt.tsx.
const NO_JOB = "__no_job__";
const NEW_JOB = "__new_job__";

interface LineItemDraft {
  name: string;
  description: string;
  /** "" = no unit. */
  unit: string;
  quantity: number;
  unit_price: number;
  /** Save this item to the reusable saved-items list on submit. */
  saveForReuse?: boolean;
}

const EMPTY_ITEM: LineItemDraft = { name: "", description: "", unit: "", quantity: 1, unit_price: 0 };

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
  progressDrawJob = null,
  presetItems,
  onSaved,
  onClientCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultType: DocumentType;
  document?: DocumentWithRelations | null;
  clients: Client[];
  // Carries real ids, not just names, even though nothing in this
  // component currently reads them (an earlier "+ Add labor" version
  // used them to resolve a job's id and fetch its hours - since removed
  // in favor of a plain placeholder row). Left as-is rather than
  // unwound back to name-only, in case a future feature wants a real
  // job id here again.
  // location prefills the place of work when the job is picked.
  jobs?: {
    id: string;
    name: string;
    location?: string | null;
    client_id?: string | null;
    contract_value?: number | null;
  }[];
  savedLineItems?: LineItem[];
  // Pre-selects a job by name, editable (e.g. opened from the Job
  // Detail page's "New Invoice for this job").
  presetJob?: { name: string } | null;
  // Opens in progress-draw mode, locked to this job (not just pre-
  // filled - a draw's job_id can't be reassigned, since draw_number is
  // scoped to it). Distinct from presetJob: this also forces type to
  // "invoice" and hides the Estimate/Invoice toggle, since a draw is
  // never an estimate, and reveals the work-completed/% complete
  // fields.
  progressDrawJob?: { name: string } | null;
  // Seeds the item rows for a brand-new document (ignored when editing
  // an existing one, where document.items always wins) - e.g. "Bill
  // Remaining Balance" opens a new draw with one line item already
  // filled in instead of the usual blank row.
  presetItems?: { description: string; quantity: number; unit_price: number }[];
  onSaved: (document: DocumentWithRelations) => void;
  onClientCreated: (client: Client) => void;
}) {
  const isEditing = !!document;
  // Covers both creating a new draw (progressDrawJob) and editing one
  // that already exists (document.is_progress_draw) - same UI treatment
  // either way.
  const isDraw = !!document?.is_progress_draw || !!progressDrawJob;

  const [type, setType] = useState<DocumentType>(
    progressDrawJob ? "invoice" : (document?.type ?? defaultType),
  );
  const initialJobName =
    document?.job?.name ?? presetJob?.name ?? progressDrawJob?.name ?? null;
  // A new document opened for a job (from the job page, or a progress draw) starts with that job's
  // customer; an existing document keeps its own client.
  const initialClient: ClientPick = document
    ? { clientId: document.client_id, source: "user" }
    : clientForJobChange(
        { clientId: null, source: "user" },
        jobClientIdByName(jobs, initialJobName),
        clients.map((c) => c.id),
      );
  const [clientId, setClientId] = useState<string>(initialClient.clientId ?? NEW_CLIENT);
  const [clientSource, setClientSource] = useState<ClientPick["source"]>(initialClient.source);
  const [newClient, setNewClient] = useState({ name: "", email: "", address: "" });
  const [issueDate, setIssueDate] = useState(document?.issue_date ?? todayIso());
  const [dueDate, setDueDate] = useState(document?.due_date ?? "");
  const [items, setItems] = useState<LineItemDraft[]>(
    document?.items?.length
      ? document.items.map((i) => ({
          // An old line (null name) opens with its description as the name and no description.
          name: lineName(i),
          description: lineDescription(i),
          unit: i.unit ?? "",
          quantity: i.quantity,
          unit_price: i.unit_price,
        }))
      : presetItems?.length
        ? presetItems.map((i) => ({ name: i.description, description: "", unit: "", quantity: i.quantity, unit_price: i.unit_price }))
        : [{ ...EMPTY_ITEM }],
  );
  const [saving, setSaving] = useState(false);
  const [jobMode, setJobMode] = useState<string>(initialJobName ?? NO_JOB);
  const [newJobName, setNewJobName] = useState("");
  // Defaults to the picked job's location until the user types their own; a saved document keeps
  // its own value (it is a snapshot, not a live link to the job).
  const [placeOfWork, setPlaceOfWork] = useState(
    document ? (document.place_of_work ?? "") : defaultPlaceOfWork(jobs, initialJobName),
  );
  const [placeEdited, setPlaceEdited] = useState(!!document);
  const [drawDescription, setDrawDescription] = useState(document?.draw_description ?? "");
  // NumberInput takes a plain number (0 already displays as an empty
  // field, same convention as every other dollar/qty input in this app)
  // - 0 is sent to the API as "not provided" (null) on save, since 0%
  // complete isn't a meaningful value to record deliberately.
  const [drawPercentComplete, setDrawPercentComplete] = useState(
    document?.draw_percent_complete ?? 0,
  );
  const router = useRouter();

  // Inserts a generic "Labor" placeholder row - the user fills in hours
  // and rate themselves. Deliberately not pulled from the Hours system:
  // an earlier version fetched the job's logged hours and pre-filled
  // real numbers, but that needed a resolved job_id, couldn't show real
  // employee names on a client-facing invoice, and coupled invoicing to
  // however hours happened to be logged. This is simpler and gives the
  // user full control, same as typing any other line item - just
  // pre-labeled instead of blank.
  function handleAddLabor() {
    setItems((prev) => {
      const emptyIndex = prev.findIndex((i) => !i.name.trim());
      const filled = { name: "Labor", description: "", unit: "hr", quantity: 1, unit_price: 0 };
      if (emptyIndex === -1) return [...prev, filled];
      return prev.map((it, idx) => (idx === emptyIndex ? filled : it));
    });
  }

  // Client select's value (a uuid) never matches its displayed label (the
  // client's name), which Base UI's Select can't resolve without an
  // explicit items map - see the date range / job filters for the same fix.
  const clientSelectItems = useMemo(() => {
    const map: Record<string, string> = { [NEW_CLIENT]: "+ Add new client" };
    for (const c of clients) map[c.id] = c.name;
    return map;
  }, [clients]);

  // Every job, with its customer; a progress-billed job is shown disabled for a plain invoice.
  const jobOptions = useMemo(
    () => jobPickerOptions(jobs, clients, { type, isDraw, selectedName: jobMode }),
    [jobs, clients, type, isDraw, jobMode],
  );
  const jobSelectItems = useMemo(() => {
    const map: Record<string, string> = { [NO_JOB]: "No job", [NEW_JOB]: "+ Add new job" };
    for (const o of jobOptions) map[o.value] = o.label;
    return map;
  }, [jobOptions]);

  function insertSavedItem(saved: SavedItemLike) {
    setItems((prev) => insertLine(prev, lineFromSavedItem(saved)));
  }

  function handleJobModeChange(value: string) {
    setJobMode(value);
    if (value === NEW_JOB) setNewJobName("");
    if (!placeEdited) {
      setPlaceOfWork(defaultPlaceOfWork(jobs, value === NO_JOB || value === NEW_JOB ? null : value));
    }
    const jobName = value === NO_JOB || value === NEW_JOB ? null : value;
    // The job's customer prefills the client only while it is empty or was last set by a job
    // prefill; a client picked (or typed) by hand stays.
    const current: ClientPick = {
      clientId: clientId === NEW_CLIENT ? (newClient.name.trim() ? "__typed__" : null) : clientId,
      source: clientSource,
    };
    const next = clientForJobChange(current, jobClientIdByName(jobs, jobName), clients.map((c) => c.id));
    if (next !== current && next.clientId) {
      setClientId(next.clientId);
      setClientSource("job");
    }
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
    const cleanItems = items.filter((i) => i.name.trim());
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
        place_of_work: placeOfWork.trim() || null,
        items: cleanItems,
        ...(isDraw && {
          is_progress_draw: true,
          draw_description: drawDescription,
          draw_percent_complete: drawPercentComplete || null,
        }),
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

      // Saved-for-reuse items: a failure here never undoes the document save
      // that already succeeded, but it is reported rather than swallowed.
      const savedItems = await saveReusableItems(cleanItems.filter((i) => i.saveForReuse));
      const savedItemsFailure = savedItemsFailureMessage(savedItems);
      if (savedItemsFailure) toast.warning(savedItemsFailure);
      router.refresh();

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
            {isDraw
              ? `${isEditing ? "Edit" : "New"} Progress Draw`
              : `${isEditing ? "Edit" : "New"} ${type === "invoice" ? "Invoice" : "Estimate"}`}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          {!isDraw && (
            <Tabs value={type} onValueChange={(v) => v && setType(v as DocumentType)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="estimate">Estimate</TabsTrigger>
                <TabsTrigger value="invoice">Invoice</TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          <div className="space-y-2">
            <Label htmlFor="doc-client">Client</Label>
            <Select
              items={clientSelectItems}
              value={clientId}
              onValueChange={(v) => {
                if (!v) return;
                setClientId(v);
                setClientSource("user");
              }}
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
            <Label htmlFor="doc-job">Job{isDraw ? "" : " (optional)"}</Label>
            {isDraw ? (
              // Locked, not just pre-filled - a draw's job can't be
              // reassigned once created, since draw_number is scoped to
              // it (see lib/document-number.ts). Shown as plain text
              // rather than a disabled Select, so it doesn't look like a
              // dead control the user should be able to click.
              <p
                id="doc-job"
                className="flex h-8 items-center rounded-lg border border-input bg-muted/30 px-2.5 text-sm"
              >
                {jobMode}
              </p>
            ) : (
              <>
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
                    {jobOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
                        {o.label}
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
              </>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="doc-place">Place of work (optional)</Label>
            <Input
              id="doc-place"
              placeholder="e.g. 123 Main St, Toronto"
              maxLength={MAX_PLACE_LENGTH}
              value={placeOfWork}
              onChange={(e) => {
                setPlaceOfWork(e.target.value);
                setPlaceEdited(true);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Fills in from the job&apos;s location; change it here for just this document.
            </p>
          </div>

          {isDraw && (
            <div className="grid gap-3 rounded-lg border p-3">
              <div className="space-y-1.5">
                <Label htmlFor="draw-description">What was completed for this draw</Label>
                <Input
                  id="draw-description"
                  placeholder="e.g. Framing and rough electrical complete"
                  value={drawDescription}
                  onChange={(e) => setDrawDescription(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="draw-percent">% of project complete (optional)</Label>
                <NumberInput
                  id="draw-percent"
                  value={drawPercentComplete}
                  onValueChange={setDrawPercentComplete}
                />
              </div>
            </div>
          )}

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
              <Label htmlFor="due-date">{dueDateLabel(type)} (optional)</Label>
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={handleAddLabor}
                >
                  <Clock className="h-3.5 w-3.5" />
                  Add labor
                </Button>
                {savedLineItems.length > 0 && (
                  <SavedItemPicker items={savedLineItems} onPick={insertSavedItem} />
                )}
              </div>
            </div>
            {items.map((item, i) => {
              return (
                <div key={i} className="space-y-1.5 rounded-lg border p-2.5">
                  <LineItemFields
                    value={item}
                    onChange={(patch) => updateItem(i, patch)}
                    onRemove={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
                  />
                  {item.name.trim() && (
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
