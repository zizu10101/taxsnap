-- E-signature for estimates: a public, unauthenticated /sign/[token] page
-- lets a client type their name, check "I agree," and submit - which
-- records the signature, converts the estimate to an invoice (reusing the
-- existing convert logic), and emails the client a link to a public,
-- read-only /invoice/[token] view of the new invoice.
--
-- Columns live directly on `documents` (not a separate table) - same
-- precedent as converted_from_id/excluded_from_hst/the progress-billing
-- columns: doc-type-specific fields on the one unified table, per
-- CLAUDE.md's "don't add a new Invoice-shaped table" convention.
--
-- sign_token/view_token are opaque, unguessable tokens (generated in app
-- code with crypto.randomBytes, not exposed here) - NOT the sequential
-- document_number, same security reasoning as any other sensitive
-- shareable link in this app. A plain `unique` constraint is enough (no
-- partial index needed): Postgres does not treat multiple NULLs as
-- conflicting under a UNIQUE constraint, so every row that never gets a
-- token (the overwhelming majority) coexists fine.
alter table public.documents
  add column if not exists sign_token text unique,
  add column if not exists signed_at timestamptz,
  add column if not exists signer_name text,
  add column if not exists signer_ip text,
  add column if not exists view_token text unique,
  add column if not exists invoice_email_sent_at timestamptz,
  -- Set true only when a client's signature forced the estimate->invoice
  -- conversion through past the owner's monthly invoice cap (see
  -- wouldExceedMonthlyLimit) - a client's agreement is never blocked by
  -- the contractor's plan tier, but this flag lets the owner's dashboard
  -- surface an upgrade nudge on that specific invoice afterward.
  add column if not exists created_past_plan_limit boolean not null default false;

-- Hot path for both public routes' own lookup (GET /sign/[token],
-- POST /api/sign/[token], GET /invoice/[token]) - a plain unique
-- constraint already creates a backing index, so no separate index
-- statement is needed here, but called out explicitly since these are the
-- only two columns ever looked up by an anonymous, unauthenticated request
-- anywhere in this schema.
