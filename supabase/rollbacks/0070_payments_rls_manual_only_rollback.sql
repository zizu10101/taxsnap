-- Undo 0070: back to the policies from 0008 (select / insert / delete). There was no update policy
-- before 0070, so none is recreated - which means "Edit payment" stops working again, exactly as it
-- did before. The insert and delete policies go back to "any own payment", Stripe rows included.
begin;

drop policy if exists "Users can insert own manual payments" on public.payments;
drop policy if exists "Users can update own manual payments" on public.payments;
drop policy if exists "Users can delete own manual payments" on public.payments;

create policy "Users can insert own payments"
  on public.payments for insert
  with check (
    exists (
      select 1 from public.documents d
      where d.id = payments.document_id and d.user_id = auth.uid()
    )
  );

create policy "Users can delete own payments"
  on public.payments for delete
  using (
    exists (
      select 1 from public.documents d
      where d.id = payments.document_id and d.user_id = auth.uid()
    )
  );

commit;
