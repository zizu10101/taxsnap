-- Adds payment method and tax tracking to commission entries, for
-- reference/reporting only (Commission Reports + Overview) - deliberately
-- NOT wired into sales/documents/payments or src/lib/hst.ts, same tax
-- boundary as price_charged/commission_owed. Folding this into the real
-- HST Return Helper is a separate, deliberately deferred opt-in feature.
alter table public.commission_entries
  add column if not exists payment_method text,
  add column if not exists tax_applied boolean not null default false,
  -- Snapshotted at entry time (price_charged * 13% when tax_applied is
  -- true), not a generated column like commission_owed - the HST rate is a
  -- policy constant in application code (src/lib/hst.ts), not a database
  -- fact, so computing it in Postgres would duplicate that constant in two
  -- places that could drift.
  add column if not exists tax_amount numeric(10, 2);
