"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Package, Scissors, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CommissionNav } from "@/components/commission/commission-nav";
import { FieldTrail, PriceTrail, EditedBadge } from "@/components/commission/entry-trail";
import { EditEntryDialog } from "@/components/commission/edit-entry-dialog";
import { useAppLock } from "@/components/app-lock/app-lock-context";
import { getPresetRange, rangeToUtcBounds } from "@/lib/date-range";
import { ONTARIO_HST_RATE } from "@/lib/hst";
import type {
  CommissionEntryWithRelations,
  Product,
  RegisterTransaction,
  RegisterTransactionProduct,
  Service,
  StylistPublic,
} from "@/lib/database.types";

// Reference/reporting only (see 0024_commission_payment_tax.sql) - not fed
// into sales/documents/payments or lib/hst.ts's real HST calculation.
const PAYMENT_METHODS = ["Cash", "Debit", "E-transfer", "Visa", "Mastercard", "Amex"] as const;

type CartItem =
  | { cartId: string; kind: "service"; service: Service; stylist: StylistPublic }
  | { cartId: string; kind: "product"; product: Product };

// The register-transactions GET's own nested shape - see
// GET /api/register-transactions.
type TransactionWithProducts = RegisterTransaction & {
  register_transaction_products: RegisterTransactionProduct[];
};

// Today's entries is a merge of two sources (service taps still live in
// commission_entries, product taps only ever live in
// register_transaction_products) sorted back into one timeline for
// display - see the todaysEntries/todaysProducts state below.
type TodayItem =
  | { kind: "service"; entry: CommissionEntryWithRelations }
  | { kind: "product"; product: RegisterTransactionProduct; transactionId: string };

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function cartItemPrice(item: CartItem): number {
  return item.kind === "service" ? item.service.default_price : item.product.default_price;
}

function cartItemLabel(item: CartItem): string {
  return item.kind === "service" ? item.service.name : item.product.name;
}

// Same format as commission-reports.tsx/invoice-pdf.ts's formatDateTime -
// always includes the date (not just the time) since a shift can run past
// midnight, in which case "Today's entries" would otherwise show two
// different calendar days' entries with identical-looking timestamps.
function formatDateTime(isoStr: string) {
  return new Date(isoStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type Screen =
  | { type: "cart" }
  | { type: "pick-service" }
  | { type: "pick-stylist"; service: Service }
  | { type: "pick-product" }
  | { type: "checkout-payment" }
  | { type: "checkout-details"; paymentMethod: string };

export function CommissionLogger({
  initialServices,
  initialStylists,
  initialProducts,
  isPro,
}: {
  initialServices: Service[];
  initialStylists: StylistPublic[];
  initialProducts: Product[];
  // Only threaded through to CommissionNav, to show/hide the Overview tab.
  isPro: boolean;
}) {
  // Create-flow state only, below - editing an existing entry (Today's
  // entries) is a fully separate EditEntryDialog with its own state, not a
  // reuse of this. See editingEntry further down and the dialog's own
  // comment for why: the old shared-state version of this had a real bug
  // where backing out of an edit could silently create a duplicate entry
  // instead of canceling.
  const [cart, setCart] = useState<CartItem[]>([]);
  const [screen, setScreen] = useState<Screen>({ type: "cart" });
  const [customerName, setCustomerName] = useState("");
  // Defaults off - the till doesn't know a sale was taxed until someone
  // actively says so, same "don't assume" reasoning as leaving
  // customer_name blank rather than guessing.
  const [taxApplied, setTaxApplied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { role } = useAppLock();
  const isStaffMode = role === "staff";

  // Today's entries is staff-mode only (see CommissionLogger's caller) -
  // the owner already has the full Reports tab for this, staff only ever
  // reach the Log page. Fetched client-side since role is client-only
  // state; the server-rendered page has no way to know it in advance.
  const [todaysEntries, setTodaysEntries] = useState<CommissionEntryWithRelations[]>([]);
  const [todaysProducts, setTodaysProducts] = useState<
    { product: RegisterTransactionProduct; transactionId: string }[]
  >([]);
  // The entry currently open in EditEntryDialog, or null. The dialog is
  // only ever mounted while this is set (`{editingEntry && <EditEntryDialog .../>}`
  // below), so it always gets a fresh mount - and fresh local state seeded
  // from `entry` - per edit, and fully unmounts (discarding that state) on
  // cancel/close/save.
  const [editingEntry, setEditingEntry] = useState<CommissionEntryWithRelations | null>(null);

  useEffect(() => {
    if (!isStaffMode) return;
    const { from, to } = rangeToUtcBounds(getPresetRange("today"));
    fetch(`/api/commission-entries?from=${from}&to=${to}`)
      .then((res) => res.json())
      .then((data) => setTodaysEntries(data.entries ?? []));
    fetch(`/api/register-transactions?from=${from}&to=${to}`)
      .then((res) => res.json())
      .then((data) => {
        const transactions = (data.transactions ?? []) as TransactionWithProducts[];
        setTodaysProducts(
          transactions.flatMap((t) =>
            t.register_transaction_products.map((product) => ({
              product,
              transactionId: t.id,
            })),
          ),
        );
      });
  }, [isStaffMode]);

  // Undoes the whole cart transaction at once (every service + product
  // line item on it), not just one row - see DELETE
  // /api/register-transactions/[id].
  async function handleUndoTransaction(transactionId: string) {
    try {
      const res = await fetch(`/api/register-transactions/${transactionId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to undo");
      setTodaysEntries((prev) => prev.filter((e) => e.transaction_id !== transactionId));
      setTodaysProducts((prev) => prev.filter((p) => p.transactionId !== transactionId));
      toast.success("Sale removed");
    } catch {
      toast.error("Failed to undo - the sale is still logged.");
    }
  }

  // The dialog reports back the three fields once Save is tapped; this is
  // the only place that actually calls PATCH. Throwing on failure lets the
  // dialog's own try/catch show the error inline and keep itself open for
  // a retry, instead of losing the in-progress selection.
  async function handleSaveEdit(values: {
    service_id: string;
    stylist_id: string;
    customer_name: string;
  }) {
    if (!editingEntry) return;
    const res = await fetch(`/api/commission-entries/${editingEntry.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to save changes");

    const updated = data.entry as CommissionEntryWithRelations;
    setTodaysEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    toast.success(`Updated: ${updated.service_name} → ${updated.stylist.name}`);
    setEditingEntry(null);
  }

  function addServiceToCart(service: Service, stylist: StylistPublic) {
    setCart((prev) => [
      ...prev,
      { cartId: `service-${service.id}-${stylist.id}-${prev.length}`, kind: "service", service, stylist },
    ]);
    setScreen({ type: "cart" });
  }

  function addProductToCart(product: Product) {
    setCart((prev) => [
      ...prev,
      { cartId: `product-${product.id}-${prev.length}`, kind: "product", product },
    ]);
    setScreen({ type: "cart" });
  }

  function removeFromCart(cartId: string) {
    setCart((prev) => prev.filter((item) => item.cartId !== cartId));
  }

  async function handleSubmit(paymentMethod: string) {
    if (cart.length === 0) return;
    setSubmitting(true);
    try {
      const items = cart.map((item) =>
        item.kind === "service"
          ? { kind: "service" as const, service_id: item.service.id, stylist_id: item.stylist.id }
          : { kind: "product" as const, product_id: item.product.id },
      );

      const res = await fetch("/api/register-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items,
          customer_name: customerName.trim() || undefined,
          payment_method: paymentMethod,
          tax_applied: taxApplied,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to log");

      const transaction = data.transaction as RegisterTransaction;
      const entries = data.entries as CommissionEntryWithRelations[];
      const products = data.products as RegisterTransactionProduct[];

      const summary = cart.map(cartItemLabel).join(" + ");
      toast.success(`Logged: ${summary}, ${formatCurrency(transaction.total_amount)}`, {
        action: { label: "Undo", onClick: () => handleUndoTransaction(transaction.id) },
      });

      if (isStaffMode) {
        setTodaysEntries((prev) => [...entries, ...prev]);
        setTodaysProducts((prev) => [
          ...products.map((product) => ({ product, transactionId: transaction.id })),
          ...prev,
        ]);
      }

      setCart([]);
      setCustomerName("");
      setTaxApplied(false);
      setScreen({ type: "cart" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to log sale");
      // Stay on this step, keep whatever was typed - a failed save
      // shouldn't make the owner retype the customer name.
    } finally {
      setSubmitting(false);
    }
  }

  const cartTotal = round2(cart.reduce((sum, item) => sum + cartItemPrice(item), 0));
  const cartTax = taxApplied ? round2(cartTotal * ONTARIO_HST_RATE) : 0;

  const todayItems: TodayItem[] = [
    ...todaysEntries.map((entry) => ({ kind: "service" as const, entry })),
    ...todaysProducts.map(({ product, transactionId }) => ({
      kind: "product" as const,
      product,
      transactionId,
    })),
  ].sort((a, b) => {
    const aDate = a.kind === "service" ? a.entry.created_at : a.product.created_at;
    const bDate = b.kind === "service" ? b.entry.created_at : b.product.created_at;
    return new Date(bDate).getTime() - new Date(aDate).getTime();
  });

  const canAddService = initialServices.length > 0 && initialStylists.length > 0;
  const canAddProduct = initialProducts.length > 0;

  if (!canAddService && !canAddProduct) {
    return (
      <div className="space-y-4">
        <CommissionNav active="log" isPro={isPro} />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="font-medium">Set up services or products first</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              Add at least one active service (with an active stylist to assign it to) or
              product before you can ring up a sale.
            </p>
            {/* Staff can't reach Services/Products/Stylists (route-gated
                back to here anyway) - these links would be dead ends in
                staff mode, so they're omitted rather than shown and
                bounced. */}
            {!isStaffMode && (
              <div className="flex flex-wrap justify-center gap-2">
                {initialServices.length === 0 && (
                  <Button nativeButton={false} render={<Link href="/dashboard/commission/services" />}>
                    Add services
                  </Button>
                )}
                {initialServices.length > 0 && initialStylists.length === 0 && (
                  <Button nativeButton={false} render={<Link href="/dashboard/commission/stylists" />}>
                    Add stylists
                  </Button>
                )}
                {initialProducts.length === 0 && (
                  <Button nativeButton={false} render={<Link href="/dashboard/commission/products" />}>
                    Add products
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <CommissionNav active="log" isPro={isPro} />

      {screen.type === "checkout-details" ? (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setScreen({ type: "checkout-payment" })}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            {cart.map(cartItemLabel).join(" + ")} → {screen.paymentMethod}
          </button>
          <p className="text-sm text-muted-foreground">
            {taxApplied
              ? `${formatCurrency(cartTotal)} + ${formatCurrency(cartTax)} HST = ${formatCurrency(round2(cartTotal + cartTax))}`
              : formatCurrency(cartTotal)}
          </p>
          <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5">
            <Label htmlFor="tax-applied" className="text-sm font-medium">
              Tax applied (HST)
            </Label>
            <Switch id="tax-applied" checked={taxApplied} onCheckedChange={setTaxApplied} />
          </div>
          <Input
            autoFocus
            placeholder="Customer name (optional)"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
          />
          <Button
            className="w-full"
            size="lg"
            onClick={() => handleSubmit(screen.paymentMethod)}
            disabled={submitting}
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Submit
          </Button>
        </div>
      ) : screen.type === "checkout-payment" ? (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setScreen({ type: "cart" })}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            {cart.map(cartItemLabel).join(" + ")} — pick a payment method
          </button>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {PAYMENT_METHODS.map((method) => (
              <button
                key={method}
                type="button"
                onClick={() => setScreen({ type: "checkout-details", paymentMethod: method })}
                className="flex h-24 flex-col items-center justify-center gap-1 rounded-lg border border-border bg-card p-3 text-center font-medium transition-colors hover:bg-muted/50 active:scale-[0.98]"
              >
                {method}
              </button>
            ))}
          </div>
        </div>
      ) : screen.type === "pick-stylist" ? (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setScreen({ type: "pick-service" })}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            {screen.service.name} — pick a stylist
          </button>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {initialStylists.map((stylist) => (
              <button
                key={stylist.id}
                type="button"
                onClick={() => addServiceToCart(screen.service, stylist)}
                className="flex h-24 flex-col items-center justify-center gap-1 rounded-lg border border-border bg-card p-3 text-center font-medium transition-colors hover:bg-muted/50 active:scale-[0.98]"
              >
                {stylist.name}
              </button>
            ))}
          </div>
        </div>
      ) : screen.type === "pick-service" ? (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setScreen({ type: "cart" })}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            Pick a service
          </button>
          <div className="grid max-h-[70vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
            {initialServices.map((service) => (
              <button
                key={service.id}
                type="button"
                onClick={() => setScreen({ type: "pick-stylist", service })}
                className="flex h-24 flex-col items-center justify-center gap-1 rounded-lg border-2 p-3 text-center font-medium text-foreground transition-transform active:scale-[0.98]"
                style={{
                  borderColor: service.color,
                  backgroundColor: `color-mix(in oklch, ${service.color}, transparent 88%)`,
                }}
              >
                <span className="line-clamp-2">{service.name}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatCurrency(service.default_price)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : screen.type === "pick-product" ? (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setScreen({ type: "cart" })}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            Pick a product
          </button>
          <div className="grid max-h-[70vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
            {initialProducts.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => addProductToCart(product)}
                className="flex h-24 flex-col items-center justify-center gap-1 rounded-lg border-2 border-border bg-card p-3 text-center font-medium text-foreground transition-transform active:scale-[0.98]"
              >
                <span className="line-clamp-2">{product.name}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatCurrency(product.default_price)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {cart.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
                <p className="text-sm">Add a service or product to start a sale.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {cart.map((item) => (
                <div
                  key={item.cartId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {item.kind === "service" ? (
                      <Scissors className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{cartItemLabel(item)}</p>
                      {item.kind === "service" && (
                        <p className="truncate text-xs text-muted-foreground">
                          {item.stylist.name}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm tabular-nums">
                      {formatCurrency(cartItemPrice(item))}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFromCart(item.cartId)}
                      aria-label={`Remove ${cartItemLabel(item)}`}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between px-1 text-sm font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{formatCurrency(cartTotal)}</span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              disabled={!canAddService}
              onClick={() => setScreen({ type: "pick-service" })}
            >
              Add Service
            </Button>
            <Button
              variant="outline"
              disabled={!canAddProduct}
              onClick={() => setScreen({ type: "pick-product" })}
            >
              Add Product
            </Button>
          </div>

          <Button
            className="w-full"
            size="lg"
            disabled={cart.length === 0}
            onClick={() => setScreen({ type: "checkout-payment" })}
          >
            Checkout
          </Button>
        </div>
      )}

      {isStaffMode && (
        <div className="space-y-2 border-t border-border pt-4">
          <h2 className="text-sm font-semibold text-muted-foreground">Today&apos;s entries</h2>
          {todayItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">No entries logged yet today.</p>
          ) : (
            <div className="space-y-2">
              {todayItems.map((item) => {
                if (item.kind === "product") {
                  return (
                    <div
                      key={item.product.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{item.product.product_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(item.product.created_at)}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm tabular-nums">
                        {formatCurrency(item.product.price_charged)}
                      </span>
                    </div>
                  );
                }

                const entry = item.entry;
                const isPaid = !!entry.payout_id;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    disabled={isPaid}
                    onClick={() => setEditingEntry(entry)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 enabled:hover:bg-muted/50 enabled:active:scale-[0.99]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        <FieldTrail
                          original={entry.original_service_name}
                          current={entry.service_name}
                        />
                        {entry.edited_at && <EditedBadge className="ml-1.5 align-middle" />}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        <FieldTrail
                          original={entry.original_stylist_name}
                          current={entry.stylist.name}
                        />
                        {entry.customer_name ? ` · ${entry.customer_name}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(entry.created_at)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-sm tabular-nums">
                      <PriceTrail
                        original={entry.original_price}
                        current={entry.price_charged}
                        format={formatCurrency}
                      />
                      {isPaid && (
                        <span className="block text-xs text-muted-foreground">Paid</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {editingEntry && (
        <EditEntryDialog
          entry={editingEntry}
          services={initialServices}
          stylists={initialStylists}
          open
          onOpenChange={(open) => !open && setEditingEntry(null)}
          onSave={handleSaveEdit}
        />
      )}
    </div>
  );
}
