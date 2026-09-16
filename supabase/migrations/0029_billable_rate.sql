-- Billable rate tracking, distinct from pay rate: what the contractor
-- charges the client per hour, vs. default_hourly_rate/rate which is what
-- the employee is paid. Same snapshot-at-entry, editable-per-entry
-- convention hour_entries.rate already uses (see 0010_employees_and_
-- hours.sql) - billable_rate auto-fills from the employee's default at
-- entry time but is directly editable per entry, so that *is* the
-- "job-specific override" - no separate override flag needed.
--
-- Deliberately NOT wired into the job's Est. Profit revenue figure or
-- any tax table - labor_revenue is a reference stat only ("what this
-- labor is worth if billed"). Once labor actually gets invoiced (a real
-- document_items line) and paid, that payment already flows into the
-- job's real revenue via calculateJobRevenue()/payments - adding
-- labor_revenue into the same total would double-count it.
alter table public.employees add column if not exists default_billable_rate numeric(10, 2) not null default 0;

alter table public.hour_entries add column if not exists billable_rate numeric(10, 2) not null default 0;
alter table public.hour_entries add column if not exists labor_revenue numeric(12, 2)
  generated always as (round(hours * billable_rate, 2)) stored;
