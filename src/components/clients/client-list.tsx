"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NewClientDialog } from "@/components/clients/new-client-dialog";
import { EditClientDialog } from "@/components/clients/edit-client-dialog";
import {
  ClientWorkstation,
  type ClientHistoryDoc,
} from "@/components/clients/client-workstation";
import { UsageLimitBar } from "@/components/dashboard/usage-limit-bar";
import { PLAN_LIMITS } from "@/lib/plan-limits";
import { getEmptyClientSummary } from "@/lib/client-summary";
import type { Client, SubscriptionStatus } from "@/lib/database.types";
import type { ClientSummary } from "@/lib/client-summary";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function ClientList({
  initialClients,
  subscriptionStatus,
  summaries,
  recentDocsByClient,
  portalClientIds,
}: {
  initialClients: Client[];
  subscriptionStatus: SubscriptionStatus;
  summaries: Record<string, ClientSummary>;
  recentDocsByClient: Record<string, ClientHistoryDoc[]>;
  // Clients who currently have a portal login (shown as a small badge).
  portalClientIds: string[];
}) {
  const router = useRouter();
  const [clients, setClients] = useState(initialClients);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);

  return (
    <div className="space-y-4">
      <UsageLimitBar
        tier={subscriptionStatus}
        current={clients.length}
        limit={PLAN_LIMITS[subscriptionStatus].clients}
        noun="client"
      />

      <div className="space-y-3 lg:hidden">
        <Button className="w-full" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          New client
        </Button>

        {clients.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <Users className="h-8 w-8" />
              <p className="text-sm">No clients yet. Add one to start invoicing.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {clients.map((client) => {
              const summary = summaries[client.id] ?? getEmptyClientSummary();
              return (
                <Card
                  key={client.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/dashboard/clients/${client.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      router.push(`/dashboard/clients/${client.id}`);
                    }
                  }}
                  className="cursor-pointer outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
                >
                  <CardContent className="flex items-center justify-between gap-3 py-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 font-medium">
                          <span className="truncate">{client.name}</span>
                          {portalClientIds.includes(client.id) && (
                            <Badge variant="secondary" className="shrink-0">
                              Portal
                            </Badge>
                          )}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {summary.invoiceCount} invoice{summary.invoiceCount === 1 ? "" : "s"}
                          {summary.outstandingBalance > 0 &&
                            ` · ${formatCurrency(summary.outstandingBalance)} due`}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-semibold text-success tabular-nums">
                        {formatCurrency(summary.totalRevenue)}
                      </span>
                      {/* stopPropagation (click and key) - the whole card
                          navigates to the detail page, and Enter/Space on this
                          button would otherwise bubble to the card's handler. */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingClient(client);
                        }}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <div className="hidden lg:block">
        <Button className="mb-3 w-full max-w-xs" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          New client
        </Button>
        <ClientWorkstation
          clients={clients}
          summaries={summaries}
          recentDocsByClient={recentDocsByClient}
          onEdit={setEditingClient}
        />
      </div>

      {editingClient && (
        <EditClientDialog
          key={editingClient.id}
          open
          onOpenChange={(open) => {
            if (!open) setEditingClient(null);
          }}
          client={editingClient}
          onSaved={(saved) =>
            setClients((prev) =>
              prev.map((c) => (c.id === saved.id ? saved : c)).sort((a, b) => a.name.localeCompare(b.name)),
            )
          }
        />
      )}

      <NewClientDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={(client) => {
          setClients((prev) => [...prev, client].sort((a, b) => a.name.localeCompare(b.name)));
          router.push(`/dashboard/clients/${client.id}`);
        }}
      />
    </div>
  );
}
