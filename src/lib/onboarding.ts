// Pure rules for the two-step onboarding, the goal-driven first screen, the
// dashboard checklist and the sample-data labels. Import-free so it can be
// unit-tested with `node --test`.

export const PROVINCES = [
  { code: "AB", name: "Alberta" },
  { code: "BC", name: "British Columbia" },
  { code: "MB", name: "Manitoba" },
  { code: "NB", name: "New Brunswick" },
  { code: "NL", name: "Newfoundland and Labrador" },
  { code: "NS", name: "Nova Scotia" },
  { code: "NT", name: "Northwest Territories" },
  { code: "NU", name: "Nunavut" },
  { code: "ON", name: "Ontario" },
  { code: "PE", name: "Prince Edward Island" },
  { code: "QC", name: "Quebec" },
  { code: "SK", name: "Saskatchewan" },
  { code: "YT", name: "Yukon" },
] as const;

export type ProvinceCode = (typeof PROVINCES)[number]["code"];

export function isProvinceCode(value: unknown): value is ProvinceCode {
  return PROVINCES.some((p) => p.code === value);
}

// The HST/tax rate TaxSnap actually calculates for a province. Ontario's 13% HST
// is the only one the invoice, receipt and HST-return math supports today, so
// every other province is null ("not supported yet") rather than a guessed rate.
export function taxRateForProvince(code: string): number | null {
  return code === "ON" ? 0.13 : null;
}

export const CURRENCY = "CAD" as const;

export type OnboardingGoal = "invoices" | "expenses" | "job_profit" | "salon";

export const GOALS: { value: OnboardingGoal; label: string; hint: string }[] = [
  { value: "invoices", label: "Send invoices and estimates", hint: "Bill a client in a couple of taps" },
  { value: "expenses", label: "Track expenses and receipts", hint: "Snap a receipt, get it categorized" },
  { value: "job_profit", label: "Track job profit", hint: "See what each job really earns" },
  { value: "salon", label: "Log sales and commissions", hint: "Set up your Register" },
];

// What an account is offered, as a list to pick from (any number, at least one).
// Everyone gets the three general goals; a salon (or anyone arriving from the
// salon page) also gets the Register goal.
export function goalsFor(
  businessType: "general" | "salon",
  fromSalonPage = false,
): { value: OnboardingGoal; label: string; hint: string }[] {
  return businessType === "salon" || fromSalonPage ? GOALS : GOALS.filter((g) => g.value !== "salon");
}

export function isGoal(value: unknown): value is OnboardingGoal {
  return GOALS.some((g) => g.value === value);
}

// Validates a submitted selection against what this account is offered: a
// non-empty list of known goals, no duplicates, order kept. Returns null when
// it is not acceptable.
export function parseGoals(value: unknown, offered: readonly OnboardingGoal[]): OnboardingGoal[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: OnboardingGoal[] = [];
  for (const v of value) {
    if (!isGoal(v) || !offered.includes(v)) return null;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

// Stored goals: the new list, or - for an account onboarded before the list
// existed - the single old goal.
export function storedGoals(goals: readonly string[] | null | undefined, legacy: string | null | undefined): OnboardingGoal[] {
  const list = (goals ?? []).filter(isGoal);
  if (list.length > 0) return list;
  return isGoal(legacy) ? [legacy] : [];
}

// Onboarding always ends on the dashboard (the checklist is there), never on a
// blank form.
export const AFTER_ONBOARDING = "/dashboard";

export type ChecklistKey = "client" | "invoice" | "receipt" | "job" | "service" | "stylist";

export interface ChecklistState {
  hasClient: boolean;
  invoiceSent: boolean;
  receiptSaved: boolean;
  hasJob?: boolean;
  hasService?: boolean;
  hasStylist?: boolean;
}

export interface ChecklistItem {
  key: ChecklistKey;
  label: string;
  href: string;
  done: boolean;
}

const KEYS_BY_GOAL: Record<OnboardingGoal, ChecklistKey[]> = {
  invoices: ["client", "invoice"],
  expenses: ["receipt"],
  job_profit: ["job", "receipt"],
  salon: ["service", "stylist"],
};

const LABELS: Record<ChecklistKey, { label: string; href: string }> = {
  client: { label: "Add a client", href: "/dashboard/clients" },
  invoice: { label: "Send an invoice", href: "/dashboard/invoices/new" },
  receipt: { label: "Scan a receipt", href: "/dashboard" },
  job: { label: "Create a job", href: "/dashboard/jobs" },
  service: { label: "Add a service", href: "/dashboard/commission/services" },
  stylist: { label: "Add a stylist", href: "/dashboard/commission/stylists" },
};

// Ordered by the goals picked in onboarding, in the order they were picked,
// without repeats. No goals (skipped, or an old account) reads as the three
// basics. The item for the online-payments feature is deliberately absent
// until it ships.
export function checklistItems(goals: readonly OnboardingGoal[], state: ChecklistState): ChecklistItem[] {
  const done: Record<ChecklistKey, boolean> = {
    client: state.hasClient,
    invoice: state.invoiceSent,
    receipt: state.receiptSaved,
    job: state.hasJob ?? false,
    service: state.hasService ?? false,
    stylist: state.hasStylist ?? false,
  };
  const keys: ChecklistKey[] = [];
  const source: readonly OnboardingGoal[] = goals.length > 0 ? goals : ["invoices", "expenses"];
  for (const g of source) {
    for (const k of KEYS_BY_GOAL[g]) if (!keys.includes(k)) keys.push(k);
  }
  return keys.map((key) => ({ key, ...LABELS[key], done: done[key] }));
}

// Shown until the owner dismisses it or every item is done.
export function checklistVisible(items: ChecklistItem[], dismissedAt: string | null): boolean {
  return !dismissedAt && items.some((i) => !i.done);
}

// The item the dashboard highlights with one big button: the first not done.
export function nextChecklistItem(items: ChecklistItem[]): ChecklistItem | null {
  return items.find((i) => !i.done) ?? null;
}

export const SAMPLE_CLIENT_NAME = "Sample Client (demo)";
export const SAMPLE_JOB_NAME = "Sample Job (demo)";

export const SAMPLE_BLOCKED_MESSAGE =
  "The sample client and job are for looking around - they can not be used on a real invoice, receipt or hours. Add your own, or remove the sample data.";
