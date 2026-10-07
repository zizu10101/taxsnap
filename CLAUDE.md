@AGENTS.md

# TaxSnap

Mobile-first PWA for self-employed trade contractors (painters, handymen,
barbers) to snap receipts, auto-categorize tax write-offs with AI, track
Ontario HST, and invoice clients. Next.js 16 (App Router, Turbopack) + React
19 + TypeScript + Tailwind v4 + Supabase (Postgres/Auth/Storage) + Google
Gemini + Stripe. Billing is live in production, under a Stripe account named
"Edge Digital Business Solutions" (the operating business entity) - its live
secret key is what `STRIPE_SECRET_KEY` resolves to in production. Local/dev
work (including the Stripe MCP connector) instead targets a separate
Stripe account named "Taxsnap", which only has test/sandbox mode - it has no
live mode enabled, so it can never see or touch real production data. Don't
assume "the Stripe account" means one thing - check which of the two a given
change/query actually needs.

## Stack quirks worth knowing before editing UI

shadcn is configured in the **"base-nova"** style, which wraps **Base UI**
(`@base-ui/react`), not Radix. The APIs differ in ways that silently break
if you copy Radix-style shadcn patterns from memory or training data:

- **No `asChild`.** To render a `Button`/`DropdownMenuTrigger`/`DialogTrigger`
  as something else (typically a `next/link` `Link`), use
  `render={<Link href="..." />}` and put the label as children of the
  trigger component itself, not inside the render element.
- **`nativeButton={false}`** is required whenever `render` points at a
  non-`<button>` element (a `Link`/`<a>`). Without it, Base UI logs a dev
  console error ("expected a native `<button>`...") and can affect
  keyboard/focus behavior. This bit us in production once - see
  `src/components/dashboard/upload-receipt.tsx` and `dashboard-header.tsx`
  for the correct pattern. It has since resurfaced twice more (the
  Invoices/Estimates toggle in `document-list.tsx`, and 9 separate
  "Upgrade to Pro" buttons copy-pasted across every Pro-gated page) - if
  you're adding a new `Button render={<Link ... />}`, grep the codebase for
  `render={<Link` first and double-check every match has `nativeButton`
  set, don't assume a copied pattern already got it right.
- **`Select` needs an explicit `items` prop** (`Record<value, label>` or an
  array of `{value, label}`) whenever a value's raw string differs from its
  displayed label (e.g. a preset key like `"this-month"` displayed as
  "This Month", or a client `id` displayed as the client's name). Without
  it, the trigger shows the raw value instead of the label until the popup
  has been opened once. See `src/components/dashboard/date-range-filter.tsx`
  or `src/components/invoices/document-builder.tsx` for the fix. Selects
  where the value *is* the label (e.g. tax category strings) don't need
  this.
- The `.tabular-nums` utility class is globally re-styled in `globals.css`
  to also set the mono font (`--font-mono`, IBM Plex Mono) - every currency
  amount in the app uses `tabular-nums` for exactly this reason. Don't
  remove it expecting only column alignment; you'll also lose the number
  styling.
- **Never bind a plain `<Input type="number">` directly to a `number`
  state** (`value={n}` / `onChange={(e) => setN(parseFloat(e.target.value)
  || 0)}`). Clearing the field parses to `NaN → 0`, which re-renders the
  box back to `"0"` before the user can type a replacement digit - it reads
  as "I can't delete this 0." Use `NumberInput` from
  `src/components/ui/number-input.tsx` instead everywhere a dollar amount
  or quantity is edited; it keeps its own text buffer so the field can sit
  empty while typing, and only resyncs from an external `value` prop change
  (e.g. a line-item row getting reused for a different item after one above
  it was deleted) via the render-time "adjust state from props" pattern,
  not a `useEffect`, to stay clear of the `react-hooks/set-state-in-effect`
  rule below.
- The other sanctioned way around `react-hooks/set-state-in-effect`: reading
  a browser-only value that can differ between the server-rendered HTML and
  the client (feature detection, `matchMedia`, `navigator.userAgent`, PWA
  install state) needs `useSyncExternalStore` with a `getServerSnapshot` that
  returns the SSR-safe default - not `useState` + `useEffect(() =>
  setX(...))`. The latter both trips the lint rule and risks a hydration
  mismatch if the real client value would have rendered different markup.
  See `src/components/install-prompt-cards.tsx` (standalone-display-mode and
  iOS detection) for the pattern - also used in
  `share-document-button.tsx`'s mobile-vs-desktop share button check.
- shadcn's `Sheet` (`src/components/ui/sheet.tsx`) wraps one Base UI Dialog
  behind two `side` variants: `side="bottom"` (default, dark `bg-sidebar`
  surface) is the mobile nav's "More" overflow sheet; `side="right"` (light
  `bg-card` surface, full height) is for content drawers like the Expenses
  receipt detail. Two Base UI gotchas surfaced building the `side="right"`
  drawer, worth checking before adding another one: (1) leave `modal` at
  Base UI's default `true` and its full modal scroll-lock effect fires via
  a deferred `setTimeout(0)` (`@base-ui/utils/useScrollLock`) - that lands a
  tick after the popup's own CSS entrance animation has already started
  painting, forcing a layout recalc mid-slide that reads as a flicker on
  open. Pass `modal="trap-focus"` instead for a slide-over drawer - it
  still traps keyboard focus (behaves like a real modal) but never invokes
  that scroll-lock path. (2) Don't gate the drawer's content on the same
  nullable value that closes it (e.g. `{receipt && <Content receipt={receipt} />}`)
  - the parent nulls that value the instant you close, but the popup itself
  stays mounted for its own ~200ms exit animation, so the content would
  unmount a full animation-length before the panel visually finishes
  leaving - an empty panel sliding away. Keep a `displayedX` state that only
  updates when the incoming value is non-null (render-time "adjust state
  from props", not an effect) and render off that instead - see
  `receipt-detail-dialog.tsx`.
- `NavItemButton` (`src/components/dashboard/nav-item.tsx`) is a shadcn
  `Button` in `flex-col` icon-over-label form. The label span needs both
  `min-w-0` (overriding the flex-item default of `min-width: auto`, which
  otherwise refuses to shrink text below its unwrapped width) *and*
  `whitespace-normal` (overriding `whitespace-nowrap` from the Button's own
  base classes, which the span inherits since `white-space` is an inherited
  CSS property) - without both, a multi-word label (e.g. "Progress
  Billing", the only two-word one in the nav) renders on one unbroken line
  that overflows past the button's own background, so the active pill's
  orange highlight doesn't reach the overflowing text. Single-word labels
  never hit this, which is why it went unnoticed until Progress Billing
  shipped.
- `globals.css`'s `html` sets `scrollbar-gutter: stable` - reserves the
  scrollbar's width at all times so a dialog/sheet locking body scroll
  (removing the rendered scrollbar) never shifts page content, or a
  right-anchored drawer's own edge, sideways. Don't remove it.

## Desktop layout (general business type)

`DashboardShell`'s `<main>` uses `lg:w-[90%]` (not a fixed `max-w-*`), so
pages scale with the monitor instead of capping at a fixed pixel width -
each page opts in by dropping its own inner cap to `lg:max-w-none`
(`w-full max-w-2xl lg:max-w-none` is the standard pattern; mobile still
gets the narrower `max-w-2xl` reading width). Detail/record pages that
only ever show one document (Job/Invoice/Estimate detail, Progress Billing
Summary) get this too, not just list pages - "wide vs. narrow" is a
mobile-vs-desktop split here, not a list-vs-detail one, per explicit user
direction. Two things deliberately kept their narrower `max-w-2xl` cap:
Settings/Billing (single-column forms with nothing to spread wider into -
widening the shell doesn't change how a centered narrow form looks) and
the salon-only Commission/Register screens (a tap-to-log POS-style grid,
not a data list - forcing 90% width would spread out the tap targets and
make it worse).

Invoices, Estimates, and Jobs each get an `lg+` "workstation": a list on
one side and a live preview panel on the other, so browsing/previewing a
record needs no page navigation (`DocumentWorkstation` in
`src/components/invoices/document-workstation.tsx`, shared by Invoices and
Estimates via its `type` prop, including the Estimate-only
Convert-to-Invoice affordance; `JobWorkstation` in
`src/components/jobs/job-workstation.tsx`). Both only ever replace the
*list* rendering at `lg+` - creating, editing, recording payments, and
deleting all still go through the exact same New/Edit/Detail pages and
dialogs as the mobile flow; the workstation's "View full details" link is
the only way in from there. `DocumentList` (shared by Invoices/Estimates)
renders its `DocumentWorkstation` internally rather than accepting it from
the page as a prop, specifically because `BusinessProfileCard` auto-opens
its edit dialog on first visit - mounting two copies of the whole list
component across a breakpoint split (one CSS-hidden, not unmounted) risked
both popping that dialog open at once. `JobWorkstation`'s per-job
cost/revenue numbers come from `buildJobCostSummaries()` in
`lib/job-revenue.ts`, computed once for every job from three flat,
job_id-grouped queries so switching the selected job in the list is
instant with no per-click fetch - same underlying math `JobDetail`'s own
per-job page already used, just batched across every job at once.

Progress Billing didn't get the list+preview treatment - each job's own
card on `/dashboard/progress-billing` already shows its full draw history
inline (unlike Jobs, there's no separate detail click needed to see the
numbers), so at `lg+` it's just a 2-column card grid instead of a single
full-width stack; a separate preview panel would only have duplicated what
the card already shows.

## Design system

Tokens live in `src/app/globals.css` as CSS custom properties, consumed via
Tailwind's `@theme inline`. Palette: warm "work order paper" background,
graphite ink foreground, a single hi-vis/chalk-line **orange** accent
(`--primary`), and a distinct **ledger green** (`--success` /
`--success-foreground`) reserved specifically for money-positive figures
(tax savings, refunds, paid invoices) - don't reuse `--primary` for those,
and don't reach for raw Tailwind `emerald-*`/`red-*` classes; use
`text-success` / `text-destructive` etc. so dark-mode and future palette
tweaks stay centralized. Fonts: **Barlow Semi Condensed** for headings
(wired to `font-heading`, auto-applied to `h1`/`h2`/`h3` and shadcn
`CardTitle`/`DialogTitle` via `globals.css` - most headings don't need the
class added manually), **Inter** for body, **IBM Plex Mono** for numbers
(see above). Dark mode CSS exists (`.dark` class + tokens) and is toggled
by a hand-rolled theme system (`src/lib/theme.ts` +
`src/components/theme-sync.tsx`), not `next-themes`: a blocking
pre-paint `<Script strategy="beforeInteractive">` in the root
`src/app/layout.tsx` reads a `"theme"` localStorage key
(light/dark/system, resolved against `prefers-color-scheme` for
`"system"`) and applies `.dark` before first paint to avoid a
flash-of-wrong-theme; `useTheme()` exposes `{preference, resolvedTheme,
setPreference}` and, once signed in, `(app)/layout.tsx`'s `ThemeSync`
PATCHes the choice to `profiles` via `/api/profile/theme` so it persists
across devices. Settings' `ThemeSettings` is the full three-way picker;
the marketing header's toggle (`LandingHeader`) is a binary sun/moon
override built on the same hook and the same `"theme"` key, so a
visitor's choice on the marketing site carries into the app after
login.

The brand mark is `public/logo-mark.png` (transparent PNG, the orange
chevron) - it's the single source of truth for the logo everywhere: the
dashboard header, the landing page header/install cards, and the generated
favicon/PWA icons (`src/app/icon.tsx`, `apple-icon.tsx`,
`icons/icon-192|512/route.tsx`). Those four icon files read the PNG off disk
with `fs.readFileSync` and embed it as a base64 `data:` URI inside the
`next/og` `ImageResponse` JSX (`runtime = "nodejs"` is required for `fs` to
work there) rather than referencing `/logo-mark.png` by URL, since the icon
routes render server-side with no browser `fetch` base to resolve a relative
path against. To swap the logo, just replace `public/logo-mark.png` - no
other file needs to change. If a new source logo has a JPEG-with-off-white-
background origin (vs. a real transparent PNG), chroma-keying it needs a
wide gap between the two threshold values, sampled from actual foreground
vs. background pixels rather than a single corner pixel - the background in
at least one AI-generated logo had enough of its own gradient/paper-texture
noise (~20-30 sum-of-abs-RGB-diff) that a tight threshold left a muddy
halo. Prefer sharp's `trim()` on a generously-oversized crop over hand-
rolled bounding-box math for finding the actual content bounds first.

## Database

Tables (see `supabase/migrations/*.sql`, run in order - **Supabase CLI
isn't linked**, so every new migration has to be pasted into the Supabase
SQL Editor by the user manually; always give them the exact SQL after
adding a migration file, and don't assume a prior one was actually run -
check via a `select` against the table with the service-role key if
unsure):

- `profiles` - one row per auth user (trigger-created on signup),
  `subscription_status` ('free'/'basic'/'pro') gates invoicing, `logo_url`
  points at the business logo in the `logos` storage bucket. Also carries
  the onboarding business profile (`business_name`, `business_address`,
  `business_phone`, `business_email`, `business_profile_skipped`) shown as
  the "From" block on every invoice/estimate - editable any time via
  `BusinessProfileCard`/`BusinessProfileDialog`, with an explicit skip flag
  so the prompt doesn't nag a user who declined it once.
- `receipts` - AI-parsed expense records, `job_name` (optional, free text)
  lets a user filter/report receipts by job.
- `sales` - manually-entered gross sales/cash-deposits per period, keyed by
  `(user_id, period_label)`, feeding the HST calculator.
- `clients`, `documents`, `document_items`, `payments` - the Pro
  invoicing/estimates system. `documents.type` is `'invoice' | 'estimate'`
  (one unified table, not two); `document_items` and `payments` have no
  `user_id` column, so their RLS policies check ownership through a
  subquery on the parent `documents` row.
  - `documents.converted_from_id` links an invoice back to the estimate it
    was converted from (`POST /api/documents/[id]/convert`, guarded
    against double-conversion). Converted estimates stay visible in the
    Estimates tab (never hidden/deleted) with a "Converted" badge and a
    link to the resulting invoice - `document-list.tsx`'s `convertedMap`
    and `estimates/page.tsx`'s conversion lookup query are what drive that.
  - `documents.excluded_from_hst` lets a user drop one specific invoice out
    of the HST Return Helper's totals (e.g. a paid invoice that was
    actually a reimbursement) without touching its real dollar amounts.
  - `documents.status` is `'draft' | 'sent' | 'partial' | 'paid'` and
    `'partial'`/`'paid'` are **derived from `payments`, not meant to be
    hand-set** - `POST/DELETE /api/documents/[id]/payments[/:paymentId]`
    recompute it from the payment total vs. `total_amount` every time
    (manual override via the status `Select` on the detail page still
    works, but adding/removing a payment will recompute and overwrite it).
  - `payments` - one row per deposit/partial/final payment logged against
    an invoice (`amount`, `paid_date`, optional `method`/`note`). This is
    the source of truth the HST calculator and the invoice's "Paid to
    date"/"Balance due" figures are built from - see Tax logic below.
- `jobs` - first-class job entity backing the pre-existing free-text
  `receipts.job_name` tag. A DB trigger (`sync_receipt_job` in
  `0009_jobs.sql`) keeps `receipts.job_id` in sync automatically whenever
  `job_name` is set/edited, so the existing free-text job filter UI
  (`job-filter.tsx`, `dashboard-body.tsx`) needed zero code changes -
  `jobs` rows get find-or-created transparently underneath it. Also
  created directly from the Jobs page or the hour-entry form
  (find-or-create by name, same inline-create pattern as `new_client` on
  documents).
- `employees` - name, `default_hourly_rate`, `is_active` (deactivate, not
  delete - `hour_entries.employee_id` is `on delete restrict` so
  historical labor cost never loses its employee). Names are title-cased
  on save (`src/lib/format-name.ts`), with hand-rolled Mc-/Mac-/apostrophe
  handling (McDonald, MacLeod, but not MacK; O'Brien) - deliberately no
  npm dependency added for this. See that file's exceptions list for the
  common-word cases it can't get fully right (e.g. "Macbeth" as a
  surname).
- `hour_entries` - `employee_id` + `job_id` + date + hours + `rate`
  (copied from the employee's `default_hourly_rate` at entry time,
  editable per entry, never a live reference) + `labor_cost` as a
  **generated column** (`hours * rate`, stored) so it can never drift and
  a later change to an employee's default rate can't retroactively
  rewrite a historical entry's cost. Labor cost is intentionally never
  wired into `sales`/`documents`/`payments` or `src/lib/hst.ts` anywhere -
  it's for job cost analysis only, kept fully separate from the tax
  module (see "Tax logic" below).
- `services` - name, `default_price`, `color` (hex, auto-assigned
  round-robin from `SERVICE_COLOR_PALETTE` in `src/lib/service-colors.ts`
  at creation, editable after), `is_active`.
- `stylists` - name, `is_active`, `pay_type`
  (`'commission' | 'hourly' | 'salary'` - not currently read by any logic,
  `commission_rate` alone drives `commission_owed`; it's a forward-compat
  field), `commission_rate` as a **fraction** (0.15 = 15%, not 15) so
  `commission_owed` below stays a direct multiply.
- `commission_entries` - one row per logged transaction. `service_name` +
  `price_charged` + `commission_rate_applied` are all snapshotted at entry
  time (same reasoning as `document_items`) - editing a service's price or
  a stylist's rate later never rewrites historical entries.
  `commission_owed` is a **generated column**
  (`round(price_charged * commission_rate_applied, 2)`, stored), same
  never-drifts guarantee as `hour_entries.labor_cost`. No separate
  "work date" field like `hour_entries.work_date` - entries are created in
  real time at the moment of the tap, so `created_at` is already the
  transaction timestamp. Same tax boundary as `labor_cost`: never wired
  into `sales`/`documents`/`payments`/`src/lib/hst.ts` anywhere - this is
  for commission payout tracking only.

- `bank_accounts` - the owner's single list of accounts (0047, typed in
  0048): `account_type` is `'bank'` (can receive a customer payment, so it's
  offered under a payment's "Deposited to", `payments.bank_account_id`) or
  `'card'` (a credit card - only ever an expense's "Paid with",
  `receipts.paid_with_account_id`, and `expense_templates.default_paid_with_
  account_id`). Names are unique per account case-insensitively across both
  types; "Remove" only sets `is_active = false` (history keeps its label, no
  DELETE route); a bank account with payments can't become a card. Pickers
  and CSV cells resolve names through *every* account, active or not -
  `src/lib/accounts.ts` has the pure filtering helpers (tested). Managed in
  Settings -> Accounts, no tier cap. The table keeps its 0047 name.
- `expense_categories` - owner-added categories (Pro, Settings). They merge
  with the fixed `TAX_CATEGORIES` list at display time and never touch it
  (that list feeds Gemini's enum, the HST calculator and `deductibleRate()`,
  which special-cases "Meals" by name); a custom category counts as 100%
  deductible. `receipts.tax_category` stays plain text, so renaming goes
  through `rename_expense_category()` to update receipts/templates in one
  transaction, and the receipts routes validate with `resolveCategory()`.
- Reports (`/dashboard/reports`, Pro): P&L takes its revenue/expenses/profit
  from `getExpenseOverviewData` itself (never a second rule - two profit
  numbers disagreeing was a deliberate no); revenue is payments *received* in
  the range via `recognizePayments()` (`lib/payment-revenue.ts`), pre-tax,
  honoring `excluded_from_hst`. Job Costing's pages and the Reports Job
  Summary honor that flag too (`honorExcludedFromHst`); Progress Billing's
  received-to-date deliberately does not.

RLS pattern throughout: `auth.uid() = user_id`. Storage buckets
(`receipts`, `logos`) are private; access via `createSignedUrl`, never a
public URL - see `ReceiptImage`/`LogoImage` components for the
keyed-remount pattern used to fetch a fresh signed URL per item without
tripping the `react-hooks/set-state-in-effect` lint rule (don't
`setState(null)` synchronously at the top of an effect to "reset" between
items; key a small subcomponent by the item's id/path instead so it
remounts).

Pro-gating for API routes goes through `requireProUser()` in
`src/lib/require-pro.ts` - use it for anything under `/api/clients`,
`/api/documents` (including the nested `/payments` routes),
`/api/profile/logo`, `/api/profile/business`, `/api/jobs`,
`/api/employees`, `/api/hours`, `/api/services`, `/api/stylists`,
`/api/commission-entries`.

## Receipt parsing

`src/lib/gemini.ts` builds the Gemini system prompt dynamically per request
with today's date (`buildSystemPrompt(today)`), because a bare numeric
receipt date like `26/08/23` is genuinely ambiguous - it could be DD/MM/YY,
MM/DD/YY, or YY/MM/DD, and there's no reliable single convention across
receipt printers/POS systems. Don't revert to a fixed DD/MM/YY (or any
fixed order) assumption, and don't make recency the primary/only signal
either - both were tried and both cause real misreads (a fixed order once
read `26/08/23` as Aug 26 2023 instead of Aug 23 2026; recency alone
ignores clues actually printed on the receipt). The prompt instead works
through an explicit priority chain per date, stopping at the first rule
that resolves it: (1) an unambiguous signal - a month name, a 4-digit
year, a labeled format; (2) a >12 value, which can only be a day, never a
month; (3) other context printed on the receipt - a day-of-week checked
against the calendar, or the store's evident country/locale (address,
phone format, language, currency) - Canadian small businesses are
TaxSnap's primary users, so a Canadian locale cue favors DD/MM or ISO
order over US-style MM/DD; (4) only as a last resort, a locale-default
guess (DD/MM). Recency - closest-to-today, never future - is kept as a
sanity check *after* the above (rejecting a date rules 1-3 would otherwise
produce if it lands in the future or reads an old year that's also validly
a recent one), not as the primary disambiguator.

Rule 4 is a genuine guess, so `parseReceiptImage` returns a
`date_ambiguous: boolean` flag (true whenever rule 4 fired, the model
couldn't resolve it, or transaction_date came back empty) alongside the
parsed fields - `UploadReceipt`'s pre-save review dialog surfaces this by
turning the Date field's label/border red and showing an inline warning,
specifically so an ambiguous date doesn't slip past the user unnoticed (a
wrong transaction date silently lands the receipt in the wrong tax
period). The flag isn't persisted to the `receipts` table - it only needs
to exist for that one review step, and clears the moment the user edits
the date field themselves.

The Expenses list's receipt detail (`receipt-detail-dialog.tsx`) is a
right-side `Sheet` drawer (see Stack quirks above) with two tabs: Extracted
Items (the pre-existing summary/edit form) and Original Receipt, which
renders the actual scanned photo via `ReceiptImage`
(`src/components/dashboard/receipt-image.tsx`) - same keyed-remount
signed-URL pattern as `LogoImage`, pointed at the `receipts` bucket.
`createSignedUrl` can resolve successfully even when the underlying object
doesn't exist (e.g. seed/demo data that was never actually uploaded) - it
only 404s once the browser requests the file - so `ReceiptImage` has to
catch that via the `<img>`'s own `onError`, not just the signing call's
`error` field, or a missing photo renders as a broken-image icon instead of
the "Couldn't load the original photo" fallback.

## Receipt duplicate detection

Two warnings on receipt scanning, both WARNINGS ONLY - nothing ever blocks a save, and every
check has an override. Migration `0056_receipt_file_hash.sql` adds `receipts.file_sha256`
(nullable, 64-hex check, partial index on `(user_id, file_sha256)`; NOT unique, no backfill -
old receipts simply have no hash).

- **Same file** (`file-hash.ts`, `receipt-duplicates-server.ts`): the browser SHA-256s the
  ORIGINAL file BEFORE `compressImage` and sends `file_sha256` to `/api/parse-receipt`. If it
  matches one of the owner's receipts the route returns `{ duplicate: { file: [...] } }` and
  stops BEFORE the storage upload and the Gemini call (the compressed file has already been
  posted; only storage and the model call are saved). The dialog offers Cancel / **Continue
  anyway** (re-posts with `force=1`). Only the hash is stored, on save (`POST /api/receipts`
  validates it with `isSha256Hex`), never the file's bytes. It is a fingerprint of the bytes, so a
  renamed copy still matches and a re-photographed or re-compressed one doesn't.
- **Same purchase** (`receipt-duplicates.ts`, `GET /api/receipts/duplicate-check`): same
  `normalizeMerchant`, same total to the cent, date within 2 days. Re-checked (500 ms debounce)
  as the merchant, total or date are edited; the review dialog's save button then reads **Save
  anyway**. Deliberately not fuzzy: a leading "the" is NOT stripped (a known, accepted miss),
  Shell != Shell Energy. Refunds and statement expenses still waiting for a receipt
  (`no_receipt`) never count as saved receipts.
- "View existing receipt" opens `/dashboard/expenses?receipt=<id>` in a NEW TAB (the Expenses
  page opens that receipt's drawer from the loaded list), so the scan in progress is kept.
- Merchant identity is `vendorKey` (`merchant-name.ts`) - the SAME function the statement matcher
  uses, so the duplicate check and statement matching can never disagree about who a merchant is
  (it briefly had its own `normalizeMerchant`, removed once both lived on `main`).
- **"This charge already has a receipt"** (`attachedStatementMatches`, returned as `attached` by the
  same `duplicate-check` route): the attach flow only offers statement expenses still WAITING for a
  receipt, so scanning the same invoice again would otherwise save a second expense and count the
  charge twice. It finds statement-created expenses (`from_statement`) that ALREADY have one
  (`no_receipt = false`) using the statement matcher's `rankCandidates`, keeping only the `vendor`
  kind: same vendor and the exact same amount within 30 days (so invoice Feb 8 / charge Feb 22
  counts). A same-amount charge at a DIFFERENT merchant is deliberately not flagged - a warning
  that says "you'd count it twice" has to be right. A receipt in both lists is shown once, under
  this more specific message. The attach route also stores `file_sha256`, so re-scanning an
  attached file is caught by the exact-file check as well.

## Bulk change category (Expenses)

Tick rows on the Expenses page (per-list header boxes, "Select all N in this view", capped at 500) and
"Change category...". `ReceiptsList` takes an optional `selection` prop (absent = unchanged, which is how
Overview uses it); the selection lives in `ExpensesBody` and is cleared whenever a filter changes. The page
gained a category filter (`CategoryFilter`, same shape as `JobFilter`, also lists a category an expense still
carries but that is no longer offered).

- **It writes ONE column: `receipts.tax_category`.** Never `tax_amount`, never a vendor rule, never
  `statement_lines` history. The single-expense `PATCH /api/receipts/[id]` rewrites the whole form (incl.
  tax) and collapses unknown categories to "Other", so it can't be reused; `POST /api/receipts/bulk-category`
  (rules in `lib/bulk-category-server.ts`, `handleBulkCategory(db, userId, body)` so it is testable as a real
  signed-in user) has three modes: **preview** (a dry run through the same `planBulkCategory` the apply
  uses), **apply** and **undo**.
- **Frozen at preview.** Apply sends back exactly the preview's `changes: [{id, from}]`; every row must still
  be in its `from` category or NOTHING is written (409 `STALE_PREVIEW`; a post-write count check is a second
  layer that reverts what moved). Unknown categories are refused (`resolveExistingCategory`, never "Other");
  a target must be built-in or the owner's ACTIVE custom category.
- **Why Meals gets its own confirmation:** `tax_amount` isn't touched, but `deductibleRate()` gives Meals 50%
  and everything else 100%, so moving $65 of HST into/out of Meals changes the ESTIMATED reclaimable HST by
  $32.50. The preview shows before->after for reclaimable HST and deductible spend, and the server refuses
  (400 `MEALS_CONFIRM_REQUIRED`) unless `confirm_meals === true`.
- **Undo is session-only** (a strip on the page; a reload drops it). It only restores rows still in the
  category they were moved to - one edited since is left alone and reported.
- **Tax codes:** a recategorize of a *calculated* statement expense whose code came from its
  category's default recomputes that code and its calculated tax (`taxAfterCategoryChange`); a code the
  owner picked on the line, a fee/foreign default, and EVERY confirmed row keep their tax exactly. The
  preview says how many are recalculated, apply recomputes server-side (never trusting the request),
  and undo restores the previous code and tax (unless a receipt was attached meanwhile).
- Tests: `bulk-category.test.ts` (pure: Meals maths, skip counts, id validation) and
  `bulk-category-db.test.ts` (real DB, `RUN_DB_ISOLATION_TEST=1`: only `tax_category` changes, other
  owner untouchable, 500 cap, stale, Meals confirm, undo, no rules learned).

## Tax codes (statement expenses)

Migration `0057_tax_codes.sql` (+ rollback; it also REPLACES `commit_statement_import()` - the 0052 body plus
four columns). A tax code is THREE separate numbers, deliberately not merged (`src/lib/tax-codes.ts`, pure):
`tax_rate` (tax embedded in the price: 13% or 0), `itc_pct` (share claimable: 100/50/0) and `deductible_pct`.
Meals is why: 13% is still in the price, only half is claimable, so it can't be a rate in
`total * rate / (1 + rate)`. The tax is EXTRACTED at `tax_rate` (`calculateTax`, tax-included, signed for
refunds) and `tax_amount` stores the full embedded tax, exactly as it does for a scanned receipt; the claim
share is applied when READ (`itcPct()`/`deductiblePct()`, which fall back to the category - Meals 50%,
everything else 100% - for any row with no code, so every receipt from before this is unchanged).

- **Calculated vs confirmed:** *calculated* = `from_statement` and `no_receipt` (`isCalculated`); everything else
  - scanned, attached, manually typed - is *confirmed*. No new status column. Reports split the two:
  `computeExpenseSummary` (`estHstConfirmed`/`estHstCalculated`/`calculatedCount`/`needsTaxCodeCount`), Line 106
  in the HST helper (`calculateHSTReturn`, with an **include-calculated toggle, on by default**), the Overview
  and Expenses summary notes (`itcSplitNote`), the accountant bundle summary, a "Tax Basis" CSV column and a
  "calc." marker in the accountant portal. A card statement alone may not be adequate support for an ITC claim
  (not verified against canada.ca) - hence the split and the toggle.
- **Which code applies to a line** (`resolveTaxCode`, most specific first): the owner's pick on the line
  (`tax_source 'line'`) > a vendor rule (the input exists; vendor rules' app code is a later phase) > foreign
  currency (no tax; a rule can override) > the category's default > fees and interest (no tax) > **nothing**.
  **A line with no code calculates NOTHING** (tax 0, no ITC) and is flagged "needs a tax code" - there is
  deliberately no fallback rate, a guess would overclaim. Only the bank charges category (found by its stable
  key) is seeded as no-tax; every other category default waits for the accountant's table, and the
  statement-import allowlist stays closed until it arrives. The defaults are code constants
  (`buildCategoryDefaults`), not data.
- **Where it lives:** a draft `statement_lines` row stores only the owner's own choices (a picked code, or a
  refund's typed HST figure - exclusive); everything else is DERIVED (`statement-tax.ts` `lineTax`) so a category
  or type change can never strand a stale figure. Just before `commit_statement_import`, the commit route
  runs `materializeStatementTaxes` (`statement-tax-server.ts`) which writes the resolved code and tax onto the
  lines, and the SQL function copies them onto the new expenses (`receipts.tax_rate/itc_pct/deductible_pct/
  tax_source`; only a statement expense may carry one, enforced by a check). Province: Ontario 13% only; the
  rate is stored on every row so adding provinces later needs no migration.
- **Attach** replaces the calculated tax with the receipt's actual figure and clears the code (the row is now
  confirmed). The expense drawer's PATCH follows the same rules as bulk when a calculated row's category
  changes, and a different tax figure typed there replaces the calculation.
- **Applying a code AFTER saving** (a statement expense that has no receipt attached - and only that):
  - **Drawer:** a "Tax code" picker (Taxable / Meals / No tax / "No code") on a calculated expense. Saving
    sends `tax_code` only if the picker changed; `PATCH /api/receipts/[id]` runs `drawerTaxCode()`, recalculates
    the tax tax-included from the total being saved (the form's own tax figure is ignored), and marks the code
    `tax_source 'line'` (the owner's own pick, so a later category change doesn't undo it). It refuses a
    receipt-attached, scanned or entered expense (400), and the update is guarded on `no_receipt = true`, so a
    receipt attached while the form was open wins (409 `RECEIPT_ATTACHED`).
  - **Bulk "Set tax code"** beside "Change category" (`POST /api/receipts/bulk-tax-code`, rules in
    `lib/bulk-tax-code-server.ts` + `lib/bulk-tax-code.ts`): same preview / apply / undo / stale-protection
    shape as bulk category. It NEVER touches a row with a receipt attached, a confirmed row, or a row whose
    tax the owner typed (a refund slip's HST); the preview says how many were skipped and why, and shows the
    calculated-tax and ITC effect. Apply sends back `[{id, prev}]` (each row's exact tax state at preview) and
    refuses (409 `STALE_PREVIEW`) unless every row is STILL a calculated row in exactly that state - recomputing
    the new tax server-side, never trusting the request. Undo restores only rows still exactly as apply left
    them (one edited or given a receipt since is left alone).
- 0057 is applied everywhere, so the temporary "retry without the new columns" fallbacks (bulk, Overview,
  materialize, and the 0055 `system_key` one) are gone; `statement-groups-static.test.ts` fails if a
  `42703` special case comes back. Migrations are applied BEFORE the code that needs them ships.

## Tax logic

`src/lib/hst.ts` computes a **planning estimate**, not a filing-ready
number - it's disclaimed as such in the UI. Two decisions worth preserving
if you touch it:

- CRA line numbers are 101 (total sales), 103 (HST collected), **106**
  (ITCs), **109** (net tax) - deliberately not 107/115, which were in an
  earlier draft of this feature and are wrong (107 is an unrelated
  adjustments line on the real CRA form; 115 doesn't exist on it at all).
  Verified against canada.ca directly; don't reintroduce those numbers.
- Meals & entertainment purchases get only a 50% ITC credit
  (`MEALS_ITC_RESTRICTION_RATE`), matching the real Excise Tax Act
  restriction - this is the one place the calculator intentionally departs
  from a flat pass-through of `receipts.tax_amount`.
- Invoiced revenue in Line 101/103 is built from **actual payments received
  within the selected period, pro-rated per payment**, not from an
  invoice's status or full total - see the `filteredRecognizedPayments`
  memo in `hst-summary-card.tsx`. A deposit is taxable revenue at the time
  it's received (CRA rule), so a $500 deposit on a $1,000 invoice received
  this quarter counts as $500-worth of pro-rated subtotal/HST this quarter
  even though the invoice won't be `'paid'` until the final payment lands,
  possibly next quarter. Don't regress this back to "sum full
  `total_amount` for every `status === 'paid'` invoice" - that was the
  pre-payments-table behavior and double-counts/mis-times deposits.

The itemized "Includes $X from N payments" list under Line 101 in
`hst-summary-card.tsx` lets a user uncheck one invoice's payments out of
the period entirely (`documents.excluded_from_hst`, toggled via
`PATCH /api/documents/[id]`) - the checkbox is per-*document*, so if two
payments on the same invoice both fall in the visible period, toggling
either one excludes both.

## Plan gating & pricing

Two independent gating mechanisms exist, don't conflate them:

- **Pro-only features** (invoicing/estimates/clients/logo/business profile):
  `requireProUser()` in `src/lib/require-pro.ts`, checked per-API-route.
- **Free-tier receipt scan cap**: enforced directly inside
  `POST /api/parse-receipt` (not via `requireProUser`) - a `free`-status
  user is blocked once their `receipts` row count reaches
  `FREE_SCAN_LIMIT` (from `src/lib/pricing-plans.ts`), *before* the route
  uploads the image or calls Gemini, so a blocked scan doesn't burn API
  cost. The block returns `{ error, code: "FREE_LIMIT_REACHED" }` with a
  403; the client (`upload-receipt.tsx`) matches on that `code` to show an
  "Upgrade" action button (linking to `/billing`) instead of a dead-end
  error toast. `basic` and `pro` users are exempt from this cap - Basic's
  entire value proposition today *is* unlimited scans vs. Free's capped
  ones, so don't let that cap silently regress to unenforced again.

`src/lib/pricing-plans.ts` (`FREE_PLAN`, `PRICING_PLANS`, `FREE_SCAN_LIMIT`)
is the single source of truth for plan copy, shared between the public
landing page pricing section (`src/app/page.tsx#pricing`) and the
authenticated `/billing` page's `PricingCards` - don't fork the plan
name/price/feature list back into either page individually, or they'll
drift. The landing page hardcodes a "Most Popular" badge onto whichever
card has `plan.tier === "basic"` (it's Basic that's meant to be the target
tier) - that condition lives in `page.tsx`, not in the shared plan data, so
it won't follow if `PRICING_PLANS`' ordering or tiers ever change. Note `/billing` itself requires a logged-in user (it shows current
plan + triggers real Stripe checkout), so it's not a valid target for a
signed-out "See pricing" link - that's what the landing page's own
`#pricing` section is for. Also note the price strings in
`pricing-plans.ts` are purely display copy - the amount actually charged at
checkout comes from whatever Stripe Price object `STRIPE_BASIC_PRICE_ID` /
`STRIPE_PRO_PRICE_ID` points at, so if that copy ever changes, the Stripe
Price objects need to be updated to match in the live "Edge Digital
Business Solutions" account specifically (see the Stripe note at the top of
this file) - updating the same-named Price in the "Taxsnap" sandbox account
doesn't affect production at all.

A downgrade through the Customer Portal - a cheaper plan (Plus<->Pro
included) or a shorter/cheaper interval on the same plan - is deferred via
a Stripe Subscription Schedule to the end of the current billing period;
an upgrade (pricier plan, or a longer interval) is invoiced and charged
immediately. Verified against real portal-driven sandbox tests (not direct
Subscriptions API calls, which always apply immediately regardless of the
portal config), for both a same-tier interval step-down and a cross-tier
downgrade. An earlier version of this note claimed Plus<->Pro could never
defer, reasoning from Stripe's documented "same Product only" restriction
on the portal's `schedule_at_period_end` feature - a real test directly
contradicted that (the `decreasing_item_amount`/`shortening_interval`
conditions do defer a cross-product change too). Don't trust that doc
claim over a real test again - if this behavior ever needs re-verifying,
drive an actual Customer Portal session (e.g. via the Dashboard's
Workbench Shell, `stripe billing_portal sessions create --customer ...`),
not a direct `subscriptions.update()` call, which proves nothing about
what the portal itself does. `BILLING_CHANGE_POLICY` in `pricing-plans.ts`
is the one place this is worded for users (FAQ, `/billing`,
`CurrentPlanCard`) - keep it in sync with this if either changes.

## Local dev / testing this app on a phone

**Local dev and production share one Supabase project** (verified
2026-10-02: `.env.local` and the live gettaxsnap.ca bundle both point at the
same `NEXT_PUBLIC_SUPABASE_URL`), and a push to `main` auto-deploys to Vercel
production. So: a migration must be applied (SQL Editor, by the user) *before*
pushing code that needs it, and any browser test or service-role script runs
against production data - use the test account only, undo every write, and
prefer read-only checks. A real staging project is a logged future task.

`npm run dev` (Turbopack) is fine for iteration, but **don't tunnel dev
mode** (ngrok, etc.) for real device testing - Turbopack serves
still-compiling chunks as `503` on first request, and over real network
latency this can silently break hydration with no visible error (page
looks fine, nothing is clickable). Build and run production instead:

```bash
npm run build && npm run start
```

...then tunnel `localhost:3000`. This project has hit that exact bug once
already; see git history / prior session notes if it resurfaces.

The service worker (`public/sw.js`) is **only registered in production builds**
(`register-sw.tsx` skips it when `NODE_ENV !== "production"`, and in dev also
unregisters any worker + `taxsnap-*` caches a previous session left behind) -
its cache-first handling of JS/assets made dev show stale copies of components
after code or branch changes. If dev ever looks stale anyway, DevTools ->
Application -> Clear site data for that origin. It is network-first for page navigations
and cache-first only for hashed static assets. If it ever gets reverted to
cache-first for pages, users will see a stale dashboard after every deploy
until they manually clear site data - don't do that.

The app is already a fully installable PWA (`public/manifest.json`,
service worker, generated icons) - it doesn't need "PWA-ifying," it already
is one. `src/components/install-prompt-cards.tsx` renders a landing-page
install prompt, but **Android and iOS are not symmetric**: Android/Chrome
fires a real `beforeinstallprompt` event, so that card has a genuine
one-tap "Install Now" button; iOS Safari has no equivalent API, so its card
is instructions-only (Share icon → "Add to Home Screen") - never word the
iOS side as a one-tap install, it can't deliver that. Relatedly,
`layout.tsx`'s `metadata.other` manually adds the legacy
`apple-mobile-web-app-capable` meta tag alongside Next 16's own
`appleWebApp.capable` output, because this Next version only emits the
modern unprefixed `mobile-web-app-capable` tag - Safari only started
honoring that unprefixed tag in iOS 16.4 (2023), so the legacy tag is kept
for older devices still in the field.

## Sharing invoices/estimates

`src/lib/invoice-pdf.ts` builds an itemized PDF client-side with `jsPDF`
(manual layout, no autotable plugin - keep it that way, it's a small
enough document that a table library is overkill). `ShareDocumentButton`
(`src/components/invoices/share-document-button.tsx`) branches on device,
not just capability:

- **Mobile** (real OS share sheet with file support): hands the PDF to
  `navigator.share({ files })` so it goes out through whatever the OS
  offers (WhatsApp, Messages, Mail, etc.) - the only way to attach a
  *file* to a share, since a `mailto:`/`wa.me` link can't carry one.
- **Desktop**: two explicit buttons instead of one Share button - `Email`
  opens a `mailto:` draft (prefilled to the client's email if on file,
  plus subject/body) with a toast reminding the user to attach the PDF
  since `mailto:` can't carry one, and `Download PDF` triggers the same
  PDF generation directly, always visible rather than hidden behind a
  fallback.

The device check (`isMobileDevice()` in that file) requires *both* a
mobile-shaped UA/touch signature *and* `navigator.canShare({ files })` -
capability alone isn't a reliable signal any more, since Edge/Chrome on
Windows and Safari on macOS now also support file sharing, which would
put the desktop-only buttons behind a check that's true on plenty of
actual desktops (this bit us once - the buttons silently didn't show up
on a real Windows machine during testing). Uses `useSyncExternalStore`
(see Stack quirks) so the desktop buttons are what SSR/first paint
render, only swapping to the single Share button once the browser's real
device+capability is known.

## Employee hour tracking & job costing

Pro-gated like invoicing (`requireProUser()` on every `/api/jobs`,
`/api/employees`, `/api/hours` route) - owner-entered, plus an optional
employee clock-in/out portal (see "Employee login & clock-in/out" below). See
"Database" above for the `jobs`/`employees`/`hour_entries` schema and the
job-name sync trigger.

- `/dashboard/jobs` -> `/dashboard/jobs/[id]` shows the job cost rollup:
  sum of tagged expenses (`receipts.total_amount` where `job_id` matches)
  + sum of labor (`hour_entries.labor_cost`) = true job cost.
  Navigation: **Jobs** and **Employees** are separate top-level tabs
  (`nav-config.ts`; general business only, Employees sits after Jobs and is in
  the mobile "More" sheet since the bottom bar's 4 primary slots are full).
  The Employees tab covers `/dashboard/employees` *and* `/dashboard/hours`
  (PIN management, who's clocked in, logging/correcting hours), with a small
  Employees | Hours toggle between them (`employees-nav.tsx`). Routes and data
  are unchanged - this is only which tab lights up.
- The receipt job picker (`upload-receipt.tsx`, `receipt-detail-dialog.tsx`)
  uses a `Select` with a "+ Add new job" inline-create option (same
  pattern as `new_client` on documents), not a native
  `<input list>`/`<datalist>` - that native pattern doesn't render as an
  actual dropdown on most mobile browsers, it just looks like a plain
  text box with nothing to pick from.
- Hours can't be dated in the future (manual Log/Edit hours; clocked sessions
  already refuse future times in `owner_edit_time_session`). Enforced in both
  `HourEntryDialog` (strict, against the person's local date, inline message
  "Date can't be in the future.") and `POST`/`PATCH /api/hours`
  (`lib/work-date.ts`, unit-tested: 400 with the same message). The API
  deliberately accepts up to *one day* past Toronto's today, because the browser
  sends the person's own local date and zones ahead of Toronto (Atlantic,
  Newfoundland) are already "tomorrow" for a short window after their
  midnight - the dialog is the strict one. An empty/malformed `work_date` is a
  400, never silently defaulted to today (only an *omitted* one is). Dialog
  errors show inline as well as in a toast: a toast alone lands in the far
  corner, dimmed behind the modal, and reads as "nothing happened".
- `DashboardHeader`'s top nav (Estimates/Invoices/Jobs/Commission) takes an
  optional `active` prop that highlights the current tab
  (`variant={active === X ? "default" : "outline"}`) - pass it from every
  page under that section (Jobs/Employees/Hours all pass `active="jobs"`
  since they share one tab, same idea for Commission's four pages passing
  `active="commission"`). `/dashboard` itself passes no `active`, so
  nothing is highlighted there.

## Employee login & clock-in/out (general business)

Migration `0043_employee_login.sql`. Employees sign in with **one shared
per-business link** (`/employee-login/[token]`, `app_settings.employee_login_token`,
`generateOpaqueToken()`, reusable until the owner regenerates it) + a
**4-digit PIN** each (name picked from a dropdown, so duplicate names are
harmless and PINs need not be unique). No email, no password, no `auth.users`
row, **no Supabase JWT ever issued** to an employee.

- **PINs live in `employee_pins`** (row exists == has a PIN), not as a
  column-revoked `pin_hash` on `employees` like stylists - a revoked column
  makes every bare `select("*")` / `employee:employees(*)` embed fail, and
  `employees` is selected that way all over. The table is revoked at the
  *table* level and re-granted per safe column (a column-level REVOKE does
  nothing while a table-level GRANT exists). Select it with explicit columns.
  `create_employee_pin` (rejects `PIN_ALREADY_SET`) and `reset_employee_pin`
  (rejects `PIN_NOT_SET`) are separate so an employee can't be set up twice;
  the Employees page row offers "Set PIN" only to someone with no PIN, and
  "Reset PIN" / "Remove login" only to someone who has one. **Per-employee PIN
  management lives only on the Employees page** (the single home for employees);
  The shared sign-in link (create /
  regenerate) is a card at the top of the Employees page too (`EmployeeLoginLinkCard`),
  so Employees is the one home for all employee login; Settings' "Employee login"
  section is only a pointer to it. `verify_employee_pin` is `service_role`-only, with the
  same 5-miss/15-min lockout as stylists, plus a per-IP failure throttle in
  `POST /api/employee-portal/login`.
- **Sessions are server-side** (`employee_sessions`: sha256 of an opaque
  `ts_emp_session` httpOnly cookie). **Fixed 30 days from sign-in**, not sliding:
  the cookie is set once at login with a 30-day expiry and nothing re-issues it,
  so the browser stops sending it at day 30 whatever the session row says.
  (`lookupEmployeeSession` does push the row's `expires_at` forward on use, but
  that never extends the cookie, so it has no practical effect - don't mistake
  it for a working sliding session, and don't build one: it was decided not to be
  worth the complexity.) Resetting/removing a PIN, deactivating the employee (DB
  trigger), or regenerating the link deletes the rows, cutting access on the next
  request.
- **Route protection is default-deny and lives in `proxy.ts`**
  (`lib/supabase/middleware.ts` -> `decideEmployeeAccess` in
  `lib/employee-route-guard.ts`, unit-tested: `npm test`). With a valid
  employee cookie and no Supabase user, every page outside `/employee/**` and
  `/employee-login/**` redirects to `/employee/hours`, and every `/api/**`
  outside `/api/employee-portal/**` gets a JSON 403 - so a route added
  anywhere else tomorrow is already unreachable to employees. Anything added
  *under* those prefixes must call `requireEmployeeSession()` (login/logout
  excepted). A real owner session always wins over a stale employee cookie.
  An invalid/expired cookie is cleared by the proxy. Unlike the salon staff-mode
  guard (a client-side nav gate on the owner's own session), this is a real
  boundary: employees never hold a Supabase session, and all their data access
  is server-side via the service client keyed off the verified session row -
  never an id from the request body.
- **Clock sessions** (`time_sessions`) are separate from `hour_entries`: closing
  or editing one writes the linked `hour_entries` row (`time_session_id`) in the
  same transaction via `_sync_time_session_entry`, so job costing is untouched
  and an open session never leaks into it. All timestamps are server time;
  `work_date` is the clock-in date in `America/Toronto`. Rates are snapshotted
  at clock-in. A unique partial index + a gist exclusion constraint make two
  open (or overlapping) sessions per employee impossible. **A second clock-in is
  blocked, never auto-closed** (auto-closing would guess an end time and silently
  book a bogus long session); the employee is told what is open. Hours/date on a
  session-linked `hour_entries` row can't be edited or deleted directly
  (`LINKED_TO_SESSION`) - edit the session (rate edits are still allowed).
- **Owner side**: Employees page shows "Clocked in since X" per employee (turns
  destructive after 12h, `STALE_SESSION_HOURS`), a Close-session dialog
  (`owner_close_time_session`), and a Sessions dialog to edit either timestamp
  (`owner_edit_time_session`). Owner-closed/edited sessions are flagged with a
  visible badge and keep their `original_*` times. The same time editing is
  on the Hours page (clocked rows get a "Clocked" badge, time range, pencil ->
  `EditSessionTimesDialog`; manual rows get the regular Edit hours dialog).
  A session can be deleted (open or completed, from Hours or the Sessions
  dialog) via `owner_delete_time_session` (`0045`), which deletes its linked
  `hour_entries` row in the same transaction - never leave the entry behind,
  the FK is `ON DELETE SET NULL` and would turn it into a manual entry.

## Client portal (Pro)

Migration `0050_client_portal.sql`. A read-only login per client, built on the
employee-login pattern: a **PIN-only** sign-in at a **per-client** link
(`/client-login/[token]`, `client_portal_logins.link_token`) - unlike employees'
one shared link + name dropdown, because a shared picker would list the owner's
other clients. No email, no password, no Supabase JWT ever issued.

- **Tables**: `client_portal_logins` (row exists == has a login; PIN hash
  revoked at the table level, only `link_token` etc. re-granted - same trap as
  `employee_pins`), `client_sessions` (service-role only, sha256 of the
  `ts_client_session` cookie; fixed 30 days from sign-in, same as employees -
  see above), `client_login_failures`
  (per-IP throttle). Owner functions `create_client_portal_login`,
  `reset_client_portal_pin`, `regenerate_client_portal_link`,
  `remove_client_portal_login`; `verify_client_pin` is `service_role`-only,
  5 misses = 15-minute lockout. Reset/regenerate/remove each delete the
  client's sessions; deleting the client cascades.
- **Default-deny in `proxy.ts`** (`lib/client-route-guard.ts`, unit-tested): a
  valid client cookie with no Supabase user may only reach `/client/**`,
  `/client-login/**`, `/api/client-portal/**`. That includes blocking
  `/invoice/[token]` and `/sign/[token]`, so the portal can never reach the
  interactive signing flow. Anything added under those prefixes must call
  `requireClientSession()`. Both portal logins clear the *other* cookie so the
  employee and client guards never disagree.
- **What a client sees**: documents past `draft` for their own `client_id`,
  nothing else. `PORTAL_DOCUMENT_COLUMNS` in `lib/client-portal.ts` is an
  explicit column list (never `*`), pinned by a test; a second test asserts the
  portal code never queries jobs/receipts/hours/contract_changes. Pending
  change orders live in `contract_changes`, not `documents`, so they can't
  appear - a billed one shows up as an ordinary invoice. Every query filters on
  `user_id` + `client_id` from the verified session row, never a request value.
- **Outstanding Balance** = sum of per-invoice `max(total - paid, 0)` over
  issued invoices, all-time (the date picker only filters the list, with a
  separate "Invoiced in this period" line). Estimates never count. The label
  and the "invoices issued to you only" note are deliberate - keep them. It is
  per-invoice clamped, so it can differ slightly from the owner's
  `buildClientSummaries` outstanding figure, which nets everything together.
- **Rendering and PDF reuse existing code**: `/client/documents/[id]` renders
  `PublicDocumentPaper` (the same renderer as `/invoice/[token]`; no second one).
  Download PDF fetches `GET /api/client-portal/documents/[id]` (whitelisted
  fields) and builds the PDF in the browser with `generateDocumentPdf` passing
  `includeProgressSummary: false`, because that block prints the job's contract
  value (job data). The portal also nulls `draw_description` /
  `draw_percent_complete`.
- **Owner side**: `ClientPortalAccess` on the client detail page
  (`/api/clients/[id]/portal`, `requireProUser()`), plus a "Portal" badge in the
  clients list. PINs are never shown again after being set.

## Accountant portal (Pro)

Migration `0051_accountant_portal.sql`. ONE read-only login per business (one
shared PIN for the accountant and their firm), created from Settings ->
Accountant access (`AccountantAccessSettings`, `/api/accountant-access`,
`requireProUser()`). Same shape as the client portal: per-business link
(`/accountant-login/[token]`) + 4-digit PIN, no email, no Supabase JWT. Tables
`accountant_logins` (keyed by `user_id`; PIN hash revoked at the table level,
`last_login_at` shown in Settings), `accountant_sessions`,
`accountant_login_failures`; `verify_accountant_pin` is `service_role`-only with
the same 5-miss / 15-minute lockout.

- **Session: fixed 14 days from sign-in** (`ACCOUNTANT_SESSION_TTL_DAYS`,
  deliberately shorter than the 30-day employee/client sessions: an accountant
  works in bursts and sees every financial record). `expires_at` is written once,
  at login, and the cookie expires with it. There is NO sliding-expiry write for
  this portal at all (a test asserts nothing updates `accountant_sessions`).
  Reset PIN / New link / Remove login delete the session rows.
- **The scoping problem and `ScopedReader`**: the owner's pages read through
  an RLS-scoped client, which an accountant doesn't have, and the shared query
  functions (`getReportsData`, `getJobSummary`, `getRevenueDetail`,
  `getExpenseDetail`, `getExpenseOverviewData`) have **no user_id filter** -
  RLS does that. Passing them a service-role client would return every business's
  data. So the portal reads only through `lib/scoped-reader.ts`: an allowlist of
  tables (receipts, documents, hour_entries, jobs, employees, bank_accounts,
  expense_categories), `.eq("user_id", sessionUserId)` on every read, and no
  insert/update/delete/rpc at all. Those query functions take a `ReadDb`, so the
  owner passes a real client and the accountant passes the reader, with one
  implementation. payments/document_items have no user_id and are reachable only
  as embeds of a filtered `documents` row. Anything outside the list (clients,
  employee_pins, contract_changes, commission/salon tables, billing) throws.
  Raw `admin` is for storage signing and the business profile only.
- **Fixed scope, no toggles**: Reports (the real `ReportsView` via its
  `endpoints` context: P&L, Job Summary, Expenses by Category, By Account, with
  the usual date-range/account filters and drill-downs), the full expenses list
  (with receipt photos via a re-verified signed URL), the full invoices/estimates
  list (drafts included and badged) with a read-only document page + payments +
  PDF, Employee Hours (hours and cost only), and the on-demand export bundle.
  Not reachable: client portal management, employee PINs, settings, salon data.
- **Export reuse**: `downloadAccountantExport` was split into gathering the
  inputs and `buildAndDownloadAccountantExport` (the zip). The owner path still
  gathers with its browser client; the accountant path gets the same inputs from
  `/api/accountant-portal/export-data` and signs photo/logo URLs lazily via
  `.../signed-urls` (only paths on this business's own receipts are signed).
- **Route protection** is the same default-deny in `proxy.ts`, now one shared
  `decidePortalAccess` (`lib/portal-route-guard.ts`) with thin per-portal wrappers
  (`employee-`/`client-`/`accountant-route-guard.ts`) and a generic loop in
  `lib/supabase/middleware.ts`; the three login routes clear the other portals'
  cookies via `clearOtherPortalCookies`. The portal stays closed (a "not
  available" screen, API 403) while the business isn't on Pro and reopens on
  re-upgrade; pages must check `ctx.available` and routes use
  `getAccountantApiContext()` (both enforced by `accountant-portal.test.ts`).

## Commission tracking (per-stylist)

Fully separate from job costing above - `stylists` are commission-based
service providers, not hourly `employees`. Same Pro-gating, same
owner-only entry (no stylist login), same tax boundary
(`commission_owed` never touches `sales`/`documents`/`payments`/`hst.ts`).

- `/dashboard/commission` is the front-counter logging screen
  (`CommissionLogger`): a 3-tap flow - tap a color-coded service card,
  then a stylist card, then a dedicated customer-name **step** (full
  screen area, not an overlay) with a back link (`Service → Stylist`), a
  price recap, a "Customer name (optional)" input, and a large full-width
  Submit button. Nothing saves until Submit is pressed - there's no
  auto-save on the stylist tap and no auto-dismiss timer on the name
  field, replacing an earlier 2-tap/auto-save/5s-timer design that made
  the customer field overlap the Undo toast. Submit works with the field
  left blank (stored as `customer_name: null`); there's no separate skip
  control, the button itself doubles as skip. On success the flow resets
  straight back to the service grid and a toast with an Undo action
  appears bottom-right - since nothing renders as a bottom-fixed overlay
  anymore, it never visually collides with anything. A failed submit
  (`fetch` throws or the API errors) shows an error toast and **stays on
  the customer-name step** with whatever was typed still in the field,
  rather than resetting - so a dropped connection doesn't make the owner
  retype the name.
- `price_charged`/`commission_rate_applied` are looked up **server-side**
  from the service/stylist rows at save time
  (`POST /api/commission-entries`), never trusted from the client - there's
  no editable price/rate step in this flow to tamper with anyway, and it
  guarantees the snapshot reflects what was actually on file at the moment
  of Submit.
- `/dashboard/commission/services` and `/dashboard/commission/stylists`
  are standard add/edit/deactivate management screens
  (`ServiceList`/`StylistList`), same shape as `EmployeeList`.
- `/dashboard/commission/reports` (`CommissionReports`) reuses
  `DateRangeFilter`/`src/lib/date-range.ts` for the range picker - that
  shared file gained `"today"` and `"this-week"` presets for this feature
  (previously only month/quarter/year/all-time/custom existed), so it now
  benefits any other date filter in the app too. Date-range filtering for
  this report happens **server-side** in `GET /api/commission-entries`
  (`?stylist_id=&from=&to=`), not via the client-side `filterByRange`
  helper used elsewhere - `commission_entries.created_at` is a
  `timestamptz`, and comparing that against a bare `YYYY-MM-DD` upper
  bound string would silently exclude anything logged later in the last
  day of the range (`"2026-08-31T23:59:59Z" > "2026-08-31"` as a plain
  string compare), so the route uses an exclusive `< nextDay` bound
  instead. That component's `useEffect` **always** refetches on mount, not
  just on filter changes - an earlier version skipped the fetch when
  landing with the default filter (relying on the server-rendered
  `initialEntries` alone), which showed stale totals when navigating here
  via the in-app nav right after logging new entries on the Log tab (the
  single most common way to reach this page) - Next's client-side router
  cache can serve an old RSC payload from an earlier visit in the same
  session, and nothing was forcing a correction.
- PDF/share generation for the per-stylist report reuses the *same*
  drawing primitives as `generateDocumentPdf` (invoices/estimates), not a
  parallel PDF system - `drawPdfHeader`/`drawTableHeader`/`drawTableRow`/
  `drawTotalsBlock` were extracted from `invoice-pdf.ts` into exported
  helpers that both `generateDocumentPdf` and the new
  `generateCommissionReportPdf` build on. Likewise, the mobile-vs-desktop
  share/download/email device check was extracted from
  `share-document-button.tsx` into `src/lib/share-capability.ts`, shared
  by both that component and the new `CommissionReportShareButtons`.
- **No offline write queue exists anywhere in this app** (checked
  `public/sw.js` directly - it explicitly bypasses every non-GET request
  and everything under `/api/*`). A dropped connection at Submit just
  fails the `fetch()` with no retry/queue - see the failed-submit behavior
  above (stays on the customer-name step, error toast, re-enabled Submit
  button to retry manually) rather than silently resetting to the service
  grid, so a failed save doesn't look like it worked. Building a real
  offline outbox (IndexedDB + background sync) was deliberately treated as
  separate future scope, not bundled into this feature.

## Card statement import (allowlist-only)

Migrations `0052_statement_import.sql` (tables + service-role functions) and
`0053_statement_import_receipts.sql` (receipts columns + delete trigger); rollbacks
are in `supabase/rollbacks/` and are NOT in `migrations/` on purpose (0053's first).
`0054_vendor_rules.sql` adds the `vendor_rules` table (per-card rules plus an any-card
fallback: vendor key -> category; it has no tax column yet - a vendor's tax code is a later phase, see
"Tax codes") and four `statement_lines` columns
for "where did this suggestion come from" - **schema only: no app code reads or writes
rules yet**. It also REPLACES `rename_expense_category()` (the original plus one `perform
follow_category_rename(...)`), so renaming a custom category also renames its rules and
open drafts; that helper is a `SECURITY DEFINER` acting only on `auth.uid()`'s rows because
the rename function runs as the user and owners can't write those tables directly.
`0055_category_system_key.sql` adds `expense_categories.system_key` (see "Bank charges" below);
until it is applied the code falls back to finding that category by its name.
Import a card statement (PDF or photos), review every line, match lines to existing
receipts, save the rest as expenses. **Off for everyone** unless the user's id is in
`STATEMENT_IMPORT_USER_IDS` (comma-separated, no wildcard; `lib/statement-config.ts`):
routes return 404 and the Expenses page renders none of it. Monthly caps are
`PLAN_LIMITS.*.statementImportsPerMonth` - **provisional placeholders** until real
token cost is measured (`statement_imports` records input/output tokens per import).

- **The statement file is never stored.** The browser hashes it, splits a PDF into
  3-page chunks (1-page if a chunk would exceed the ~4 MB request limit; photos are
  one chunk each) with `pdf-lib`, and posts one chunk at a time; the route reads it
  into memory, sends it to Gemini, drops it. Only extracted lines, the SHA-256 and
  token counts are kept. Limits: 20 MB, 30 pages, 500 lines.
- **A PDF pdf-lib can't open** is not always unreadable. pdf-lib's errors are plain
  `Error`s (`instanceof EncryptedPDFError` is false even for an encrypted file), so
  `classifyPdfError` matches the message (`is encrypted`). An owner-password-only PDF
  (common for banks) can't be split but Gemini reads it whole, so if it's under 4 MB
  and has at most 10 known pages (`STATEMENT_WHOLE_FILE_MAX_PAGES`) it is sent as ONE
  chunk; otherwise the user is told which case it is (password-protected vs damaged).
  A user-password PDF can't be told apart until Gemini rejects it (400 ->
  `UNREADABLE_FILE`, 422, never auto-retried).
- **Writes**: the three statement tables are owner-SELECT-only (RLS + table grants);
  every write is a `service_role`-only function or a service-client call in
  `/api/statements/**`, using the user id from the verified session. Reads go through
  the user's own session. `statement-import-isolation.test.ts` proves one user can't
  read or write another's rows.
- **Per-chunk retry**: `save_chunk_result` replaces only that chunk's lines;
  `fail_chunk` keeps attempts/tokens; chunk 1 runs first (its header gives the period
  for year inference). Fingerprints (`md5(account|date|amount|nth occurrence)`,
  deliberately no description - OCR wording varies) are assigned only once every chunk
  is done (`finalize_statement_lines`).
- **Matching** (`statement-matching.ts`, one matcher for both directions: import
  lines -> receipts, and a scanned receipt -> statement expenses awaiting a receipt).
  Kinds, best first: **vendor** (same vendor AND the exact same amount, within 30 days
  either way - bills/utilities are invoiced before they're charged: invoice Feb 8, charge
  Feb 22), **exact** (same cent amount within 3 days, any vendor), **near** (4-7 days, or
  within $1/5%). A vendor+amount match always outranks a close-amount guess. "Same
  vendor" is `vendorKey` equality (`merchant-name.ts`): cleaned name, store numbers and
  punctuation dropped, only trailing legal/generic words (Inc, Canada, Communications...)
  removed - so Rogers == Rogers Communications Canada Inc. but **Shell != Shell Energy**
  and Home Depot != Home Hardware (a looser prefix rule was rejected on purpose; tests
  mutate it to prove they fail). Nearest wins only when clearly nearest: a runner-up of
  the same kind within `STATEMENT_TIE_MARGIN_DAYS` (2) is a tie and the person chooses.
  The attach dialog PRESELECTS (`pickPreselect`), never attaches silently. Import
  auto-accept needs mutual-nearest for a vendor match (two identical monthly bills pair
  off by date) or a sole candidate on both sides for an exact one; near is never
  auto-accepted. Expenses that already have a receipt are excluded (attach only reads
  `no_receipt` rows; import excludes claimed receipts). One-to-one is also enforced by a
  unique index. Refunds, fees, interest and payments never match.
- **Attach changes the date**: the receipt's date replaces the expense's, so if that
  crosses a calendar month (and maybe quarter) the person must choose which date to
  keep - no default, enforced server-side (`attachDate`, 409 `DATE_CHOICE_REQUIRED`;
  `statement-attach-period.ts`). `GET /api/statements/attach-candidates?mode=browse`
  backs the manual picker: every waiting expense, ranked (matcher candidates first),
  searchable, 100 per page with "Show more" (`statement-browse.ts`); the plain call also
  returns `waiting_count`, which is what decides whether the picker is offered at all.
- **The attach picker** (`attach-picker.tsx`) is a second VIEW inside the receipt review dialog,
  not a nested dialog (stacked Base UI modals fight over focus and scroll-lock). A chosen
  expense joins the banner as "chosen by you". If the receipt total differs from the card
  amount the person must tick "I've checked the amounts"; that and the date choice are keyed to
  EXACTLY what was confirmed (ids, dates, cents), so editing anything afterwards silently
  invalidates them. Editing the merchant, total or date in the review form re-runs the lookup
  after a 600 ms debounce (`loadAttachCandidates(..., keepChoice=true)`, stale answers dropped),
  keeping a choice that is still on offer. Gotcha: the dialog is a CSS grid, so a grid child
  needs `min-w-0` or a long list widens the column and adds a horizontal scrollbar.
- **"Already imported"** lines are flagged at finalize and re-checked at commit under a
  per-user lock; they default to skipped but stay visible, and Import anyway sets
  `duplicate_override`. Commit refuses unoverridden duplicates (`DUPLICATE_LINES`).
- **Saved expenses** have `from_statement`, `no_receipt` and a CALCULATED tax from a tax code,
  or tax 0 flagged "needs a tax code" when none applies - see "Tax codes" below (this reverses
  the original "tax_amount = 0, never estimated" rule). Scanning the receipt later offers to
  attach to that row (`/api/receipts/[id]/attach`: photo, HST, items, merchant, date; keeps the
  statement's amount, category, paid-with) rather than create a second expense; the receipt's
  actual tax REPLACES the calculated one and the tax code is cleared. **Refunds** save as negative
  expenses whose tax is calculated with the same code (a credit), or the figure the owner typed
  from the refund slip; `receiptsToQuickBooksCsv` writes them to the Deposit column as a positive
  with a "Refund - " prefix, never a negative Payment.
- **"Bank charges"** (where interest and fees are filed) is deliberately not in global
  `TAX_CATEGORIES` (that list feeds the receipt scanner for every user). It is an ordinary custom
  category of the owner's, created the first time a saved statement uses it (which also stops
  `resolveCategory()` turning it into "Other") - and found again by a STABLE KEY, not its name:
  `expense_categories.system_key = 'bank_charges'` (0055). The owner can rename it ("Bank fees")
  and the import keeps using it under the new name, with no second "Bank charges" created;
  if they REMOVE it, that is respected: fees/interest get no suggestion and the import never
  recreates or reactivates it. `statement-categories.ts` (`resolveBankCharges`: active /
  virtual / removed) is the pure core, `statement-bank-charges.ts` the server half
  (`ensureBankChargesCategory`, falling back to name matching if 0055 isn't applied). The AI
  prompt and `sanitizeChunk` take the CURRENT name (`bankChargesCategory`, null when removed).
  A decoy a user creates AFTER renaming the real one just stays an ordinary category.
- **Merchant names**: `commit_statement_import` saves each expense under the line's raw
  description ("ROGERS *************3771"); the commit route then runs
  `tidyMerchantNames` (`lib/statement-merchant.ts`) which renames just the expenses that
  commit created via `cleanMerchantName` (`lib/merchant-name.ts`: strips masked numbers
  (runs of 2+ `*`), phone numbers and a trailing province/city from a Canadian city list,
  re-cases ALL CAPS; keeps store numbers `#7042`, a city after "of", and a lone `*`).
  It is best-effort (a failure leaves the raw name), only applies while the name is still
  what commit wrote (never overwrites a user edit), and the statement line's own
  `description` is never modified. The review screen shows "Saved as ...".
- **Gemini**: `thinkingLevel: LOW` (measured on a synthetic 3-page statement: 2,882
  tokens/3.6 s vs 5,500/13 s at default, same lines) and a 50 s abort so a slow call is
  recorded as a retryable failed chunk before Vercel's 60 s kill.
- A daily Vercel Cron (`vercel.json`) purges drafts untouched for 14 days via
  `purge_stale_statement_drafts` (lines deleted, a tombstone row kept so the cap and
  cost audit still count it). The route needs `CRON_SECRET` and refuses without it.
- **DB tests hit the shared project**: `statement-import-isolation.test.ts` and
  `statement-import-db.test.ts` create and delete throwaway auth users, run only with
  `RUN_DB_ISOLATION_TEST=1` (see each file's header), and the 0053 cases skip until that
  migration is applied.

## Saved statements: the Statements list, Delete statement and Re-import

Migration `0058_statement_line_release.sql` (+ rollback; cost of goods is now 0059) adds
`statement_lines.released_at` / `released_from` and REPLACES the 0053 trigger
`release_statement_lines_on_receipt_delete()` (the original body plus those two assignments). Before it, deleting
an expense freed its line by rewriting it to `skipped`, ERASING what it was; now the line remembers
(`released_from` 'new_expense' or 'matched'), so a saved statement's created/matched/skipped counts stay true after
deletes. Lines freed before 0058 stay "not saved" (history already gone) - no backfill is guessed.

- **Where it lives:** `/dashboard/expenses/statements` (list; `?deleted=1` shows deleted ones) and
  `/dashboard/expenses/statements/[id]` (the same route as the draft review: a draft is the review screen, a
  saved or deleted import is the read-only detail). Reached from a "Statements" button on Expenses - NOT a new
  nav tab. **Every href comes from `lib/statement-routes.ts`**, and the UI is route-agnostic, so the Bank tab can
  take it over by changing that one file. All of it is behind `STATEMENT_IMPORT_USER_IDS`
  (`requireStatementUser` / `getStatementPageCtx`) and nothing is in the accountant portal
  (`statement-groups-static.test.ts` asserts both).
- **Outcomes** (`statement-summary.ts`, pure): new_expense, matched, expense_deleted, match_removed, excluded,
  payment. *Free* lines (what a re-import could bring back) = excluded + expense_deleted + match_removed;
  **payments are never free**. The reconcile label comes from `reconcile_diff`: 0 = "Reconciled"; an accepted
  difference = "Difference acknowledged ($x)" and is NEVER called reconciled.
- **Delete statement** (`statement-delete.ts` + `statement-groups-server.ts`, `POST /api/statements/[id]/delete`):
  always a preview first, never automatic. Deletes the statement's expenses with NO receipt attached; frees the
  line of a matched receipt (the receipt is never deleted); marks the import `discarded` LAST so the same file can
  be uploaded again. **An expense that has a receipt attached stays AND its line stays linked to it on
  purpose**: statement-created expenses aren't import match candidates, so freeing that line would let a
  re-import create a second expense for the same charge. (If that expense is deleted later, the trigger frees
  the line then.) Apply sends back what the preview showed; if anything changed (a receipt attached, an expense
  deleted by hand) nothing is written (409 `STALE_PREVIEW`, fresh counts), and each delete is also guarded on
  `no_receipt = true`. The steps are idempotent, so a half-finished run is just run again. Deleted statements are
  hidden behind "Show deleted"; their lines stay as history.
- **ALREADY_IMPORTED + Re-import:** the refusal now carries the saved import's date, how many of its expenses
  still exist, what a re-import would bring back ("N lines you excluded and N lines whose expense was
  deleted"), the cap and a link to Statements (`alreadyImportedFor`). **Re-import** is offered only when at least
  one line is free: `POST /api/statements` with `reimport_of` validates it against what is saved, checks the cap,
  retires the old import (committed -> discarded) and starts a fresh draft in one request; if starting fails the
  old import is put back. **It is charged like any import** (it reads the statement again): the retired import
  still counts, so with the provisional caps one re-import in the same month uses 2 slots. Line fingerprints keep
  protecting every line whose expense still exists. `torontoMonthStart()` makes the app's usage count match the
  database's.
- The expense drawer shows "From statement: TD, Jan 6 to Feb 5 - View" (`StatementLink`,
  `GET /api/statements/for-receipt/[receiptId]`), or "From a deleted statement".

## Auth

Supabase Auth via `src/app/auth/auth-form.tsx`: magic link, email/password,
and Google OAuth (`supabase.auth.signInWithOAuth({ provider: "google" })`).
All three funnel through the same `src/app/auth/callback/route.ts`, which
just does a generic `exchangeCodeForSession(code)` - it doesn't need to
know which method produced the code, so adding another OAuth provider
later needs no callback changes.

Google sign-in requires two manual steps outside this repo before it'll
work: a Google Cloud OAuth client (redirect URI =
`<project>.supabase.co/auth/v1/callback`), and enabling Google under
Supabase Dashboard -> Authentication -> Providers. Until that's done it
fails with a "provider is not enabled" error from Supabase itself, not a
bug in the client code.

Account linking (verified against Supabase's own docs, not assumed):
automatic identity linking is on by default - if a Google sign-in's email
matches an existing user whose email is already confirmed, Supabase links
the new identity to that same `auth.users.id` rather than creating a
duplicate. Because `handle_new_user()` (see Database above) only fires on
a genuine new `auth.users` insert, a linked sign-in doesn't touch
`profiles` - existing receipts/documents/subscription stay intact under
the same id. This depends on "Confirm email" staying enabled for the
Email provider (it already is, per the sign-up flow's own "check your
email to confirm" copy) - if that's ever disabled, an unconfirmed
password account's email becomes fair game for a different Google
account to claim.

## Conventions

- API routes return `{ error: string }` with a matching HTTP status on
  failure, and the resource key (`{ receipt }`, `{ document }`, etc.) on
  success.
- Client components that edit-in-place (receipt detail, document detail)
  follow the same shape: local `isEditing` state, a `toForm()` mapper, PATCH
  on save, `onUpdated`/`onSaved` callback bubbles the fresh row back up to
  the parent's list state instead of refetching.
- Don't add a new "Invoice"-shaped feature outside the `documents` table -
  the old flat `invoices` table from an earlier prototype was intentionally
  retired in favor of `documents`/`document_items`/`clients`. It may still
  exist in Supabase, unused; don't resurrect code that reads from it.
