// Pure rules for "Customize menu": which tabs a goal needs, which tabs the panel may
// manage for a plan, and the conversion between the panel's "shown" toggles and the
// stored list of hidden tabs (profiles.hidden_nav_keys). Cosmetic only: nothing here
// touches access or plan gating. Import-light so it can be unit-tested with `node --test`.

import type { OnboardingGoal } from "./onboarding.ts";

// Same tabs, same order as HIDEABLE_NAV_KEYS in components/dashboard/nav-config.ts
// (a test pins the two together). Dashboard, Photos and Settings are always on.
export const MENU_TAB_KEYS = [
  "estimates",
  "invoices",
  "jobs",
  "employees",
  "clients",
  "expenses",
  "progress-billing",
  "overview",
  "reports",
] as const;

export type MenuTabKey = (typeof MENU_TAB_KEYS)[number];

// Tabs only a Pro account sees. A free account never gets a row for these in the
// panel (no locked row, no badge), and they are never added to its hidden list, so
// upgrading later doesn't land on a menu that already hides them.
export const PRO_ONLY_MENU_KEYS: readonly MenuTabKey[] = ["progress-billing", "overview", "reports"];

// One line per tab, shown under its toggle.
export const MENU_TAB_DESCRIPTIONS: Record<MenuTabKey, string> = {
  estimates: "Quotes you send before the work starts",
  invoices: "Bill clients and record payments",
  jobs: "Group work, costs and photos by job",
  employees: "Hours, clock-in and your crew",
  clients: "Your client list and contact details",
  expenses: "Receipts and tax write-offs",
  "progress-billing": "Bill big jobs in stages",
  overview: "Spending and profit at a glance",
  reports: "Profit and loss, by job and category",
};

// Tabs each onboarding goal needs. Salon accounts have a fixed menu, so that goal
// maps to nothing.
export const MENU_KEYS_BY_GOAL: Record<OnboardingGoal, readonly MenuTabKey[]> = {
  invoices: ["estimates", "invoices", "clients"],
  expenses: ["expenses", "overview"],
  job_profit: ["jobs", "employees", "expenses", "invoices", "clients", "progress-billing", "reports"],
  salon: [],
};

// The tabs the panel lists for a plan, in menu order.
export function manageableMenuKeys(isPro: boolean): MenuTabKey[] {
  return MENU_TAB_KEYS.filter((k) => isPro || !PRO_ONLY_MENU_KEYS.includes(k));
}

// Tabs to start with shown for the picked goals. No goals (or none that map to a tab)
// reads as everything, so a prefill never produces an empty menu.
export function visibleKeysForGoals(goals: readonly OnboardingGoal[], isPro: boolean): MenuTabKey[] {
  const manageable = manageableMenuKeys(isPro);
  const wanted = new Set<MenuTabKey>();
  for (const g of goals) for (const k of MENU_KEYS_BY_GOAL[g] ?? []) wanted.add(k);
  if (wanted.size === 0) return manageable;
  return manageable.filter((k) => wanted.has(k));
}

// What the panel shows as ON: managed tabs that are not hidden.
export function visibleFromHidden(hidden: readonly string[], isPro: boolean): MenuTabKey[] {
  const gone = new Set(hidden);
  return manageableMenuKeys(isPro).filter((k) => !gone.has(k));
}

// The list to store for a set of shown tabs. A tab the panel can't manage for this plan
// keeps whatever it had in `currentHidden` (a free account never gains or loses a
// hidden Pro tab). Canonical order, no duplicates, unknown keys dropped.
export function hiddenFromVisible(
  visible: readonly string[],
  isPro: boolean,
  currentHidden: readonly string[] = [],
): MenuTabKey[] {
  const manageable = new Set(manageableMenuKeys(isPro));
  const shown = new Set(visible);
  const kept = new Set(currentHidden);
  return MENU_TAB_KEYS.filter((k) => (manageable.has(k) ? !shown.has(k) : kept.has(k)));
}

// What onboarding step 3 saves when the person presses Continue with the prefilled
// choices untouched: everything the goals don't need is hidden.
export function hiddenForGoals(goals: readonly OnboardingGoal[], isPro: boolean): MenuTabKey[] {
  return hiddenFromVisible(visibleKeysForGoals(goals, isPro), isPro);
}
