"use client";

import { useState, useSyncExternalStore } from "react";
import { Copy, KeyRound, Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmployeePinDialog } from "@/components/employees/employee-pin-dialog";

type EmployeeLite = { id: string; name: string };

const subscribeNoop = () => () => {};
const getOrigin = () => window.location.origin;
const getServerOrigin = () => "";

export function EmployeeLoginSettings({
  initialToken,
  employees,
  pinEmployeeIds,
}: {
  initialToken: string | null;
  // Active employees only.
  employees: EmployeeLite[];
  pinEmployeeIds: string[];
}) {
  const origin = useSyncExternalStore(subscribeNoop, getOrigin, getServerOrigin);
  const [token, setToken] = useState(initialToken);
  const [linkBusy, setLinkBusy] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [pinIds, setPinIds] = useState(() => new Set(pinEmployeeIds));
  const [selectedId, setSelectedId] = useState("");
  const [dialog, setDialog] = useState<{ employee: EmployeeLite; mode: "create" | "reset" } | null>(
    null,
  );
  const [removingId, setRemovingId] = useState<string | null>(null);

  // The creation list only ever offers employees with no PIN yet - once one
  // is set, that employee moves to the "has a PIN" list below and is only
  // reachable through reset/remove. (The server enforces this too: creating
  // twice is rejected with PIN_ALREADY_SET.)
  const withoutPin = employees.filter((e) => !pinIds.has(e.id));
  const withPin = employees.filter((e) => pinIds.has(e.id));
  const withoutPinItems = Object.fromEntries(withoutPin.map((e) => [e.id, e.name]));
  const link = token ? `${origin}/employee-login/${token}` : "";

  async function requestLink(regenerate: boolean) {
    setLinkBusy(true);
    try {
      const res = await fetch("/api/employee-login-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't create the link.");
      setToken(data.token);
      setConfirmRegen(false);
      if (regenerate) toast.success("New link created. The old one no longer works.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLinkBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy. Select the link and copy it manually.");
    }
  }

  async function removeLogin(employee: EmployeeLite) {
    setRemovingId(employee.id);
    try {
      const res = await fetch(`/api/employees/${employee.id}/pin`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't remove the login.");
      setPinIds((prev) => {
        const next = new Set(prev);
        next.delete(employee.id);
        return next;
      });
      toast.success(`${employee.name} can no longer sign in`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4" />
          Employee login
        </CardTitle>
        <CardDescription>
          Employees clock in and out of jobs with a shared link and their own 4-digit PIN. They
          can&apos;t see anything else in your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>Shared sign-in link</Label>
          {token ? (
            <>
              <div className="flex gap-2">
                <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
                <Button variant="outline" size="icon" title="Copy link" onClick={copyLink}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Share this one link with everyone on your team. It keeps working until you
                regenerate it.
              </p>
              {confirmRegen ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-destructive">
                    The old link stops working and everyone is signed out.
                  </span>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={linkBusy}
                    onClick={() => requestLink(true)}
                  >
                    {linkBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                    Yes, regenerate
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setConfirmRegen(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setConfirmRegen(true)}>
                  Regenerate link
                </Button>
              )}
            </>
          ) : (
            <Button onClick={() => requestLink(false)} disabled={linkBusy}>
              {linkBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Link2 className="h-4 w-4" />
              )}
              Create sign-in link
            </Button>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="pin-employee">Set up an employee</Label>
          {employees.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Add employees on the Employees page first.
            </p>
          ) : withoutPin.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Everyone has a PIN. Reset or remove one below.
            </p>
          ) : (
            <div className="flex gap-2">
              <Select
                items={withoutPinItems}
                value={selectedId}
                onValueChange={(v) => setSelectedId(v ?? "")}
              >
                <SelectTrigger id="pin-employee" className="w-full">
                  <SelectValue placeholder="Choose an employee" />
                </SelectTrigger>
                <SelectContent>
                  {withoutPin.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={!selectedId}
                onClick={() => {
                  const employee = withoutPin.find((e) => e.id === selectedId);
                  if (employee) setDialog({ employee, mode: "create" });
                }}
              >
                Set PIN
              </Button>
            </div>
          )}
        </div>

        {withPin.length > 0 && (
          <div className="space-y-2">
            <Label>Employees who can sign in</Label>
            <ul className="divide-y rounded-lg border">
              {withPin.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">{e.name}</span>
                    <Badge variant="secondary">PIN set</Badge>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDialog({ employee: e, mode: "reset" })}
                    >
                      Reset PIN
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={removingId === e.id}
                      onClick={() => removeLogin(e)}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>

      <EmployeePinDialog
        employee={dialog?.employee ?? null}
        mode={dialog?.mode ?? "create"}
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
        onDone={(id) => {
          setPinIds((prev) => new Set(prev).add(id));
          setSelectedId("");
        }}
      />
    </Card>
  );
}
