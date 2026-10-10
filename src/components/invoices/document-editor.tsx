"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { saveReusableItems, savedItemsFailureMessage } from "@/lib/save-line-items";
import { ArrowLeft, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LogoImage } from "@/components/invoices/business-logo";
import { ONTARIO_HST_RATE } from "@/lib/hst";
import type {
  Client,
  DocumentType,
  DocumentWithRelations,
  LineItem,
} from "@/lib/database.types";
import type { BusinessInfo } from "@/components/invoices/document-detail";
import { SavedItemPicker } from "@/components/invoices/saved-item-picker";
import { insertLine, lineFromSavedItem, type SavedItemLike } from "@/lib/saved-items";
import { formatQuantity, lineDescription, lineName } from "@/lib/line-format";
import { LineItemFields } from "@/components/invoices/line-item-fields";
import { LineLabel } from "@/components/invoices/line-label";
import { dueDateLabel } from "@/lib/document-labels";
import {
  MAX_PLACE_LENGTH,
  clientForJobChange,
  defaultPlaceOfWork,
  jobClientIdByName,
  jobPickerOptions,
  type ClientPick,
} from "@/lib/job-fields";
import { ClientNotes } from "@/components/invoices/client-notes";

// Full-page counterpart to DocumentBuilder (screens 4a/5a of the Invoice
// Editor design handoff) - deliberately NOT a replacement for it.
// DocumentBuilder stays the dialog used for progress draws (Job Detail's
// "New invoice for this job", Progress Billing's "New Draw"/"Bill
// Remaining Balance", and editing an existing draw) - none of those flows
// have any design reference here (locked job, draw description, % complete
// fields), so inventing a full-page version of them isn't "adapting a
// design," it's making one up. This component only ever handles a plain,
// non-draw invoice or estimate - see dashboard/invoices/new,
// dashboard/invoices/[id]/edit and their estimates counterparts.
const NEW_CLIENT = "__new__";
const NO_JOB = "__no_job__";
const NEW_JOB = "__new_job__";
interface LineItemDraft {
  name: string;
  description: string;
  /** "" = no unit. */
  unit: string;
  quantity: number;
  unit_price: number;
  saveForReuse?: boolean;
}

const EMPTY_ITEM: LineItemDraft = { name: "", description: "", unit: "", quantity: 1, unit_price: 0 };

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Dark form-panel wrapper shared by all four left-column sections - same
// header-strip-over-body shape the HST card and Progress Billing Summary
// rail already use elsewhere in this app.
function FormPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="gap-0 overflow-hidden border-sidebar-border bg-sidebar py-0 text-sidebar-foreground">
      <div className="border-b border-sidebar-border bg-sidebar-accent/40 px-5 py-3">
        <p className="font-mono text-xs font-semibold tracking-[0.12em] text-sidebar-foreground uppercase">
          {title}
        </p>
      </div>
      <CardContent className="space-y-4 py-5">{children}</CardContent>
    </Card>
  );
}

// Dark-panel Label/Input pairs need the light-on-dark field treatment the
// rest of the app's inputs don't - kept local to this file rather than a
// new global Input variant, since nothing else in the app puts a form on a
// dark surface.
const darkFieldClass = "border-sidebar-border bg-card text-card-foreground";
const darkLabelClass = "text-sidebar-foreground/70";

export function DocumentEditor({
  defaultType,
  document,
  basePath,
  clients,
  jobs = [],
  savedLineItems = [],
  business,
  logoPath,
}: {
  defaultType: DocumentType;
  document?: DocumentWithRelations | null;
  // "/dashboard/invoices" or "/dashboard/estimates" - drives the back
  // link, the redirect after save, and which list this document belongs
  // to when its type doesn't change.
  basePath: string;
  clients: Client[];
  jobs?: {
    id: string;
    name: string;
    location?: string | null;
    client_id?: string | null;
    contract_value?: number | null;
  }[];
  savedLineItems?: LineItem[];
  business: BusinessInfo;
  logoPath: string | null;
}) {
  const router = useRouter();
  const isEditing = !!document;

  const [type, setType] = useState<DocumentType>(document?.type ?? defaultType);
  const [clientId, setClientId] = useState<string>(document?.client_id ?? NEW_CLIENT);
  const [clientSource, setClientSource] = useState<ClientPick["source"]>("user");
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
      : [{ ...EMPTY_ITEM }],
  );
  const [notes, setNotes] = useState(document?.notes ?? "");
  const [internalNotes, setInternalNotes] = useState(document?.internal_notes ?? "");
  const [saving, setSaving] = useState(false);
  const [jobMode, setJobMode] = useState<string>(document?.job?.name ?? NO_JOB);
  const [newJobName, setNewJobName] = useState("");
  // Defaults to the picked job's location until typed over; a saved document keeps its own value.
  const [placeOfWork, setPlaceOfWork] = useState(
    document ? (document.place_of_work ?? "") : "",
  );
  const [placeEdited, setPlaceEdited] = useState(!!document);

  const clientSelectItems = useMemo(() => {
    const map: Record<string, string> = { [NEW_CLIENT]: "+ Add new client" };
    for (const c of clients) map[c.id] = c.name;
    return map;
  }, [clients]);

  // Every job, with its customer; a progress-billed job is shown disabled for a plain invoice.
  const jobOptions = useMemo(
    () => jobPickerOptions(jobs, clients, { type, isDraw: false, selectedName: jobMode }),
    [jobs, clients, type, jobMode],
  );
  const jobSelectItems = useMemo(() => {
    const map: Record<string, string> = { [NO_JOB]: "No job", [NEW_JOB]: "+ Add new job" };
    for (const o of jobOptions) map[o.value] = o.label;
    return map;
  }, [jobOptions]);

  const selectedClient =
    clientId === NEW_CLIENT
      ? newClient.name
        ? { name: newClient.name, email: newClient.email, address: newClient.address }
        : null
      : (clients.find((c) => c.id === clientId) ?? null);

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

    const jobName = jobMode === NO_JOB ? null : jobMode === NEW_JOB ? newJobName.trim() : jobMode;

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
        // Blank is sent as null; the server stores null, never "".
        notes: notes.trim() || null,
        internal_notes: internalNotes.trim() || null,
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
        if (data.code === "FREE_LIMIT_REACHED") {
          toast.error(data.error, {
            action: { label: "Upgrade", onClick: () => router.push("/billing") },
          });
          return;
        }
        throw new Error(data.error || "Failed to save");
      }

      const saved = data.document as DocumentWithRelations;

      const savedItems = await saveReusableItems(cleanItems.filter((i) => i.saveForReuse));
      const savedItemsFailure = savedItemsFailureMessage(savedItems);
      if (savedItemsFailure) toast.warning(savedItemsFailure);

      toast.success(
        isEditing
          ? `${type === "invoice" ? "Invoice" : "Estimate"} updated`
          : `${type === "invoice" ? "Invoice" : "Estimate"} created`,
      );
      // A type change (Estimate <-> Invoice) moves the document to the
      // other list - always land on the saved document's own real
      // basePath, not the one this page happened to be opened under.
      const savedBasePath = saved.type === "invoice" ? "/dashboard/invoices" : "/dashboard/estimates";
      router.push(`${savedBasePath}/${saved.id}`);
      // The lists, the saved-items picker and the next New form all read
      // server data; drop everything the router cached so none show a copy
      // from before this save.
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  const label = type === "invoice" ? "Invoice" : "Estimate";
  const listLabel = `${label}s`;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={isEditing ? `${basePath}/${document!.id}` : basePath}
          className="inline-flex items-center gap-1 font-mono text-xs font-semibold tracking-wider text-primary uppercase hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to {listLabel}
        </Link>
      </div>

      <div className="flex flex-col gap-4 border-b pb-4.5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-[34px]">
            {isEditing ? `Edit ${label}` : `New ${label}`}
          </h1>
          {selectedClient && (
            <p className="mt-1 font-mono text-xs text-muted-foreground uppercase">
              Billable to {selectedClient.name}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href={isEditing ? `${basePath}/${document!.id}` : basePath} />}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {isEditing ? "Save changes" : `Create ${label}`}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-start">
        {/* Left column - form panels */}
        <div className="space-y-4">
          <Tabs value={type} onValueChange={(v) => v && setType(v as DocumentType)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="estimate">Estimate</TabsTrigger>
              <TabsTrigger value="invoice">Invoice</TabsTrigger>
            </TabsList>
          </Tabs>

          <FormPanel title="Client & Job Details">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="doc-client" className={darkLabelClass}>
                  Client
                </Label>
                <Select
                  items={clientSelectItems}
                  value={clientId}
                  onValueChange={(v) => {
                    if (!v) return;
                    setClientId(v);
                    setClientSource("user");
                  }}
                >
                  <SelectTrigger id="doc-client" className={`w-full ${darkFieldClass}`}>
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
              <div className="space-y-1.5">
                <Label htmlFor="doc-job" className={darkLabelClass}>
                  Associated Job (optional)
                </Label>
                <Select
                  items={jobSelectItems}
                  value={jobMode}
                  onValueChange={(v) => v && handleJobModeChange(v)}
                >
                  <SelectTrigger id="doc-job" className={`w-full ${darkFieldClass}`}>
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
                    className={darkFieldClass}
                    value={newJobName}
                    onChange={(e) => setNewJobName(e.target.value)}
                  />
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doc-place" className={darkLabelClass}>
                  Place of work (optional)
                </Label>
                <Input
                  id="doc-place"
                  placeholder="Fills in from the job's location"
                  maxLength={MAX_PLACE_LENGTH}
                  className={darkFieldClass}
                  value={placeOfWork}
                  onChange={(e) => {
                    setPlaceOfWork(e.target.value);
                    setPlaceEdited(true);
                  }}
                />
              </div>
            </div>

            {clientId === NEW_CLIENT && (
              <div className="grid gap-3 rounded-lg border border-sidebar-border bg-sidebar-accent/30 p-3">
                <div className="space-y-1.5">
                  <Label htmlFor="client-name" className={darkLabelClass}>
                    Name
                  </Label>
                  <Input
                    id="client-name"
                    className={darkFieldClass}
                    value={newClient.name}
                    onChange={(e) => setNewClient({ ...newClient, name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="client-email" className={darkLabelClass}>
                    Email (optional)
                  </Label>
                  <Input
                    id="client-email"
                    type="email"
                    className={darkFieldClass}
                    value={newClient.email}
                    onChange={(e) => setNewClient({ ...newClient, email: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="client-address" className={darkLabelClass}>
                    Address (optional)
                  </Label>
                  <Input
                    id="client-address"
                    className={darkFieldClass}
                    value={newClient.address}
                    onChange={(e) => setNewClient({ ...newClient, address: e.target.value })}
                  />
                </div>
              </div>
            )}
            {clientId !== NEW_CLIENT && selectedClient?.address && (
              <p className="rounded-lg border border-sidebar-border bg-sidebar-accent/30 px-3 py-2 text-xs text-sidebar-foreground/80">
                Client address: {selectedClient.address}
              </p>
            )}
          </FormPanel>

          <FormPanel title="Dates & Terms">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="issue-date" className={darkLabelClass}>
                  Issue Date
                </Label>
                <Input
                  id="issue-date"
                  type="date"
                  className={darkFieldClass}
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="due-date" className={darkLabelClass}>
                  {dueDateLabel(type)} (optional)
                </Label>
                <Input
                  id="due-date"
                  type="date"
                  className={darkFieldClass}
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>
          </FormPanel>

          <FormPanel title={`Line Items · ${items.length} line${items.length === 1 ? "" : "s"}`}>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {savedLineItems.length > 0 && (
                <SavedItemPicker items={savedLineItems} onPick={insertSavedItem} triggerClassName={darkFieldClass} />
              )}
            </div>
            <div className="overflow-hidden rounded-lg border border-border bg-card text-card-foreground">
              {items.map((item, i) => {
                return (
                  <div key={i} className={`space-y-1.5 p-2.5 ${i > 0 ? "border-t border-border" : ""}`}>
                    <LineItemFields
                      value={item}
                      onChange={(patch) => updateItem(i, patch)}
                      onRemove={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
                      totalClassName="font-mono"
                    />
                    {item.name.trim() && (
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Checkbox
                          checked={!!item.saveForReuse}
                          onCheckedChange={(checked) => updateItem(i, { saveForReuse: !!checked })}
                        />
                        Save for next time
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setItems((prev) => [...prev, { ...EMPTY_ITEM }])}
            >
              <Plus className="h-4 w-4" />
              Add New Line Item
            </Button>
          </FormPanel>

          <FormPanel title="Summary & Notes">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-sidebar-foreground/60">Subtotal</span>
                  <span className="font-mono tabular-nums">{formatCurrency(totals.subtotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sidebar-foreground/60">Tax (HST 13%)</span>
                  <span className="font-mono tabular-nums">{formatCurrency(totals.hst)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-sidebar-border pt-2 text-base font-bold">
                  <span>Grand Total Due</span>
                  <span className="font-mono text-lg tabular-nums text-sidebar-primary">
                    {formatCurrency(totals.total)}
                  </span>
                </div>
              </div>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="client-notes" className={darkLabelClass}>
                    Notes to client (shown on the PDF and public page)
                  </Label>
                  <textarea
                    id="client-notes"
                    rows={3}
                    maxLength={4000}
                    placeholder="e.g. Payment terms, what is included, thank you"
                    className={`w-full resize-none rounded-lg border px-3 py-2 text-sm ${darkFieldClass}`}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="internal-notes" className={darkLabelClass}>
                    Internal notes (only you see these)
                  </Label>
                  <textarea
                    id="internal-notes"
                    rows={3}
                    maxLength={4000}
                    placeholder="Never shown to the client, never on the PDF"
                    className={`w-full resize-none rounded-lg border px-3 py-2 text-sm ${darkFieldClass}`}
                    value={internalNotes}
                    onChange={(e) => setInternalNotes(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </FormPanel>
        </div>

        {/* Right column - live preview */}
        <div className="lg:sticky lg:top-4">
          <p className="mb-2 font-mono text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            Live Preview
          </p>
          <Card>
            <CardContent className="space-y-5 p-6">
              {logoPath && (
                <LogoImage
                  key={logoPath}
                  path={logoPath}
                  className="h-14 max-w-[200px] object-contain object-left"
                />
              )}
              <div className="flex items-start justify-between text-sm">
                <div>
                  <p className="font-semibold">{business.name ?? business.email}</p>
                  {business.name && <p className="text-muted-foreground">{business.email}</p>}
                  {business.address && <p className="text-muted-foreground">{business.address}</p>}
                </div>
                <div className="text-right">
                  <p className="font-mono font-semibold text-primary">
                    {label.toUpperCase()}
                    {isEditing && document?.document_number != null && ` #${document.document_number}`}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDate(issueDate)}</p>
                  {dueDate && (
                    <p className="text-xs text-muted-foreground">{type === "estimate" ? "Valid until" : "Due"} {formatDate(dueDate)}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 border-t pt-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Bill To</p>
                  <p className="font-medium">{selectedClient?.name ?? "—"}</p>
                  {selectedClient && "address" in selectedClient && selectedClient.address && (
                    <p className="text-muted-foreground">{selectedClient.address}</p>
                  )}
                </div>
                {jobMode !== NO_JOB && (
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Job Reference</p>
                    <p className="font-medium">
                      {jobMode === NEW_JOB ? newJobName || "—" : jobMode}
                    </p>
                  </div>
                )}
              </div>

              {placeOfWork.trim() && (
                <div className="text-sm">
                  <p className="text-xs text-muted-foreground uppercase">Place of work</p>
                  <p>{placeOfWork.trim()}</p>
                </div>
              )}

              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground uppercase">
                    <th className="pb-2">Description</th>
                    <th className="pb-2 text-right">Qty</th>
                    <th className="hidden pb-2 text-right sm:table-cell">Rate</th>
                    <th className="pb-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items
                    .filter((i) => i.name.trim())
                    .map((item, i) => (
                      <tr key={i} className="border-b border-dashed">
                        <td className="py-2">
                          <LineLabel name={item.name.trim()} description={item.description} />
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {formatQuantity(item.quantity, item.unit)}
                        </td>
                        <td className="hidden py-2 text-right tabular-nums sm:table-cell">
                          {formatCurrency(item.unit_price)}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {formatCurrency((Number(item.quantity) || 0) * (Number(item.unit_price) || 0))}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>

              <div className="ml-auto max-w-xs space-y-1 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="tabular-nums">{formatCurrency(totals.subtotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">HST (13%)</span>
                  <span className="tabular-nums">{formatCurrency(totals.hst)}</span>
                </div>
                <div className="flex items-center justify-between border-t pt-1 text-base font-bold">
                  <span>Total</span>
                  <span className="font-mono tabular-nums text-primary">
                    {formatCurrency(totals.total)}
                  </span>
                </div>
              </div>

              <ClientNotes notes={notes} />

              <div className="border-t pt-4 text-right text-xs text-muted-foreground">
                Signature
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
