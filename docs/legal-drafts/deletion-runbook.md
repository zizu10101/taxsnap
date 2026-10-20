# DRAFT - Account deletion runbook (one user)

For a deletion request received by email. Promise made in the Privacy Policy: delete within 30 days of the request,
except billing records we must keep by law. There is no self-service deletion in the app, and no code that deletes an auth
user, so this is manual. Nothing here has been run; check each step against the live project before using it.
Local dev and production share one Supabase project, so work with the real user id and double-check it.

## 0. Before you start
- [ ] Confirm the requester controls the account (reply from the account email, or a sign-in-link check). Write down the date received (30-day clock).
- [ ] Remind them to export first (CSV, PDF, accountant export); deletion cannot be undone. Wait for their answer if they ask.
- [ ] Note the user id, email, `profiles.stripe_customer_id`, `profiles.stripe_subscription_id`, `profiles.stripe_connect_account_id`:
  `select id, email, stripe_customer_id, stripe_subscription_id, stripe_connect_account_id from profiles where email = '...';`
- [ ] Decide what billing records must stay (Stripe keeps its own invoices/charges; see step 4). Note the retention reason in your log.

## 1. Stop money first
- [ ] **Subscription:** cancel in the Stripe Dashboard (live account "Edge Digital Business Solutions") for `stripe_subscription_id`, or via Admin > account > Cancel. Decide on any refund (see the refund policy question in the lawyer brief).
- [ ] **Connected account (Online payments):** if `stripe_connect_account_id` is set, that is the contractor's OWN Stripe account (their Dashboard, their money). TaxSnap cannot delete it. Tell them to close or disconnect it in Stripe if they wish. Check for open disputes or unrefunded payments first (`documents.payment_disputed`, `stripe_disputes`).

## 2. Storage files (SQL does not delete these)
Buckets, all private, objects are stored under a `<user id>/` folder:
- [ ] `receipts` (receipt photos)
- [ ] `logos` (business logo)
- [ ] `job-photos` (site photos and `_thumb` copies)

Remove every object under `<user id>/` in each bucket (Supabase Dashboard > Storage, or the Storage API with the service role). Do this BEFORE step 3 so the rows that name the files still exist if you need to look something up. Re-list each folder afterwards and confirm it is empty.

## 3. Database rows and the auth user
All of these tables reference `auth.users (id) on delete cascade` (or hang off a table that does), so deleting the auth user in step 3b removes them. Use the list to verify afterwards, and to spot-check before deleting.

- [ ] 3a. Spot-check counts for the user (service role): `profiles`, `receipts`, `documents` (+ `document_items`, `payments`), `clients`, `jobs`, `job_photos`, `employees` (+ `hour_entries`, `time_sessions`, `employee_pins`, `employee_sessions`), `line_items`, `expense_templates`, `expense_categories`, `bank_accounts`, `sales`, `app_settings`, `accountant_logins`/`accountant_sessions`, `client_portal_logins`/`client_sessions`, `contract_changes`/`contract_change_items`, `adjustments`, `stripe_disputes`, `stripe_overpayments`, and, for salon accounts, `services`, `stylists`, `commission_entries`, `payouts`, `products`, `register_transactions`, `renters`, `rent_payments`, `vendor_rules` (list is from `supabase/migrations/*.sql`; re-check `grep "references auth.users" supabase/migrations/*.sql` for tables added since).
- [ ] 3b. **Delete the auth user** (Supabase Dashboard > Authentication > Users > Delete, or `auth.admin.deleteUser(id)` with the service role). This cascades to `profiles` and everything above.
- [ ] 3c. Confirm nothing is left: `select count(*) from <table> where user_id = '<id>'` for each table above returns 0 (`document_items`, `payments` have no user_id; check by `document_id` before the documents are gone, or confirm the counts dropped).
- [ ] 3d. Tables that do NOT cascade and may still mention the person:
  - `admin_actions`: `account_id` has no foreign key on purpose; `account_email` and free-text notes are kept. Delete or redact the rows for this account unless you decide to keep them as an audit log (note the decision).
  - `stripe_events` (webhook idempotency): holds Stripe event ids and types only, no personal data. Optional to leave.
  - `checkout_attempts`, `*_login_failures`: hashed IPs/tokens, expire in time; optional to leave.
  - Estimate signatures (`documents.signer_name`, `signer_ip`) disappear with the documents.

## 4. Stripe (platform account)
- [ ] The Stripe **customer** for `stripe_customer_id`: Stripe keeps payment and invoice records we are required to keep for tax purposes. Delete the customer only if you are sure no records must stay; otherwise leave it, cancelled, and note why. Do not delete a customer that has an open subscription.
- [ ] Nothing about the contractor's clients lives in the platform account; their payments are on the contractor's connected account (step 1).

## 5. Resend (email)
- [ ] TaxSnap stores nothing in Resend as an account list (there is no audience). Resend keeps delivery logs of emails sent (recipient, subject, content) for its own retention period. If the request covers those, delete or ask Resend to purge the logs for the user's email and for the clients' emails you sent on their behalf. Note that sent emails already left our control.

## 6. Other places to check
- [ ] **Google (Gemini):** no stored copy on our side; receipt images were sent for reading. Nothing to delete from our side. See the lawyer brief for the Google tier question.
- [ ] **Vercel:** server logs only; they age out on Vercel's schedule. Nothing to delete.
- [ ] **Backups:** Supabase backups may keep the data until they roll off. Say so in the reply.
- [ ] **Your inbox:** the request email and your correspondence. Keep a minimal record that the request was received and completed (date, no personal content).
- [ ] **Other people's access:** employee, client and accountant sign-ins are deleted with the account (their sessions cascade).

## 7. Finish
- [ ] Reply to the requester with the date done, what was deleted, and what stays (billing records required by law, backups until they expire).
- [ ] Log: date received, date completed, who did it, exceptions kept and why.
