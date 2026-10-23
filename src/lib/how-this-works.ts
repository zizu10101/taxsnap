// State rules for the "How this works" dropdown. Import-free so it can be unit-tested with
// `node --test`. The choice lives only in the browser's localStorage (per tab, per user): no
// database, no migration. Every storage access is wrapped, so a browser with storage blocked or
// full (private window, cleared site data) still works - the choice is then just kept in memory.

export type StoredChoice = "open" | "closed";

export function howThisWorksStorageKey(tab: string, userId: string): string {
  return `taxsnap:how-this-works:${userId}:${tab}`;
}

// Open by default ONLY when the tab has no records yet AND the person has never opened or closed
// it. Once they have chosen, the stored choice always wins.
export function resolveOpen(args: { empty: boolean; stored: StoredChoice | null }): boolean {
  if (args.stored === "open") return true;
  if (args.stored === "closed") return false;
  return args.empty;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // the accessor itself can throw
  }
}

// In-memory copy, so a toggle still works (for this visit) when storage is unavailable.
const memory = new Map<string, StoredChoice>();
const listeners = new Set<() => void>();

function parse(value: string | null | undefined): StoredChoice | null {
  return value === "open" || value === "closed" ? value : null;
}

export function readChoice(key: string, storage: StorageLike | null = browserStorage()): StoredChoice | null {
  const remembered = memory.get(key);
  if (remembered) return remembered;
  try {
    return parse(storage?.getItem(key));
  } catch {
    return null;
  }
}

export function writeChoice(key: string, choice: StoredChoice, storage: StorageLike | null = browserStorage()): void {
  memory.set(key, choice);
  try {
    storage?.setItem(key, choice);
  } catch {
    // storage full or blocked: the in-memory choice above still applies
  }
  for (const listener of listeners) listener();
}

export function subscribeChoice(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetChoiceMemoryForTests(): void {
  memory.clear();
}
