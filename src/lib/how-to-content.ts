// The text of every "How this works" dropdown, in ONE place (components/ui/how-this-works.tsx
// renders it). Plain language for a contractor, short numbered steps, and the exact button and field
// names from the real screens - if a label on a screen changes, change it here too.
// Deliberately no plan names, prices or usage limits (they change), and nothing about the card
// statement import or the accountant tools (not available to everyone).

export type HowToTab =
  | "invoices"
  | "estimates"
  | "jobs"
  | "clients"
  | "expenses"
  | "reports"
  | "employees"
  | "progress-billing";

export const HOW_TO_TABS: readonly HowToTab[] = [
  "invoices",
  "estimates",
  "jobs",
  "clients",
  "expenses",
  "reports",
  "employees",
  "progress-billing",
];

export const HOW_TO_STEPS: Record<HowToTab, readonly string[]> = {
  invoices: [
    "Tap New Invoice and pick a client, or add a new one.",
    "Add your work with Add New Line Item, then tap Create Invoice.",
    "Open it and tap Send to email it, copy the link or download a PDF.",
    "When you get paid, tap Record Payment. The balance and status update by themselves.",
  ],
  estimates: [
    "Tap New Estimate and pick a client, or add a new one.",
    "Add your work with Add New Line Item, then tap Create Estimate.",
    "Open it and tap Send to email it, copy the link or download a PDF.",
    "Once the client approves, tap Convert to Invoice. Nothing is typed twice.",
  ],
  jobs: [
    "Tap New job and enter a Job name. Customer and location are optional.",
    "Pick the job on each expense, estimate and invoice to keep them together.",
    "Open a job to see its expenses, hours and estimated profit in one place.",
  ],
  clients: [
    "Tap New client and enter a Name. Email, phone and address are optional.",
    "Have a list already? Tap Import clients to add many at once.",
    "Pick a client when you create an invoice or estimate.",
    "Tap Open on a client to see every invoice and estimate for them.",
  ],
  expenses: [
    "Tap Upload Receipt and choose a photo or PDF of your receipt.",
    "Check Review extracted data and fix anything that looks wrong.",
    "Tap Approve & Save. Tag a Job (optional) to see what each job costs.",
    "No receipt? Tap Add Expense. For costs that repeat, use From Template.",
  ],
  reports: [
    "Pick a date range at the top, like This Month.",
    "Use P&L for your profit and Job Summary to see how each job did.",
    "Open Expenses to see spending by category, then tap Export CSV to save it.",
    "Open Revenue to see the payments you received in that range.",
  ],
  employees: [
    "Tap New employee, enter a Name and Default pay rate, then tap Add employee.",
    "Want them to clock in themselves? Tap Set PIN on their row.",
    "Copy the Shared sign-in link and send it to your team.",
    "Open Hours to see logged time. Use Close session if someone forgets to clock out.",
  ],
  "progress-billing": [
    "Tap Start Progress Billing, pick the Job, enter the Contract value, then tap Start.",
    "When a stage is done, tap New Draw, describe the work and tap Create invoice.",
    "Tap Summary on a job to see Invoiced to Date and Remaining Balance.",
    "When a draw is paid, open it and tap Record Payment.",
  ],
};

export const HOW_TO_SUMMARY = "How this works";
