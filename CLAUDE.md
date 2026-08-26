@AGENTS.md

# TaxSnap

Mobile-first PWA for self-employed trade contractors (painters, handymen,
barbers) to snap receipts, auto-categorize tax write-offs with AI, track
Ontario HST, and invoice clients. Next.js 16 (App Router, Turbopack) + React
19 + TypeScript + Tailwind v4 + Supabase (Postgres/Auth/Storage) + Google
Gemini + Stripe (billing UI built, keys still placeholder - not live).

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
  for the correct pattern.
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
  iOS detection) for the pattern.

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
(see above). Dark mode CSS exists (`.dark` class + tokens) but nothing
currently toggles it - no `next-themes`, no `prefers-color-scheme` media
query wired up. That's intentional/pre-existing, not a bug to fix
incidentally.

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
`/api/profile/logo`, `/api/profile/business`.

## Receipt parsing

`src/lib/gemini.ts` builds the Gemini system prompt dynamically per request
with today's date (`buildSystemPrompt(today)`), because a bare numeric
receipt date like `26/08/23` is genuinely ambiguous - it could be DD/MM/YY,
MM/DD/YY, or YY/MM/DD, and there's no reliable single convention across
receipt printers/POS systems. The prompt resolves the ambiguity by recency:
prefer whichever valid reading lands closest to today and never in the
future, unless the receipt has an unambiguous signal (a month name, a
4-digit year). This is a heuristic, not a guarantee - it will misread a
receipt that's genuinely years old if the user is scanning it late for a
catch-up write-off, but that's rare next to "receipt photographed within
days of purchase." Don't revert to a fixed DD/MM/YY (or any fixed order)
assumption; that's what caused a real misparse (`26/08/23` read as Aug 26
2023 instead of Aug 23 2026).

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
drift. Note `/billing` itself requires a logged-in user (it shows current
plan + triggers real Stripe checkout), so it's not a valid target for a
signed-out "See pricing" link - that's what the landing page's own
`#pricing` section is for. Also note the price strings in
`pricing-plans.ts` are purely display copy - the amount actually charged at
checkout comes from whatever Stripe Price object `STRIPE_BASIC_PRICE_ID` /
`STRIPE_PRO_PRICE_ID` points at in the Stripe dashboard, so if that copy
ever changes, the Stripe Price objects need to be updated to match once
billing goes live.

## Local dev / testing this app on a phone

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

The service worker (`public/sw.js`) is network-first for page navigations
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
(`src/components/invoices/share-document-button.tsx`) hands that PDF to
`navigator.share`/`navigator.canShare({ files })` so it goes out through
whatever the OS share sheet offers (WhatsApp, Messages, Mail, etc.) -
that's the only way to attach a *file* to a share; a `mailto:`/`wa.me`
link can't carry one. Falls back to a plain download when the Web Share
API or file sharing isn't available (most desktop browsers).

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
