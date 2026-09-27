"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Package, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CommissionNav } from "@/components/commission/commission-nav";
import { ProductDialog } from "@/components/commission/product-dialog";
import { UsageLimitBar } from "@/components/dashboard/usage-limit-bar";
import { PLAN_LIMITS } from "@/lib/plan-limits";
import type { Product, SubscriptionStatus } from "@/lib/database.types";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function ProductList({
  initialProducts,
  subscriptionStatus = "free",
  isPro = false,
}: {
  initialProducts: Product[];
  // Drives the usage bar's cap (1/3/unlimited active products - see
  // src/lib/plan-limits.ts). Defaults to "free", same as ServiceList.
  subscriptionStatus?: SubscriptionStatus;
  // Only threaded through to CommissionNav (Overview tab visibility).
  isPro?: boolean;
}) {
  const [products, setProducts] = useState(initialProducts);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const router = useRouter();

  function upsert(product: Product) {
    setProducts((prev) => {
      const exists = prev.some((p) => p.id === product.id);
      const next = exists
        ? prev.map((p) => (p.id === product.id ? product : p))
        : [...prev, product];
      return next.sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  async function toggleActive(product: Product) {
    try {
      const res = await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !product.is_active }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "FREE_LIMIT_REACHED") {
          toast.error(data.error, {
            action: { label: "Upgrade", onClick: () => router.push("/billing") },
          });
          return;
        }
        throw new Error(data.error || "Failed to update");
      }
      upsert(data.product as Product);
      toast.success(product.is_active ? "Product deactivated" : "Product reactivated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  const active = products.filter((p) => p.is_active);
  const inactive = products.filter((p) => !p.is_active);

  return (
    <div className="space-y-4">
      <CommissionNav active="products" isPro={isPro} />

      <UsageLimitBar
        tier={subscriptionStatus}
        current={active.length}
        limit={PLAN_LIMITS[subscriptionStatus].activeProducts}
        noun="active product"
      />

      <Button
        className="w-full"
        onClick={() => {
          setEditing(null);
          setDialogOpen(true);
        }}
      >
        <Plus className="h-4 w-4" />
        New product
      </Button>

      {products.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <Package className="h-8 w-8" />
            <p className="text-sm">No products yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {[...active, ...inactive].map((product) => (
            <Card key={product.id} className={!product.is_active ? "opacity-60" : undefined}>
              <CardContent className="flex items-center justify-between gap-3 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{product.name}</p>
                    {!product.is_active && <Badge variant="outline">Inactive</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatCurrency(product.default_price)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Edit"
                    onClick={() => {
                      setEditing(product);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toggleActive(product)}
                  >
                    {product.is_active ? "Deactivate" : "Reactivate"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ProductDialog
        key={editing?.id ?? "new"}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        product={editing}
        onSaved={upsert}
      />
    </div>
  );
}
