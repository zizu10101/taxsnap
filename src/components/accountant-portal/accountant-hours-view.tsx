"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DateRangeFilter } from "@/components/dashboard/date-range-filter";
import { formatCurrency, formatDate, formatHours } from "@/components/accountant-portal/format";
import { getPresetRange, filterByRange, type DateRange, type RangePreset } from "@/lib/date-range";
import type { AccountantHourRow } from "@/lib/accountant-portal-server";

const ALL = "all";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Hours and labor cost, read-only. No PINs, no clock sessions, no edit or
// delete - just who worked how long on what, and what it cost.
export function AccountantHoursView({ entries }: { entries: AccountantHourRow[] }) {
  const [preset, setPreset] = useState<RangePreset>("this-year");
  const [range, setRange] = useState<DateRange>(() => getPresetRange("this-year"));
  const [employee, setEmployee] = useState(ALL);

  const employees = useMemo(
    () => [...new Set(entries.map((e) => e.employee_name))].sort((a, b) => a.localeCompare(b)),
    [entries],
  );
  const employeeItems = useMemo(
    () => ({ [ALL]: "All employees", ...Object.fromEntries(employees.map((n) => [n, n])) }),
    [employees],
  );

  const visible = useMemo(
    () =>
      filterByRange(entries, range, "work_date").filter(
        (e) => employee === ALL || e.employee_name === employee,
      ),
    [entries, range, employee],
  );

  const totals = useMemo(() => {
    const byEmployee = new Map<string, { hours: number; cost: number }>();
    let hours = 0;
    let cost = 0;
    for (const e of visible) {
      hours += e.hours;
      cost += e.labor_cost;
      const row = byEmployee.get(e.employee_name) ?? { hours: 0, cost: 0 };
      row.hours += e.hours;
      row.cost += e.labor_cost;
      byEmployee.set(e.employee_name, row);
    }
    return {
      hours,
      cost,
      byEmployee: [...byEmployee.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    };
  }, [visible]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <DateRangeFilter
          preset={preset}
          range={range}
          onChange={(nextPreset, nextRange) => {
            setPreset(nextPreset);
            setRange(nextRange);
          }}
        />
        <Select items={employeeItems} value={employee} onValueChange={(v) => setEmployee(v ?? ALL)}>
          <SelectTrigger className="w-full lg:w-56" aria-label="Employee">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All employees</SelectItem>
            {employees.map((n) => (
              <SelectItem key={n} value={n}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-sm text-muted-foreground">
        <span>
          {visible.length} entr{visible.length === 1 ? "y" : "ies"}
        </span>
        <span>
          <span className="font-medium text-foreground tabular-nums">{formatHours(totals.hours)}</span>
          {" · "}Labor cost{" "}
          <span className="font-medium text-foreground tabular-nums">
            {formatCurrency(round2(totals.cost))}
          </span>
        </span>
      </div>

      {totals.byEmployee.length > 1 && (
        <Card>
          <CardContent className="space-y-1 py-3 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              By employee
            </p>
            {totals.byEmployee.map(([name, t]) => (
              <div key={name} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">{name}</span>
                <span className="tabular-nums">
                  {formatHours(t.hours)} · {formatCurrency(round2(t.cost))}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          {visible.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No hours match these filters.
            </p>
          ) : (
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Employee</th>
                  <th className="px-3 py-2 font-medium">Job</th>
                  <th className="px-3 py-2 text-right font-medium">Hours</th>
                  <th className="px-3 py-2 text-right font-medium">Rate</th>
                  <th className="px-3 py-2 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => (
                  <tr key={e.id} className="border-b last:border-0">
                    <td className="whitespace-nowrap px-3 py-2">{formatDate(e.work_date)}</td>
                    <td className="px-3 py-2">{e.employee_name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{e.job_name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatHours(e.hours)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(e.rate)}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {formatCurrency(e.labor_cost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
