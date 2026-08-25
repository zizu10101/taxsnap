-- Lets a user exclude an individual paid invoice from the HST Return
-- Helper's Line 101/103 totals (e.g. a paid invoice that was actually a
-- reimbursement, not real revenue) without editing the invoice's own
-- dollar amounts, which stay the source of truth for the invoice itself.
alter table documents
  add column excluded_from_hst boolean not null default false;
