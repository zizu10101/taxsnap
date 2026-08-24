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

## Database

Tables (see `supabase/migrations/*.sql`, run in order - **Supabase CLI
isn't linked**, so every new migration has to be pasted into the Supabase
SQL Editor by the user manually; always give them the exact SQL after
adding a migration file, and don't assume a prior one was actually run -
check via a `select` against the table with the service-role key if
unsure):

- `profiles` - one row per auth user (trigger-created on signup),
  `subscription_status` ('free'/'basic'/'pro') gates invoicing, `logo_url`
  points at the business logo in the `logos` storage bucket.
- `receipts` - AI-parsed expense records, `job_name` (optional, free text)
  lets a user filter/report receipts by job.
- `sales` - manually-entered gross sales/cash-deposits per period, keyed by
  `(user_id, period_label)`, feeding the HST calculator.
- `clients`, `documents`, `document_items` - the Pro invoicing/estimates
  system. `documents.type` is `'invoice' | 'estimate'` (one unified table,
  not two); `document_items` has no `user_id` column, so its RLS policies
  check ownership through a subquery on the parent `documents` row.

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
`/api/documents`, `/api/profile/logo`.

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
