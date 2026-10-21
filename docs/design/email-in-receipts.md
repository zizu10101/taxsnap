# Email-in receipts: design (research only, nothing built)

Status: DRAFT for decision. October 2026. Written from provider documentation read on the day, plus this repo.
No DNS was changed, no provider account was touched, no app code was written.

**Feature:** a Pro user forwards a receipt to their own TaxSnap address. The attached image or PDF (or, with no
attachment, the email body) is scanned into an expense, like a photo upload.

How to read the facts below: **[verified]** = stated on the provider's own documentation page I read;
**[not stated]** = the page I could reach did not say; **[unverified]** = from a search snippet or third party, or
my own estimate. Anything marked [not stated] or [unverified] is on the decision list (section 8) to be settled
before money or DNS is committed.

---

## 0. Facts about this repo that shape the design

| Fact | Where | Why it matters |
|---|---|---|
| Outbound email already goes through **Resend**, sending domain `gettaxsnap.ca` | `src/lib/email.ts` | Resend is already a sub-processor and already verified for our domain |
| The main domain's mail is **Google Workspace**: `MX 1 aspmx.l.google.com`, `5 alt1/alt2`, `10 alt3/alt4`. DNS is hosted at **GoDaddy** (`ns55/ns56.domaincontrol.com`), not Cloudflare. `in.gettaxsnap.ca` has no records today. | read-only public DNS lookup, 21 Oct 2026 | The inbound subdomain must not touch the apex MX. Cloudflare Email Routing would need the zone (or a subdomain) moved to Cloudflare |
| The scan route is user-session based: cap check, exact-file hash check, upload to the private `receipts` bucket, Gemini, then **the person reviews and saves** (`POST /api/receipts`) | `src/app/api/parse-receipt/route.ts`, `src/app/api/receipts/route.ts` | Email-in has no person in the loop. It needs a service-role variant and a "needs review" state |
| Free: 5 scans/month. Pro: `scansPerMonth: null` (unlimited). The Free count is `receipts` rows this month with `origin is null` (changed in 0071 so Stripe-fee expenses don't count) | `src/lib/plan-limits.ts`, parse-receipt route | **That count would not see `origin = 'email'` rows.** It must change to "origin is distinct from 'stripe'" (section 4.3) |
| `receipts.origin` currently allows only `'stripe'`, and a trigger lets only the service role set it | migration 0071 | Needs `'email'` added (section 5) |
| Gemini model is `gemini-3.6-flash`; receipts record no token usage (statement imports do) | `src/lib/gemini.ts` | Cost per email is an estimate until we log `usageMetadata` |
| Statement import already notes a **~4 MB request-body limit** on our serverless functions; the scan route sets `maxDuration = 60` | CLAUDE.md "Card statement import"; parse-receipt route | A provider that POSTs attachments inline in the webhook cannot deliver anything over ~4 MB to a Vercel route (section 1.8) |
| Uploads: 10 MB max; types allowlist in the scan route (images + PDF) | parse-receipt route | Reuse the same limits for email |

---

## 1. Inbound email options

### 1.1 Resend (receiving)

- **Offered: yes.** Receives mail for "any address at your domain" (so `receipts-<token>@in.gettaxsnap.ca` needs no per-user setup). [verified]
- **Webhook:** event `email.received`. The payload is **metadata only**: `email_id`, `from`, `to`, `cc`, `bcc`,
  `received_for`, `message_id` (the RFC Message-ID), `subject`, `created_at`, and an `attachments` array of
  `{id, filename, content_type, content_disposition, content_id}`. "Webhooks do not include the email body, headers,
  or attachments, only their metadata." [verified]
- **Getting content:** Received-emails API (html, text, headers) and an Attachments API; each attachment has a
  `download_url` **valid for 1 hour** (`expires_at`). The API can also return a signed link to the raw `.eml`
  (`raw.download_url`). The API response has an `authentication` field (null for old mail); its contents (SPF/DKIM/
  DMARC results?) are not described on the page I read. [verified / contents not stated]
- **Attachment / message size limit for receiving: [not stated]** on any page I could reach. The 40 MB figure on
  Resend's pages is for **sending**. Must be confirmed with Resend before launch.
- **MX on a subdomain:** supported and recommended when the root already has MX records. The MX value comes from the
  domain's page in the Resend dashboard and varies by domain (examples shown: `receive.forge.rmta.net`,
  `receive-euw1.forge.rmta.net`, `inbound-smtp.<region>.amazonaws.com`). The Resend MX must have the **lowest priority
  number** among MX records *on that name*. [verified] Exact host/priority: [not stated], read from the dashboard.
- **Signature verification:** Svix scheme. Headers `svix-id`, `svix-timestamp`, `svix-signature` (`v1,...`);
  `resend.webhooks.verify({payload, headers, webhookSecret})` or the `svix` library; must use the **raw body**.
  Replay-tolerance window not stated. [verified]
- **Retries:** immediately, 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 10 h; failing endpoints are auto-disabled with an
  email; manual replay in the dashboard. Expected response code/timeout [not stated]. [verified]
- **Retention of received mail at Resend:** [not stated].
- **Pricing:** inbound is "included, counted toward quota": "Each received email counts towards your transactional
  emails quota." Free $0 = 3,000/mo; Pro $20 = 50,000/mo ($0.90 per extra 1,000 if overages are enabled); Pro $35 =
  100,000; Scale from $90. [verified] **Open question:** the pricing page also says "every plan includes 3 inboxes;
  paid plans can add more at $1 per inbox per month". If a per-user address ever counted as an "inbox" that would be
  $1/user/month. The receiving docs say any address at the domain works, which suggests inboxes are a separate
  product, but this must be confirmed in writing before we commit. [not stated]

### 1.2 Postmark (inbound)

- **Webhook:** one JSON POST per message to one URL per inbound stream. Fields: `MessageID`, `From`/`FromFull`,
  `To`/`ToFull`, `Subject`, `TextBody`, `HtmlBody`, `StrippedTextReply`, `MailboxHash`, `OriginalRecipient`, `Date`,
  `Headers` (includes SpamAssassin `X-Spam-Status`, `X-Spam-Score`), and `Attachments[]` with `Name`,
  `ContentType`, `ContentLength` and **`Content` base64 inline**. [verified]
- **Size:** total inbound attachments may not exceed **35 MB** (page formatting garbled "3\*\*\*\*5 MB"; a second
  Postmark article also says 35 MB). Postmark stores only the first 1 MB of a message in its UI/API. [verified]
- **MX on a subdomain:** `MX`, name = the subdomain label, priority `10`, value `inbound.postmarkapp.com`;
  Postmark "typically recommend[s] ... a separate subdomain"; wildcard supported. [verified]
- **Signature:** none documented. Authentication is HTTP Basic credentials placed in the webhook URL
  (`https://user:pass@host/path`). 403 stops retries. No HMAC. [verified]
- **Retries:** 10 retries at 1, 5, 10, 10, 10, 15, 30, 60, 120, 360 minutes, then "Inbound Error" (re-triggerable
  via API). [verified]
- **Pricing:** inbound email processing is a feature of the **Pro ($16.50/mo, from 10,000 emails, $1.30/1,000
  extra)** and **Platform ($18)** plans; **not** in Basic ($15) or Free (100/mo). Whether inbound counts toward the
  monthly volume is [not stated]. [verified]

### 1.3 Mailgun (Routes)

- **Webhook:** `forward()` POST (form-encoded, or JSON if the URL ends in `json`). Fields include `sender`,
  `from`, `recipient`, `subject`, `body-plain`, `stripped-text`, `stripped-html`, `message-headers`,
  `attachment-count`, `attachment-<n>` (multipart) or an `attachments` array (JSON), plus `timestamp`, `token`,
  `signature`. The page does not list a Message-Id field. [verified]
- **Signature:** HMAC with your signing key over `timestamp + token` (form posts); for JSON, over the whole body
  with `X-Mailgun-Signature` / `X-Mailgun-Timestamp` headers. Key details are on the "Securing Webhooks" page, which
  I did not read. [verified / details not read]
- **Retries:** 200 = done, 406 = rejected, anything else retried for 8 hours (10, 15, 30 min, 1, 2, 4 h). [verified]
- **Size / MX values:** inbound size limit and the MX hosts are [not stated] on the pages I reached.
- **Pricing:** Free $0 (100 emails/day, **1 inbound route**); Basic from $15 (10,000/mo, 5 routes); Foundation $35
  (50,000/mo, "full access to inbound routing"); Scale $90 (100,000/mo). No separate inbound price or cap stated;
  whether inbound counts toward volume [not stated]. [verified]

### 1.4 SendGrid (Inbound Parse)

- **Webhook:** `multipart/form-data` with `headers`, `dkim`, `to`, `from`, `subject`, `text`, `html`,
  `attachments` (count), `attachment-info`, `envelope`, `charsets`, `SPF`, `spam_score`, `spam_report`,
  `sender_ip`, `content-ids`, each attachment as its own part; or "POST the raw, full MIME message". [verified]
- **Size:** keep the total (message plus attachments) to **30 MB**; spam check only runs on messages 2.5 MB or
  smaller. [verified]
- **MX:** a dedicated subdomain (example `parse.`), priority `10`, host `mx.sendgrid.net`; "use a dedicated hostname
  that serves no purpose other than parsing your incoming email"; do not change the record afterward. [verified]
- **Signature:** **none documented for Inbound Parse** (the page covers no signing or basic auth). Protection would
  be an unguessable URL. [verified]
- **Retries, plan availability, current prices:** [not stated]. A 2022 Twilio changelog gave Essentials 50k at
  $19.95/mo; I could not confirm current plans or whether a free tier exists. [unverified]

### 1.5 AWS SES (receiving)

- **Flow:** MX -> SES receipt rule -> actions (S3, SNS, Lambda, others). Typical: store the raw message in S3, notify
  our webhook through SNS or a Lambda. [verified in part]
- **Size:** up to **40 MB** to S3; the **SNS action is capped at 150 KB** (larger messages bounce through that
  action), so use S3. [verified via AWS pages in search results]
- **MX:** `10 inbound-smtp.<region>.amazonaws.com`. Receiving exists only in some regions; us-east-1, us-west-2 and
  eu-west-1 are confirmed. A 2023 announcement says it expanded to 7 more regions including Canada (Central), but I
  could not open the endpoint table, so **ca-central-1 receiving is [unverified]**. Subdomain use is not discussed
  on the MX page (it works the same way: the record is per name).
- **Signature:** SNS messages are signed (verify the SNS signature) or a Lambda we write calls our API with our own
  shared-secret HMAC. We own the webhook design.
- **Pricing:** **$0.10 per 1,000 incoming emails + $0.09 per 1,000 incoming 256 KB chunks** (headers, body and
  attachments all count). No incoming free tier listed (new accounts get AWS credits). [verified]
- **Effort:** highest. IAM, a receipt rule set, an S3 bucket with lifecycle, a Lambda or SNS endpoint, and a second
  cloud account to operate.

### 1.6 Cloudflare Email Routing + Email Worker

- **Flow:** MX at Cloudflare -> routing rule -> an Email Worker (`email()` handler, `message.raw` stream, parse with
  `postal-mime`) that we write, and that would call our API or write to storage. [verified]
- **Size:** inbound **25 MiB**, messages above are rejected. **200 routing rules per domain, 200 destination
  addresses per account, 30 domains per zone.** [verified]
- **Subdomain:** enabled under Email Routing -> Settings -> Subdomains; records are added automatically. **"Catch-all
  rules are only available on the apex domain."** Per-user addresses on a subdomain would need one literal rule per
  address, and rules are capped at 200. [verified] This alone rules it out for `receipts-<token>@in.` at scale.
- **DNS prerequisite:** Email Routing is zone-level. Our DNS is at GoDaddy, so we would have to move the zone (or
  delegate the subdomain) to Cloudflare. [from the repo's DNS lookup + the page's zone-level wording]
- **Signature:** we define it (the Worker signs its own call to our API).
- **Pricing:** Workers Free: 100,000 requests/day, **10 ms CPU per invocation** (MIME parsing of a multi-MB mail may
  exceed that; the docs warn about `EXCEEDED_CPU`). Workers Paid: $5/mo minimum, 10 million requests included, +$0.30
  per extra million. Email Routing's own price was not on the pages I read. [verified]

### 1.7 Comparison

| | Resend | Postmark | Mailgun | SendGrid | SES | Cloudflare |
|---|---|---|---|---|---|---|
| Webhook carries the file? | **No** (metadata + 1-hour URLs) | Yes, base64 inline | Yes, multipart | Yes, multipart | You choose (S3) | You choose |
| Signed webhook? | **Yes (Svix)** | No (basic auth in URL) | **Yes (HMAC)** | **No** documented | SNS signature / own | Own design |
| Idempotency key | `email_id` + `message_id` | `MessageID` | not listed | none listed | SES message id | own |
| Receiving size limit | [not stated] | 35 MB | [not stated] | 30 MB | 40 MB | 25 MiB |
| Subdomain MX | Yes (value from dashboard) | Yes (`inbound.postmarkapp.com`, 10) | [not stated] | Yes (`mx.sendgrid.net`, 10) | Yes (per-name MX) | Yes, **but no catch-all** |
| Catch-all local-parts | **Yes** | Yes (wildcard/inbound hash) | via a catch_all route | Yes | Yes (rule on domain) | **No on subdomain** |
| Already in our stack | **Yes** | No | No | No | No | No |

### 1.8 The Vercel body-limit argument

Postmark, Mailgun and SendGrid **POST the attachment bytes to our route**. Our serverless functions already document
a ~4 MB request-body ceiling (CLAUDE.md, statement import). A phone photo of a receipt is routinely 2 to 5 MB, and
base64 in email inflates it by about a third, so a real share of receipts would fail with 413 before our code runs.
Resend's design (metadata in the webhook, bytes fetched on demand over a 1-hour URL) avoids this by construction. SES
avoids it by writing to S3. Cloudflare avoids it only if the Worker uploads instead of POSTing inline.

### 1.9 Cost at 1,000 and 10,000 received emails per month

Assumes an average email of **1 MB** (a photo or PDF attachment, base64) and, for the heavy case, **4 MB**.
Provider cost only; Gemini is in section 7.

| Provider | 1,000 / month | 10,000 / month | Notes |
|---|---|---|---|
| **Resend** | $0 incremental if inside the current plan (Free = 3,000 sends+receives/mo); otherwise Pro $20 | Pro **$20** (50,000 incl.) | Shares the quota with the invoice emails we already send |
| **Postmark** | **$16.50** (Pro; Basic has no inbound) | **$16.50** if inbound counts inside the 10,000, else +$1.30/1,000 over | A second vendor next to Resend |
| **Mailgun** | $0 (Free: 1 route, 100/day) or $15 (Basic) | $15 (Basic, 10,000) to $35 (Foundation) | Inbound-counts-toward-volume not stated |
| **SendGrid** | [unverified] about $20 (2022 price) | [unverified] about $20 | Prices and free tier not confirmed |
| **SES** | **$0.46** at 1 MB (4 chunks each); $1.54 at 4 MB | **$4.60** at 1 MB; $15.40 at 4 MB | + S3, Lambda: cents |
| **Cloudflare** | $0 to $5 | $5 | Not viable here (no subdomain catch-all) |

### 1.10 Recommendation: Resend

1. **Already ours.** Same vendor, API key and verified domain as our outbound mail; no new sub-processor to disclose
   (Resend is already named in the Privacy Policy).
2. **Fits serverless.** Metadata-only webhook plus fetch-on-demand attachments sidesteps the body-size limit, and the
   work happens inside our own route with our own timeouts.
3. **Right primitives.** Svix-signed webhooks, a documented retry schedule with replay, a provider id and the RFC
   Message-ID in every payload (idempotency), and catch-all on a subdomain.
4. **Cost.** Counted against a quota we already pay for; about $20/month even at 10,000 emails.

Risks to close in a spike **before** any DNS is added (section 8): the receiving size limit, whether per-user
addresses count as billable "inboxes", what the `authentication` field really contains, retention of received mail,
and the lack of documented spam filtering. **Fallback:** SES receiving into S3 (cheapest, and strongest on size)
if Resend's limits or inbox pricing disappoint; Postmark is the mature hosted fallback but only if we accept the
~4 MB inline ceiling or front it.

---

## 2. DNS plan (to be shown, not applied)

The inbound address lives on its own name: **`in.gettaxsnap.ca`**. DNS is at GoDaddy.

Current state (read-only lookup, 21 Oct 2026): apex `gettaxsnap.ca` MX = Google Workspace (`aspmx.l.google.com` 1,
`alt1/alt2.aspmx.l.google.com` 5, `alt3/alt4.aspmx.l.google.com` 10); apex TXT has an SPF record
(`v=spf1 include:dc-aa8e722993._spfm.gettaxsnap.ca ~all`) and a Google site verification. `in.gettaxsnap.ca` has no
MX.

Records to add (Resend):

| Name (host) | Type | Priority | Value | Purpose |
|---|---|---|---|---|
| `in` | MX | 10 | **the receiving MX value shown for `in.gettaxsnap.ca` in the Resend dashboard** (varies per domain; not in the docs) | Deliver mail for `*@in.gettaxsnap.ca` to Resend. Must be the lowest priority number on that name; it will be the only MX there |
| `in` | TXT | n/a | `v=spf1 -all` | Declares that nothing is authorised to *send* as `in.gettaxsnap.ca` (we only receive). Skip it if Resend's verification asks for its own SPF on this domain; confirm in the spike |
| `_dmarc.in` | TXT | n/a | `v=DMARC1; p=reject; adkim=s; aspf=s` | Receivers refuse forged mail claiming to be from `in.gettaxsnap.ca` |
| (any records Resend lists to *verify* the domain, e.g. DKIM TXT at `resend._domainkey.in`) | TXT/CNAME | n/a | as shown in the dashboard | Domain verification. Whether a receive-only domain needs them is [not stated]; take them as shown |

**The main domain is not touched.** No record is created or changed at `gettaxsnap.ca` (apex) or `www`. An MX lookup
for `in.gettaxsnap.ca` is answered only by records at exactly that name; it does not inherit from, or alter, the
apex. The Google Workspace MX set, the apex SPF and DKIM for our outgoing mail all stay as they are. Resend's own
page warns that putting its MX at a root that already has MX causes unpredictable delivery, which is exactly why
this is a subdomain.

Rollout order when you approve: (1) add the domain in Resend, copy the exact values it shows; (2) you add the
records in GoDaddy; (3) wait for Resend to show "verified"; (4) send a test message from a throwaway address;
(5) only then enable the webhook. Rollback = delete the `in` records. Nothing else depends on them.

---

## 3. Addressing and abuse

### 3.1 The address

`receipts-<token>@in.gettaxsnap.ca`, where `<token>` is 26 characters of lowercase base32 (130 bits) from a CSPRNG,
unique per user, stored in `email_in_addresses`. Unknown or disabled tokens are dropped silently (200 to the provider,
no bounce, so we never create backscatter).

### 3.2 Who may send

Evaluation order for every inbound email (cheap checks first; **nothing reaches Gemini until all pass**):

1. Token resolves to a user, address enabled. Otherwise drop and count.
2. Owner is on Pro. Otherwise record `blocked_plan` (no processing, no reply).
3. **Sender allowlist:** the From address (lowercased) is the account's login email, or an address the owner added
   to "Allowed senders" and confirmed by clicking a link we send to it.
4. **Authentication:** SPF/DKIM/DMARC result from the provider says the From domain is authentic (needs the spike to
   learn what Resend's `authentication` field contains). Forged From -> quarantine.
5. Otherwise -> **quarantine** (below).

**Other senders (decision):** recommended = **quarantine list**. Metadata only (sender, subject, time), no
attachment fetched or stored, no automatic reply. The owner sees "Held emails" in Settings and can *Process this
once*, *Always allow this sender*, or *Delete*. Cap of 20 held per user, purged after 14 days. The cheaper
alternative is to drop unknown senders silently; the cost is a confused user whose "forward from my other email"
vanished, so quarantine plus a visible list is recommended.

**Gmail/Outlook auto-forward rules:** an auto-forwarded vendor email keeps the vendor as From, so it will not match.
Two answers: the owner allows that vendor ("Always allow"), or forwards manually. Gmail also sends a confirmation
email (with a code) to a new forwarding address; we can detect it (From `forwarding-noreply@google.com`) and show the
code in Settings. Phase 4.

### 3.3 Limits

| Limit | Value (provisional) |
|---|---|
| Max email size we will process | 20 MB total; per attachment 10 MB (same as the photo route) |
| Attachments processed per email | first 3 inline in the webhook (see 4.5); max 5 allowed overall |
| Allowed types | JPEG, PNG, WebP, HEIC/HEIF if the scan route accepts it, PDF. Decided by **magic bytes**, not the declared MIME type |
| Ignored | inline images under 20 KB (logos, tracking pixels), `content_disposition: inline` signature images, calendar `.ics`, anything else |
| Per user | 30 emails/hour, 200/day |
| Per sender address | 10/hour |
| Global circuit breaker | 2,000 processed emails/hour; above that, new mail is recorded as `rate_limited` and processed later by hand |
| Fair-use for Pro | a monthly cap on email-processed receipts (**decision**; suggested 300) |
| PDFs | max 10 MB and 10 pages |

### 3.4 Receipt-like only

A file is processed only if it passes the type/size checks, **and** Gemini returns a receipt-shaped result (a new
`looks_like_receipt` boolean plus a merchant and a total above zero). Anything else is recorded as `not_a_receipt`
and creates no expense. The model's output stays the existing constrained JSON (category is an enum); email text is
untrusted input, so it can never trigger an action, only fill fields, and field lengths are capped.

### 3.5 Spam and cost abuse

Because only the owner's confirmed addresses (or approved senders) reach the paid path, spam from strangers costs us
a webhook and a metadata row, never a Gemini call. The unguessable token is the first line of defence, the sender
check the second. Provider spam scoring (Postmark and SendGrid expose it; Resend's is [not stated]) is a third line
where available. If an address collects a burst of quarantined mail (say 50 in a day) we show a "Your address may be
leaking, get a new one" warning.

### 3.6 Rotation

Settings -> Email receipts -> **Get a new address**: generates a new token in one transaction, the old token stops
working immediately (mail to it is dropped and counted), and the page shows the new address. The owner's allowed
senders carry over. Disabling the feature keeps the token but sets `enabled = false`.

### 3.7 Other risks

- **Malware:** we never open or execute attachments. They are identified by magic bytes, passed only to the model,
  stored in the private bucket, and served only through signed URLs.
- **Prompt injection** in the body or PDF text is contained by the fixed output schema and by never giving the model
  tools.
- **Webhook forgery:** Svix signature verified on the raw body before anything else; secret in an env var; reject a
  timestamp older than 5 minutes.

---

## 4. Processing

### 4.1 Reuse of the scan pipeline

Split `parse-receipt` into a shared server function, `scanReceiptFile({ userId, bytes, mimeType, fileSha256 })`,
returning the same `ParsedReceipt` (+ `date_ambiguous`). The photo route keeps its user-session cap check and
upload; the email path calls the same function with the service-role client. Same Gemini prompt (date-ambiguity
rules included), same category list (including the owner's custom categories), same duplicate helpers
(`checkExactFile`, the same-purchase matcher).

### 4.2 Plan gating

**Pro only.** Free users do not get email-in (Settings shows the standard `UpgradeCard`; the API refuses, in line
with "every cap is enforced in the API, the UI lock is only the explanation"). The webhook re-checks the plan on every
email, so a downgrade stops processing at once and a re-upgrade resumes with the same address.

### 4.3 Scan cap

Every processed attachment (or body) counts as one scan against the same monthly rule as photo uploads. Pro is
unlimited today (`scansPerMonth: null`), so in practice the binding limit is the **fair-use cap** in 3.3; if a Pro cap
is ever set, email counts toward it with no further change. **Required code change:** the Free-scan count in
`parse-receipt` currently reads `.is("origin", null)`; with `origin = 'email'` rows that would stop counting them.
It must become "origin is null OR origin = 'email'" (equivalently "origin is distinct from 'stripe'"). A test must pin
that email rows count and Stripe-fee rows do not. Failed, rejected, quarantined and `not_a_receipt` outcomes do not
use a scan (but do count toward rate limits).

### 4.4 Idempotency

- `inbound_emails` has a **unique (provider, provider_message_id)** (Resend `email_id`), claimed first, exactly like
  `stripe_events`: a replay of a finished email answers 200 and does nothing; a replay of an unfinished one resumes.
- A second unique key **(user_id, rfc_message_id)** catches the same email delivered under two provider ids.
- Each attachment has a row in `inbound_email_items` with **unique (inbound_email_id, provider_attachment_id)**, and
  each expense links to its item (unique). A retry after a crash re-does only items not yet `done`, so a redelivered
  webhook can never create a duplicate expense or a second Gemini charge for a finished item.
- Exact-file duplicates (SHA-256 against the owner's existing receipts) are skipped and listed as `duplicate`;
  a likely same-purchase match is created but flagged (the existing "warn, never block" rule, adapted: there is no
  person to click "Save anyway").

### 4.5 Timing

Gemini calls take several seconds each (this repo measured 3.6 to 13 s for a 3-page statement; receipts are not timed, so treat 4 to 13 s as the planning range). The webhook therefore processes up to
3 attachments inline under `maxDuration = 60`, records progress per item, and returns 500 if anything is left so that
Resend's retry (immediately, 5 s, 5 min ...) resumes only the unfinished items. Provider retries are the queue; no
new cron is needed. Whether our Vercel plan allows 60 s is the same open point as for the webhook route.

### 4.6 Shapes of email

| Email | Behaviour |
|---|---|
| One image/PDF attachment | Scan it. One expense. |
| Several attachments | Each is scanned separately (first 3 inline, max 5), one expense each. Logos and signature images are ignored by size/disposition. |
| Forwarded email with the receipt as an attached `.eml` | Phase 5: unwrap one level, then treat as above. Until then it is `unsupported_attachment`. |
| **No attachment, text body** | The body text goes to Gemini with the same prompt (a text variant of the parser). Subject and the forwarded-header block (original From, Date) are passed as hints. |
| **HTML-only body** (typical of Uber, Amazon, Shopify receipts) | HTML -> text in our code (drop scripts, styles, hidden elements; keep tables as lines), capped at about 60,000 characters, then as above. |
| Attachments exist but are all unusable | Fall back to the body once; if that is not a receipt either, record `not_a_receipt`. |
| Image-only receipt embedded in the HTML (`cid:`) and no attachment | Treated as an attachment if over 20 KB. |
| Marketing email, newsletter, statement, invoice we issued | `not_a_receipt`, nothing created. |

Every expense created from email is saved as an ordinary expense with `origin = 'email'`, the attachment as its
receipt photo (or no photo for a body-only receipt), and **`needs_review = true`** until the owner opens or accepts
it (shown with an "Added by email, please check" badge; ambiguous dates are flagged as in the photo flow). Whether
unreviewed email expenses count in the HST and profit figures is **decision 6**.

---

## 5. Schema (drafted here only, not a migration file)

Next free migration number is 0072. RLS pattern as elsewhere: the webhook and the API routes write with the service
role; owners can read their own rows.

```sql
-- 0072_email_in_receipts.sql  (DRAFT, NOT APPLIED)
begin;

-- One address per user. Writes (create / rotate / enable) only by the service role, after requireProUser().
create table public.email_in_addresses (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  token      text not null unique check (token ~ '^[a-z2-7]{26}$'),
  enabled    boolean not null default true,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);
alter table public.email_in_addresses enable row level security;
create policy "owner reads own address" on public.email_in_addresses
  for select using (auth.uid() = user_id);

-- Extra senders the owner allows (the account's own login email is implicit).
create table public.email_in_senders (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  email             text not null check (email = lower(email)),
  source            text not null check (source in ('added', 'approved')),
  verify_token_hash text,                       -- sha256 of the emailed confirmation token; null once verified
  verified_at       timestamptz,
  created_at        timestamptz not null default now(),
  unique (user_id, email)
);
alter table public.email_in_senders enable row level security;
create policy "owner reads own senders"  on public.email_in_senders for select using (auth.uid() = user_id);
create policy "owner removes own senders" on public.email_in_senders for delete using (auth.uid() = user_id);

-- One row per inbound email that resolved to a user. Raw bodies are NOT stored.
create table public.inbound_emails (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  provider             text not null default 'resend',
  provider_message_id  text not null,           -- Resend email_id
  rfc_message_id       text,                    -- the Message-ID header
  from_address         text not null,
  subject              text,                    -- truncated to 200 chars
  received_at          timestamptz not null default now(),
  size_bytes           integer,
  auth_result          jsonb,                   -- SPF / DKIM / DMARC outcome as reported by the provider
  status               text not null default 'received' check (status in (
                         'received','processing','done','partial','quarantined','not_a_receipt',
                         'duplicate','blocked_plan','rate_limited','failed')),
  reason               text,                    -- short code, never message text
  purge_after          timestamptz not null default (now() + interval '90 days'),
  unique (provider, provider_message_id)
);
create unique index inbound_emails_rfc_uniq on public.inbound_emails (user_id, rfc_message_id)
  where rfc_message_id is not null;
create index inbound_emails_user_time_idx on public.inbound_emails (user_id, received_at desc);
create index inbound_emails_time_idx      on public.inbound_emails (received_at);   -- global rate limit
alter table public.inbound_emails enable row level security;
create policy "owner reads own inbound emails" on public.inbound_emails
  for select using (auth.uid() = user_id);

-- One row per attachment (or one for the body) that was considered.
create table public.inbound_email_items (
  id                     uuid primary key default gen_random_uuid(),
  inbound_email_id       uuid not null references public.inbound_emails (id) on delete cascade,
  provider_attachment_id text not null,         -- 'body' for the text body
  filename               text,
  content_type           text,
  size_bytes             integer,
  file_sha256            text check (file_sha256 ~ '^[0-9a-f]{64}$'),
  status                 text not null default 'pending'
                           check (status in ('pending','done','skipped','duplicate','not_a_receipt','unsupported','failed')),
  reason                 text,
  receipt_id             uuid references public.receipts (id) on delete set null,
  unique (inbound_email_id, provider_attachment_id)
);
alter table public.inbound_email_items enable row level security;
create policy "owner reads own inbound items" on public.inbound_email_items
  for select using (exists (select 1 from public.inbound_emails e
                            where e.id = inbound_email_items.inbound_email_id and e.user_id = auth.uid()));

-- Receipts: allow origin 'email', link to the item, and a review flag the owner may clear.
alter table public.receipts drop constraint if exists receipts_origin_check;
alter table public.receipts
  add constraint receipts_origin_check check (origin in ('stripe', 'email'));
alter table public.receipts
  add column if not exists inbound_email_item_id uuid unique references public.inbound_email_items (id) on delete set null,
  add column if not exists needs_review boolean not null default false;
alter table public.receipts
  add constraint receipts_email_origin_check
    check (inbound_email_item_id is null or origin = 'email');

-- Extend the 0071 guard so a browser cannot set the new link either (clearing it stays allowed).
-- (create or replace of receipts_stripe_origin_guard() with inbound_email_item_id handled like stripe_payment_id)

commit;
```

Rollback (draft): drop the four tables (items first), drop `inbound_email_item_id` and `needs_review`, restore
`origin in ('stripe')`, restore the 0071 guard body; refuse while `origin = 'email'` rows exist, as 0071's rollback
does for Stripe rows.

Storage: attachments go to the existing private `receipts` bucket under `<user id>/<uuid>.<ext>`, the same as photo
uploads, so deleting the expense removes the file by the existing path. No new bucket.

Retention job: delete `inbound_emails` (items cascade) once `purge_after` has passed; quarantined rows use 14 days.
Needs a cron or a purge on each webhook; today's `vercel.json` has one daily cron, so a second path is a decision.

---

## 6. Privacy Policy and Terms: proposed text for `docs/legal-drafts/lawyer-brief.md`

(Proposed only. For the lawyer to edit; the lawyer brief file itself is not changed by this document.)

> ### Email-in receipts (proposed, for Terms section 2 or a new section, and Privacy sections 1, 3, 4, 5)
>
> **What we process.** If you turn on Email receipts, TaxSnap gives you a private email address. When an email
> arrives at that address from you or from a sender you allow, we process the sender's address, the subject, the
> body, and any attachments (images and PDFs) to read the receipt and create an expense in your account. Receipts
> can contain personal information about you, your customers and your suppliers; forward only business receipts you
> are entitled to share.
>
> **What we do not do.** We do not read any other email you receive. Mail from senders you have not allowed is held
> as a note (sender, subject, time) without opening its attachments, and is deleted after 14 days.
>
> **Who else handles it.** Our email provider (Resend) receives the message and passes it to us, and Google (Gemini)
> reads the receipt content, in the same way it reads a photo you upload. [Lawyer: confirm Resend is described as a
> service provider/sub-processor, where it stores received mail and for how long, and add its retention period once
> Resend states it.] Attachments are stored in our storage provider with your other receipts.
>
> **How long we keep it.** The receipt image or PDF is kept like any other receipt until you delete the expense or
> your account. We do not keep the full original email. We keep a short log of each email (sender, subject, time,
> outcome) for 90 days so you can see what happened to it.
>
> **Accuracy.** Expenses created from email are read by AI and may be wrong. They are marked "added by email" until
> you check them. You remain responsible for your records and tax filings.
>
> **Availability and limits.** Email receipts is a Pro feature, is provided on a best-efforts basis, may reject or
> hold messages (for example if they are too large, not receipts, or sent too often), and we may change or withdraw
> it. Delivery of email is not guaranteed.
>
> **Your address.** Treat your TaxSnap receipt address like a password. You can replace it at any time in Settings; the
> old address stops working immediately.

Lawyer questions to add to the brief: (a) is Resend (as inbound receiver) a service provider under PIPEDA with
cross-border processing, (b) does a forwarded email's third-party personal data change anything beyond open
question 11, (c) retention wording for provider-side copies, (d) whether the sender check ("owner's confirmed
addresses") is enough to treat the sender as having consented.

Also needed in the product: the Terms version must be bumped when this ships, and the Privacy list of providers
already names Resend, so only the "also receives your forwarded mail" part is new.

---

## 7. Cost model

### 7.1 Gemini

Model `gemini-3.6-flash`, paid tier: **input $0.75 per million tokens and output $3.75 per million (including
thinking) through 31 Dec 2026, then $1.50 and $7.50 from 1 Jan 2027**; PDFs are billed at the image token rate.
[verified on ai.google.dev]

Tokens per receipt are **not measured in this repo** (statement imports record tokens; receipts do not). Working
assumption, to be replaced by a measurement: **2,000 input tokens and 600 output tokens** per receipt file
(an image plus the prompt, and a short structured answer with a little thinking). Body-only receipts are similar or
smaller.

| | Per processed email | At 2027 prices |
|---|---|---|
| Gemini | 2,000 x $0.75/M + 600 x $3.75/M = **about $0.0038** | about **$0.0075** |
| Provider (Resend) | about $0 incremental (inside quota) | same |
| Provider (SES alternative) | about $0.0005 to $0.0015 | same |
| **Total, Resend** | **about $0.004** | **about $0.008** |

Doubling the token assumption doubles the Gemini line; it stays under a cent per email either way.

### 7.2 A heavy user

| Heavy user (processed emails/month) | 2026 prices | 2027 prices |
|---|---|---|
| 100 | about $0.38 | about $0.75 |
| **300 (suggested fair-use cap)** | **about $1.13** | **about $2.25** |
| 1,000 | about $3.75 | about $7.50 |

Against $29/month (Pro, before tax) a 300-email month costs roughly 4 to 8 percent of the price in AI cost; Resend
adds nothing until the whole account passes the plan quota. The provider side scales: at 10,000 emails a month across
all users Resend Pro ($20) covers it, Postmark $16.50, SES $4.60 to $15.40.

---

## 8. Build plan and decisions

### 8.1 Phases (riskiest first)

**Phase 0: spike, 1 to 2 days, no production DNS.** Use Resend's own `<id>.resend.app` receiving address (no DNS
change) with a test account to settle every [not stated] item: the receiving size limit, whether per-user addresses
are billable inboxes, the `authentication` field contents, how long Resend keeps received mail, behaviour with
`.eml` attachments, HTML-only mail, and what a 413/timeout looks like. Output: a yes/no on Resend vs SES.

**Phase 1: unattended accuracy and the pipeline (the real risk).** Extract `scanReceiptFile`, add the text-body
parser and `looks_like_receipt`, add `origin = 'email'` + `needs_review`, fix the scan-count query, add token
logging. Run it against 100 real forwarded receipts offline. The risk is wrong totals/dates saved with nobody
watching, so this phase decides the review policy (decision 6).

**Phase 2: webhook, schema, idempotency, abuse controls.** Migration 0072, Svix verification, claim-first row,
per-item resume, sender allowlist, quarantine, rate limits, global breaker. Tests: replay, resume after crash,
delete-then-redeliver, oversize, wrong type, forged signature, unknown token, downgrade mid-flight.

**Phase 3: Settings UI.** Show/copy address, enable/disable, rotate, allowed senders (with confirmation email),
held emails list, recent emails log, "added by email" badge and an inbox of unreviewed items.

**Phase 4: owner-facing polish.** A confirmation email to the owner's verified address ("Added 1 expense: Home
Depot $45.20, review it"), Gmail forwarding-confirmation code capture, per-month usage meter.

**Phase 5: hardening.** `.eml` unwrapping, multi-page PDFs, DNS monitoring, retention job, runbook, optional move
to SES if volume or limits require.

DNS is applied only after Phase 0 passes and you approve section 2, and the webhook is enabled last.

### 8.2 Decisions I need from you

1. **Provider:** Resend (recommended), or SES if the Phase 0 spike finds a size limit or inbox charge we dislike.
2. **Plan gating:** Pro only (recommended), or also a small allowance for Free (say 5 a month, sharing the 5 scans).
3. **Fair-use cap for Pro:** suggested 300 processed emails per month. None, or a different number?
4. **Unknown senders:** quarantine with a visible list (recommended), silent drop, or reject?
5. **Sender proof:** require the provider's SPF/DKIM/DMARC pass in addition to the allowlist (recommended; depends
   on what Resend reports), or the allowlist alone?
6. **Unreviewed expenses and tax:** count `needs_review` expenses in HST, reports and profit straight away
   (recommended, with the badge), or keep them out of every total until the owner accepts them (safer, but a forgotten
   inbox silently understates expenses)?
7. **Duplicates:** skip exact-file duplicates silently and list them (recommended), or create and flag them?
8. **Multiple attachments:** one expense per attachment up to 5 (recommended), or only the first?
9. **Confirmation emails to the owner** in Phase 2 instead of Phase 4?
10. **Retention:** 90 days for the email log, 14 for held mail, no raw email stored. Agree?
11. **DNS host:** keep `in.gettaxsnap.ca` at GoDaddy (recommended, nothing moves), and confirm you are happy for me to
    prepare, but not apply, the records after the spike.
12. **Scope of language:** is the proposed Terms/Privacy text acceptable to send to the lawyer as written?

### 8.3 Sources

- Resend: receiving overview, custom domains, webhook, attachments, retrieve-received-email, verify webhooks,
  retries, pricing: https://resend.com/docs/dashboard/receiving/introduction ,
  https://resend.com/docs/dashboard/receiving/custom-domains ,
  https://resend.com/docs/dashboard/receiving/create-receiving-webhook ,
  https://resend.com/docs/dashboard/receiving/attachments ,
  https://resend.com/docs/api-reference/emails/retrieve-received-email ,
  https://resend.com/docs/webhooks/verify-webhooks-requests ,
  https://resend.com/docs/webhooks/retries-and-replays , https://resend.com/pricing
- Postmark: https://postmarkapp.com/developer/webhooks/inbound-webhook ,
  https://postmarkapp.com/developer/user-guide/inbound/inbound-domain-forwarding ,
  https://postmarkapp.com/support/article/1056-what-are-the-attachment-and-email-size-limits ,
  https://postmarkapp.com/pricing
- Mailgun: https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store/receive-http ,
  https://www.mailgun.com/pricing/
- SendGrid: https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/setting-up-the-inbound-parse-webhook
- AWS SES: https://aws.amazon.com/ses/pricing/ ,
  https://docs.aws.amazon.com/ses/latest/dg/receiving-email-mx-record.html ,
  https://docs.aws.amazon.com/ses/latest/dg/receiving-email-concepts.html
- Cloudflare: https://developers.cloudflare.com/email-routing/email-workers/ ,
  https://developers.cloudflare.com/email-service/platform/limits/ ,
  https://developers.cloudflare.com/email-routing/setup/subdomains/ ,
  https://developers.cloudflare.com/workers/platform/pricing/
- Gemini: https://ai.google.dev/gemini-api/docs/pricing
