"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ChoiceCard } from "@/components/ui/choice-card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { getNavItems } from "@/components/dashboard/nav-config";
import {
  MENU_TAB_DESCRIPTIONS,
  hiddenFromVisible,
  manageableMenuKeys,
  visibleFromHidden,
  type MenuTabKey,
} from "@/lib/menu-customize";

// How many records sit behind a tab, so hiding one that still has data asks first.
// Only Settings passes this; the sidebar, mobile drawer and onboarding pass nothing
// (so they run no extra queries and never show the warning).
export type MenuRecordCounts = Partial<Record<MenuTabKey, { count: number; noun: string }>>;

const ITEMS = getNavItems({ businessType: "general", isPro: true });
const ITEM_BY_KEY = new Map(ITEMS.map((i) => [i.key, i]));

// The shared "Customize menu" list: one selectable card per tab (the same ChoiceCard as
// onboarding's goals step), a count with "Show everything", and a note that Dashboard,
// Photos and Settings are always shown. Controlled - the caller owns the selection and
// any saving. Cosmetic only: hiding a tab changes nothing about access, plan or data,
// and every page still opens from a link. A free account is only given the tabs it can
// see (no locked rows, no badges). The cards scroll inside the panel; the caller keeps
// its footer outside it.
export function CustomizeMenuPanel({
  isPro,
  visible,
  onChange,
  recordCounts,
  disabled = false,
  twoColumns = false,
}: {
  isPro: boolean;
  visible: readonly MenuTabKey[];
  onChange: (next: MenuTabKey[]) => void;
  recordCounts?: MenuRecordCounts;
  disabled?: boolean;
  twoColumns?: boolean;
}) {
  const keys = manageableMenuKeys(isPro);
  const shown = new Set(visible);
  // The tab whose "this still has data" note is showing, waiting on a decision.
  const [confirming, setConfirming] = useState<MenuTabKey | null>(null);
  const allShown = keys.every((k) => shown.has(k));

  function emit(next: Set<MenuTabKey>) {
    onChange(keys.filter((k) => next.has(k)));
  }

  function toggle(key: MenuTabKey) {
    const next = new Set(shown);
    if (!shown.has(key)) {
      next.add(key);
      setConfirming(null);
      emit(next);
      return;
    }
    if ((recordCounts?.[key]?.count ?? 0) > 0) {
      // Real records behind it - ask before hiding, don't just do it.
      setConfirming(key);
      return;
    }
    next.delete(key);
    emit(next);
  }

  function confirmHide(key: MenuTabKey) {
    const next = new Set(shown);
    next.delete(key);
    setConfirming(null);
    emit(next);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground tabular-nums">
          {keys.filter((k) => shown.has(k)).length} of {keys.length} tabs shown
        </p>
        <button
          type="button"
          disabled={disabled || allShown}
          onClick={() => {
            setConfirming(null);
            onChange(keys);
          }}
          className="rounded-sm text-sm font-medium text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        >
          Show everything
        </button>
      </div>
      <p className="text-xs text-muted-foreground">Dashboard, Photos and Settings are always shown.</p>

      <ul
        aria-label="Menu tabs"
        className={cn("grid min-h-0 flex-1 content-start gap-2 overflow-y-auto p-1", twoColumns && "sm:grid-cols-2")}
      >
        {keys.map((key) => {
          const item = ITEM_BY_KEY.get(key);
          if (!item) return null;
          const info = recordCounts?.[key];
          const subtitle =
            info && info.count > 0
              ? `${MENU_TAB_DESCRIPTIONS[key]} · ${info.count} ${info.noun}`
              : MENU_TAB_DESCRIPTIONS[key];
          return (
            <li key={key} className={cn("space-y-2", confirming === key && "sm:col-span-full")}>
              <ChoiceCard
                icon={item.icon}
                title={item.label}
                description={subtitle}
                size="compact"
                selected={shown.has(key) && confirming !== key}
                disabled={disabled}
                onToggle={() => toggle(key)}
              />
              {confirming === key && info && (
                <div role="alert" className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-2.5 text-xs">
                  <p>
                    <span className="font-semibold">
                      {item.label} still has data ({info.count} {info.noun}).
                    </span>{" "}
                    Hiding it only removes the tab from your menu. Nothing is deleted, and you can show it again
                    here any time. Hide anyway?
                  </p>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" disabled={disabled} onClick={() => confirmHide(key)}>
                      Hide anyway
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={disabled}
                      onClick={() => setConfirming(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-muted-foreground">
        This only tidies your menu. Nothing is deleted or turned off, and you can still open any page from a
        link. You can change this anytime.
      </p>
    </div>
  );
}

// Header text shared by onboarding step 3, the dialog and the sheet.
export const CUSTOMIZE_MENU_TITLE = "Customize your menu";
export const CUSTOMIZE_MENU_DESCRIPTION = "Choose which tabs show in your menu. Turn any on or off.";

// The footer buttons, same size and layout everywhere: a back/cancel button, the main
// button, and an optional "Skip for now" under them (onboarding only).
export function CustomizeMenuFooter({
  secondaryLabel,
  onSecondary,
  primaryLabel,
  onPrimary,
  onSkip,
  busy,
}: {
  secondaryLabel: string;
  onSecondary: () => void;
  primaryLabel: string;
  onPrimary: () => void;
  onSkip?: () => void;
  busy: boolean;
}) {
  return (
    <div className="shrink-0 space-y-2">
      <div className="flex gap-3 pt-1">
        <Button type="button" variant="outline" className="h-12 flex-1 text-base" onClick={onSecondary} disabled={busy}>
          {secondaryLabel}
        </Button>
        <Button type="button" className="h-12 flex-[2] text-base" onClick={onPrimary} disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {primaryLabel}
        </Button>
      </div>
      {onSkip && (
        <Button type="button" variant="ghost" className="w-full" onClick={onSkip} disabled={busy}>
          Skip for now
        </Button>
      )}
    </div>
  );
}

// The panel plus Cancel/Save, wired to the existing menu-preferences route
// (PATCH /api/profile/nav). Used in the dialog, the sheet and on the Settings page.
export function CustomizeMenuEditor({
  isPro,
  hiddenNavKeys,
  recordCounts,
  twoColumns,
  onDone,
}: {
  isPro: boolean;
  hiddenNavKeys: readonly string[];
  recordCounts?: MenuRecordCounts;
  twoColumns?: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [visible, setVisible] = useState<MenuTabKey[]>(() => visibleFromHidden(hiddenNavKeys, isPro));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/profile/nav", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden_nav_keys: hiddenFromVisible(visible, isPro, hiddenNavKeys) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't save that.");
      // Re-runs the dashboard layout, which is what builds the menu.
      router.refresh();
      toast.success("Menu updated");
      onDone?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <CustomizeMenuPanel
        isPro={isPro}
        visible={visible}
        onChange={setVisible}
        recordCounts={recordCounts}
        disabled={saving}
        twoColumns={twoColumns}
      />
      <CustomizeMenuFooter
        secondaryLabel="Cancel"
        onSecondary={() => onDone?.()}
        primaryLabel="Save"
        onPrimary={save}
        busy={saving}
      />
    </div>
  );
}

// "Customize menu" in the app: a dialog on desktop (sidebar) and a bottom sheet on
// mobile (More drawer). Only the wrapper differs; both hold the same editor, which
// mounts fresh on every open so it starts from the saved choices. Nothing is focused
// on open (initialFocus={false}), so no control shows a focus ring until it is used.
type CustomizeMenuWrapperProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPro: boolean;
  hiddenNavKeys: readonly string[];
};

export function CustomizeMenuDialog({ open, onOpenChange, isPro, hiddenNavKeys }: CustomizeMenuWrapperProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        initialFocus={false}
        className="flex max-h-[92dvh] flex-col gap-3 overflow-hidden bg-card p-5 text-card-foreground sm:max-w-2xl"
      >
        <DialogHeader className="shrink-0 gap-0.5">
          <DialogTitle className="text-xl font-bold">{CUSTOMIZE_MENU_TITLE}</DialogTitle>
          <DialogDescription>{CUSTOMIZE_MENU_DESCRIPTION}</DialogDescription>
        </DialogHeader>
        <CustomizeMenuEditor isPro={isPro} hiddenNavKeys={hiddenNavKeys} twoColumns onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

export function CustomizeMenuSheet({ open, onOpenChange, isPro, hiddenNavKeys }: CustomizeMenuWrapperProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        initialFocus={false}
        className="h-[90dvh] max-h-[90dvh] gap-5 overflow-hidden bg-card p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] text-card-foreground"
      >
        <div className="shrink-0 space-y-1">
          <SheetTitle className="px-0 pt-0 text-2xl font-bold tracking-normal text-card-foreground normal-case">
            {CUSTOMIZE_MENU_TITLE}
          </SheetTitle>
          <p className="text-sm text-muted-foreground">{CUSTOMIZE_MENU_DESCRIPTION}</p>
        </div>
        <CustomizeMenuEditor isPro={isPro} hiddenNavKeys={hiddenNavKeys} onDone={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}
