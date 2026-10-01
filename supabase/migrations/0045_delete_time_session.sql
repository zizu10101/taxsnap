-- Owner can delete a clocked session (open or completed), e.g. an employee
-- clocked in by mistake. The linked hour_entries row is deleted with it in the
-- same transaction: an entry whose session is gone would be an orphan (its
-- hours/date are derived from the session), and hour_entries.time_session_id is
-- ON DELETE SET NULL, which would silently turn it into a manual entry instead.
--
-- Goes through a function because authenticated has no DELETE privilege on
-- time_sessions (0043) - writes are only via validated security-definer
-- functions, scoped to auth.uid() here.
create or replace function public.owner_delete_time_session(p_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id
  from public.time_sessions
  where id = p_id and user_id = auth.uid()
  for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  delete from public.hour_entries where time_session_id = v_id;
  delete from public.time_sessions where id = v_id;
end;
$$;

revoke execute on function public.owner_delete_time_session(uuid) from public, anon;
grant execute on function public.owner_delete_time_session(uuid) to authenticated;
