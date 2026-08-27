"use client";

import { useState } from "react";
import { Pencil, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { JobCostNav } from "@/components/jobs/job-cost-nav";
import { EmployeeDialog } from "@/components/employees/employee-dialog";
import type { Employee } from "@/lib/database.types";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function EmployeeList({ initialEmployees }: { initialEmployees: Employee[] }) {
  const [employees, setEmployees] = useState(initialEmployees);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);

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
      if (!res.ok) throw new Error(data.error || "Failed to update");
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
      <JobCostNav active="employees" />

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
                    {formatCurrency(employee.default_hourly_rate)}/hr default rate
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
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        employee={editing}
        onSaved={upsert}
      />
    </div>
  );
}
