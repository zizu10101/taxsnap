"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRightLeft,
  Loader2,
  Pencil,
  Printer,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DocumentBuilder } from "@/components/invoices/document-builder";
import { LogoImage } from "@/components/invoices/business-logo";
import type {
  Client,
  DocumentStatus,
  DocumentWithRelations,
} from "@/lib/database.types";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function DocumentDetail({
  document,
  clients,
  fromEmail,
  logoPath,
  basePath,
}: {
  document: DocumentWithRelations;
  clients: Client[];
  fromEmail: string;
  logoPath: string | null;
  basePath: string;
}) {
  const router = useRouter();
  const [doc, setDoc] = useState(document);
  const [allClients, setAllClients] = useState(clients);
  const [editorOpen, setEditorOpen] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const label = doc.type === "invoice" ? "Invoice" : "Estimate";
  const shortId = doc.id.slice(0, 8).toUpperCase();

  async function handleStatusChange(status: DocumentStatus) {
    setStatusSaving(true);
    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update status");
      setDoc((prev) => ({ ...prev, status: data.document.status }));
      toast.success(`Marked as ${status}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleConvert() {
    setConverting(true);
    try {
      const res = await fetch(`/api/documents/${doc.id}/convert`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to convert");
      toast.success("Converted to a draft invoice");
      router.push(`/dashboard/invoices/${data.document.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setConverting(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/documents/${doc.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete");
      }
      toast.success(`${label} deleted`);
      router.push(basePath);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link
          href={basePath}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to {label.toLowerCase()}s
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={doc.status}
            onValueChange={(v) => v && handleStatusChange(v as DocumentStatus)}
          >
            <SelectTrigger className="h-8 w-28" disabled={statusSaving}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => setEditorOpen(true)}>
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
          {doc.type === "estimate" && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleConvert}
              disabled={converting}
            >
              {converting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRightLeft className="h-4 w-4" />
              )}
              Convert to Invoice
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Print
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDelete}
            disabled={deleting}
            className="text-destructive hover:text-destructive"
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Delete
          </Button>
        </div>
      </div>

      <Card className="print:border-none print:shadow-none">
        <CardContent className="space-y-6 p-6 print:p-0">
          {logoPath && (
            <LogoImage
              key={logoPath}
              path={logoPath}
              className="h-12 max-w-[200px] object-contain object-left"
            />
          )}

          <div className="flex items-start justify-between">
            <div>
              <p className="text-2xl font-bold uppercase tracking-tight">
                {label}
              </p>
              <p className="text-sm text-muted-foreground">#{shortId}</p>
            </div>
            <Badge className="print:hidden">{doc.status}</Badge>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground uppercase">From</p>
              <p>{fromEmail}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Bill To</p>
              <p className="font-medium">{doc.client?.name ?? "—"}</p>
              {doc.client?.email && <p>{doc.client.email}</p>}
              {doc.client?.address && <p>{doc.client.address}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground uppercase">
                Issue date
              </p>
              <p>{formatDate(doc.issue_date)}</p>
            </div>
            {doc.due_date && (
              <div>
                <p className="text-xs text-muted-foreground uppercase">
                  Due date
                </p>
                <p>{formatDate(doc.due_date)}</p>
              </div>
            )}
          </div>

          <Separator />

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground uppercase">
                <th className="pb-2">Description</th>
                <th className="pb-2 text-right">Qty</th>
                <th className="pb-2 text-right">Unit Price</th>
                <th className="pb-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {doc.items.map((item) => (
                <tr key={item.id} className="border-t">
                  <td className="py-2">{item.description}</td>
                  <td className="py-2 text-right tabular-nums">{item.quantity}</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatCurrency(item.unit_price)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatCurrency(item.quantity * item.unit_price)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <Separator />

          <div className="ml-auto max-w-xs space-y-1 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="tabular-nums">{formatCurrency(doc.subtotal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">HST (13%)</span>
              <span className="tabular-nums">
                {formatCurrency(doc.hst_amount)}
              </span>
            </div>
            <div className="flex items-center justify-between text-base font-semibold">
              <span>Total</span>
              <span className="tabular-nums">
                {formatCurrency(doc.total_amount)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <DocumentBuilder
        open={editorOpen}
        onOpenChange={setEditorOpen}
        defaultType={doc.type}
        document={doc}
        clients={allClients}
        onSaved={(updated) => setDoc(updated)}
        onClientCreated={(client) => setAllClients((prev) => [...prev, client])}
      />
    </div>
  );
}
