-- Owners may add, change or remove only their own MANUAL payments.
-- Rollback: supabase/rollbacks/0070_payments_rls_manual_only_rollback.sql
--
-- Run in the Supabase SQL Editor (after 0069). Safe to run before or after the code ships.
--
-- Before: payments had select / insert / delete policies (0008) and NO update policy at all, so
-- "Edit payment" in the app could not work; the delete policy let a signed-in browser delete any of
-- its own rows, including card payments, refunds and lost disputes written by the Stripe webhook; and
-- the insert policy let it create rows with source = 'stripe' / 'stripe_refund' / 'stripe_dispute'.
--
-- After:
--   select   unchanged (the owner still sees every payment on their invoices)
--   insert   own invoice AND source = 'manual'. The app's two insert paths (POST /api/documents/[id]/payments
--            and the job payment allocator) never send `source`, so the column default 'manual' applies
--            and the check passes; a request that names another source is refused.
--   update   own invoice AND source = 'manual', and the row must still be manual and on one of the
--            owner's invoices afterwards (so a manual row can't be relabelled 'stripe' or moved)
--   delete   own invoice AND source = 'manual'
-- Rows with any other source (stripe, stripe_refund, stripe_dispute) can only be created, changed or
-- removed by the service role, which bypasses RLS: the webhook, which is how they are written anyway.
--
-- The DO block first removes EVERY existing insert / update / delete / "all" policy on payments, whatever
-- it is called (one could have been added by hand in the dashboard), because permissive policies are
-- OR-ed: a leftover broad one would silently defeat the new rule. The select policy is not touched
-- (and no "all" policy is recreated, so select keeps its own).

begin;

do $$
declare
  p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'payments' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  loop
    execute format('drop policy %I on public.payments', p.policyname);
  end loop;
end $$;

create policy "Users can insert own manual payments"
  on public.payments for insert
  with check (
    source = 'manual'
    and exists (
      select 1 from public.documents d
      where d.id = payments.document_id and d.user_id = auth.uid()
    )
  );

create policy "Users can update own manual payments"
  on public.payments for update
  using (
    source = 'manual'
    and exists (
      select 1 from public.documents d
      where d.id = payments.document_id and d.user_id = auth.uid()
    )
  )
  with check (
    source = 'manual'
    and exists (
      select 1 from public.documents d
      where d.id = payments.document_id and d.user_id = auth.uid()
    )
  );

create policy "Users can delete own manual payments"
  on public.payments for delete
  using (
    source = 'manual'
    and exists (
      select 1 from public.documents d
      where d.id = payments.document_id and d.user_id = auth.uid()
    )
  );

commit;
