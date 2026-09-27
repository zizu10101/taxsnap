import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatDocumentNumber } from "@/lib/document-number";
import type { DocumentType } from "@/lib/database.types";

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

// Read-only "paper" rendering shared by the two public, unauthenticated
// pages that need it (/sign/[token] and /invoice/[token]) - same visual
// structure as the authenticated DocumentDetail's own paper section
// (logo/From/Bill To/dates/line items/totals), just without any of the
// interactive edit/payment/status controls that page has, since a public
// visitor can't touch any of that here.
export function PublicDocumentPaper({
  type,
  documentNumber,
  issueDate,
  dueDate,
  items,
  subtotal,
  hstAmount,
  totalAmount,
  business,
  client,
  logoUrl,
}: {
  type: DocumentType;
  documentNumber: number;
  issueDate: string;
  dueDate: string | null;
  items: { id: string; description: string; quantity: number; unit_price: number }[];
  subtotal: number;
  hstAmount: number;
  totalAmount: number;
  business: { name: string | null; email: string; phone: string | null; address: string | null };
  client: { name: string; email: string | null; address: string | null } | null;
  logoUrl: string | null;
}) {
  const label = type === "invoice" ? "Invoice" : "Estimate";
  const shortId = formatDocumentNumber(type, documentNumber);

  return (
    <Card>
      <CardContent className="space-y-6 p-6">
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt="Business logo"
            className="h-20 max-w-[260px] object-contain object-left"
          />
        )}

        <div>
          <p className="text-2xl font-bold uppercase tracking-tight">{label}</p>
          <p className="font-mono text-sm text-primary">{shortId}</p>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground uppercase">From</p>
            <p className="font-medium">{business.name ?? business.email}</p>
            {business.name && <p>{business.email}</p>}
            {business.phone && <p>{business.phone}</p>}
            {business.address && <p>{business.address}</p>}
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase">Bill To</p>
            <p className="font-medium">{client?.name ?? "—"}</p>
            {client?.email && <p>{client.email}</p>}
            {client?.address && <p>{client.address}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground uppercase">Issue date</p>
            <p>{formatDate(issueDate)}</p>
          </div>
          {dueDate && (
            <div>
              <p className="text-xs text-muted-foreground uppercase">Due date</p>
              <p>{formatDate(dueDate)}</p>
            </div>
          )}
        </div>

        <Separator />

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground uppercase">
              <th className="pb-2">Description</th>
              <th className="pb-2 text-right">Qty</th>
              <th className="hidden pb-2 text-right sm:table-cell">Unit Price</th>
              <th className="pb-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t align-top">
                <td className="py-2">
                  {item.description}
                  <span className="block font-mono text-[10px] text-muted-foreground sm:hidden">
                    {formatCurrency(item.unit_price)}/unit
                  </span>
                </td>
                <td className="py-2 text-right tabular-nums">{item.quantity}</td>
                <td className="hidden py-2 text-right tabular-nums sm:table-cell">
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
            <span className="tabular-nums">{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">HST (13%)</span>
            <span className="tabular-nums">{formatCurrency(hstAmount)}</span>
          </div>
          <div className="flex items-center justify-between border-t pt-1 text-base font-bold">
            <span>Total</span>
            <span className="font-mono tabular-nums text-primary">
              {formatCurrency(totalAmount)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
