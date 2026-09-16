"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { JobCostNav } from "@/components/jobs/job-cost-nav";
import { EmployeeDialog } from "@/components/employees/employee-dialog";
import { UsageLimitBar } from "@/components/dashboard/usage-limit-bar";
import { PLAN_LIMITS } from "@/lib/plan-limits";
import type { Employee, SubscriptionStatus } from "@/lib/database.types";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function EmployeeList({
  initialEmployees,
  subscriptionStatus,
  showNav = true,
}: {
  initialEmployees: Employee[];
  subscriptionStatus: SubscriptionStatus;
  // Off for the onboarding flow, which reuses this list+dialog wholesale
  // but isn't part of the Jobs section's own tab row.
  showNav?: boolean;
}) {
  const [employees, setEmployees] = useState(initialEmployees);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const router = useRouter();

  function upsert(employee: Employee) {
    setEmployees((prev) => {
      const exists = prev.some((e) => e.id === employee.id);
      const next = exists
        ? prev.map((e) => (e.id === employee.id ? employee : e))
        : [...prev, employee];
      return next.sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  async function toggleActive(employee: Employee) {
    try {
      const res = await fetch(`/api/employees/${employee.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !employee.is_active }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Reactivating a deactivated employee is also capped for every
        // tier (see lib/plan-limits.ts) - otherwise the active-employee
        // limit could be bypassed via deactivate-then-reactivate instead
        // of ever using the "New employee" flow twice.
        if (data.code === "FREE_LIMIT_REACHED") {
          toast.error(data.error, {
            action: { label: "Upgrade", onClick: () => router.push("/billing") },
          });
          return;
        }
        throw new Error(data.error || "Failed to update");
      }
      upsert(data.employee as Employee);
      toast.success(employee.is_active ? "Employee deactivated" : "Employee reactivated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  const active = employees.filter((e) => e.is_active);
  const inactive = employees.filter((e) => !e.is_active);

  return (
    <div className="space-y-4">
      {showNav && <JobCostNav active="employees" />}

      <UsageLimitBar
        tier={subscriptionStatus}
        current={active.length}
        limit={PLAN_LIMITS[subscriptionStatus].employees}
        noun="active employee"
      />

      <Button
        className="w-full"
        onClick={() => {
          setEditing(null);
          setDialogOpen(true);
        }}
      >
        <Plus className="h-4 w-4" />
        New employee
      </Button>

      {employees.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <Users className="h-8 w-8" />
            <p className="text-sm">No employees yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {[...active, ...inactive].map((employee) => (
            <Card key={employee.id} className={!employee.is_active ? "opacity-60" : undefined}>
              <CardContent className="flex items-center justify-between gap-3 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{employee.name}</p>
                    {!employee.is_active && <Badge variant="outline">Inactive</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatCurrency(employee.default_hourly_rate)}/hr pay ·{" "}
                    {formatCurrency(employee.default_billable_rate)}/hr billable
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Edit"
                    onClick={() => {
                      setEditing(employee);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toggleActive(employee)}
                  >
                    {employee.is_active ? "Deactivate" : "Reactivate"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <EmployeeDialog
        key={editing?.id ?? "new"}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        employee={editing}
        onSaved={upsert}
      />
    </div>
  );
}
