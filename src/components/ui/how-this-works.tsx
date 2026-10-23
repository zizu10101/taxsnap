"use client";

import { useId, useSyncExternalStore } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { HOW_TO_STEPS, HOW_TO_SUMMARY, type HowToTab } from "@/lib/how-to-content";
import {
  howThisWorksStorageKey,
  readChoice,
  resolveOpen,
  subscribeChoice,
  writeChoice,
} from "@/lib/how-this-works";

// A quiet "How this works" row at the top of a tab. Collapsed by default; open by default only
// when the tab is empty and the person has never opened or closed it. After that their choice is
// remembered per tab and per user in the browser (lib/how-this-works.ts handles storage that is
// missing or throws). Before hydration it renders collapsed, so a returning person who keeps it
// closed sees no shift; the server never reads storage.
const SERVER = "server" as const;

export function HowThisWorks({ tab, userId, empty }: { tab: HowToTab; userId: string; empty: boolean }) {
  const key = howThisWorksStorageKey(tab, userId);
  const stored = useSyncExternalStore(
    subscribeChoice,
    () => readChoice(key) ?? "none",
    () => SERVER,
  );
  const open = stored === SERVER ? false : resolveOpen({ empty, stored: stored === "none" ? null : stored });

  const id = useId();
  const panelId = `${id}-panel`;

  return (
    <div className="rounded-md border border-border/60">
      <button
        type="button"
        id={`${id}-button`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => writeChoice(key, open ? "closed" : "open")}
        className="flex min-h-10 w-full items-center gap-1.5 rounded-md px-3 py-2 text-left text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-90")} aria-hidden="true" />
        <span>{HOW_TO_SUMMARY}</span>
      </button>
      <div id={panelId} role="region" aria-labelledby={`${id}-button`} hidden={!open}>
        <ol className="list-decimal space-y-1.5 py-1 pr-3 pb-3 pl-9 text-sm text-muted-foreground">
          {HOW_TO_STEPS[tab].map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}
