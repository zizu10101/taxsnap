"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Client } from "@/lib/database.types";
import { usePathname, useRouter } from "next/navigation";
import { CLIENT_PHONE_MAX_LENGTH } from "@/lib/client-phone";
import { CLIENT_HAS_RECORDS_CODE } from "@/lib/client-delete";

// Edit-only counterpart to NewClientDialog (clients/new-client-dialog.tsx) -
// kept as its own component rather than folding an isEditing flag into that
// one, since NewClientDialog also re-typed its own POST body per that
// file's own comment on why there's no single shared client-form component
// yet; this re-types the same three fields against PATCH instead.
export function EditClientDialog({
  open,
  onOpenChange,
  client,
  onSaved,
  onDeleted,
  hasPortalLogin = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: Client;
  onSaved: (client: Client) => void;
  // Called after the client was deleted (the dialog closes itself).
  onDeleted?: (clientId: string) => void;
  hasPortalLogin?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [name, setName] = useState(client.name);
  const [email, setEmail] = useState(client.email ?? "");
  const [phone, setPhone] = useState(client.phone ?? "");
  const [address, setAddress] = useState(client.address ?? "");
  const [saving, setSaving] = useState(false);
  // Delete is a second VIEW of this dialog (confirm, then a warning if the client has records), not a nested
  // modal: stacked Base UI dialogs fight over focus.
  const [view, setView] = useState<"edit" | "confirm" | "blocked">("edit");
  const [deleting, setDeleting] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState("");

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Enter the client's name.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone, address }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");

      onSaved(data.client as Client);
      toast.success("Client updated");
      router.refresh();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/clients/${client.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.code === CLIENT_HAS_RECORDS_CODE) {
        setBlockedMessage(data.error);
        setView("blocked");
        return;
      }
      if (!res.ok) throw new Error(data.error || "Could not delete the client.");

      toast.success("Client deleted");
      onDeleted?.(client.id);
      router.refresh();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setDeleting(false);
    }
  }

  // Closing from any view starts the next open on the edit form.
  function handleOpenChange(next: boolean) {
    if (!next) setView("edit");
    onOpenChange(next);
  }

  const detailPath = `/dashboard/clients/${client.id}`;

  if (view !== "edit") {
    return (
      <Dialog open={open} onOpenChange={(next) => !deleting && handleOpenChange(next)}>
        <DialogContent className="sm:max-w-sm">
          {view === "confirm" ? (
            <>
              <DialogHeader>
                <DialogTitle>Delete {client.name}?</DialogTitle>
                <DialogDescription>
                  This can&apos;t be undone.
                  {hasPortalLogin && " Their client portal login will be removed too."}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setView("edit")} disabled={deleting}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                  {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Delete
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <TriangleAlert className="h-5 w-5 text-warning" />
                  Can&apos;t delete this client
                </DialogTitle>
                <DialogDescription>{blockedMessage}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                {pathname !== detailPath && (
                  <Button variant="outline" nativeButton={false} render={<Link href={detailPath} />}>
                    View their documents
                  </Button>
                )}
                <Button onClick={() => setView("edit")}>OK</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit client</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="edit-client-name">Name</Label>
            <Input id="edit-client-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-client-email">Email (optional)</Label>
            <Input
              id="edit-client-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-client-phone">Phone (optional)</Label>
            <Input
              id="edit-client-phone"
              type="tel"
              maxLength={CLIENT_PHONE_MAX_LENGTH}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-client-address">Address (optional)</Label>
            <Input
              id="edit-client-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive sm:mr-auto"
            onClick={() => setView("confirm")}
            disabled={saving}
          >
            Delete client
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
