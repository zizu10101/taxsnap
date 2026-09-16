-- Replaces the "random-looking" invoice/estimate identifier (previously
-- just the first 8 chars of the row's uuid, displayed as e.g. "#A1B2C3D4")
-- with a real sequential number per user, separate series per document
-- type (INV-1000, INV-1001... / EST-1000, EST-1001...) - starts at 1000
-- rather than 1 so a brand-new account's first invoice doesn't read as
-- "this business just started" to a client.
alter table public.documents add column if not exists document_number integer;

-- Backfill existing rows in creation order, per user+type, starting at
-- 1000 - so a business's pre-existing invoices/estimates get real numbers
-- too instead of staying stuck on the old uuid-fragment display.
with numbered as (
  select
    id,
    row_number() over (partition by user_id, type order by created_at) + 999 as num
  from public.documents
  where document_number is null
)
update public.documents d
set document_number = n.num
from numbered n
where d.id = n.id;

alter table public.documents alter column document_number set not null;

-- Guards against two documents of the same type/user ever landing on the
-- same number - the app computes "max + 1" itself (see
-- src/lib/document-number.ts), so this is a safety net, not the primary
-- mechanism.
create unique index if not exists documents_user_type_number_idx
  on public.documents (user_id, type, document_number);
