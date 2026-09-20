-- Sequential contract number per progress-billed job (CON-00100 style),
-- same "app computes max+1, DB unique index as a race-guard" pattern as
-- documents.document_number (0026_document_number.sql) - not a new
-- mechanism. Starts at 100 (formatted CON-00100) rather than 1 so a
-- brand-new account's first contract doesn't read as "this business
-- just started" to a client, same reasoning document_number already
-- uses starting at 1000.
alter table public.jobs add column if not exists contract_number integer;

create unique index if not exists jobs_user_contract_number_idx
  on public.jobs (user_id, contract_number)
  where contract_number is not null;
