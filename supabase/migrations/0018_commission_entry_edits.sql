-- Lets staff correct a same-day mislabel (wrong service tapped) on an
-- unpaid commission entry without losing the record of what was first
-- entered. Separate from the existing soft-delete (is_deleted/deleted_at,
-- 0012_payouts.sql) - delete removes an entry entirely, edit corrects it
-- in place while keeping a visible before/after trail.
--
-- original_service_id/original_service_name/original_price/original_stylist_id
-- are set ONLY on the first edit (guarded in the API route by
-- `edited_at is null`, not here - there's no server-side trigger enforcing
-- this, same trust level as the rest of this table's app-computed
-- columns). A second edit must never overwrite them with the state right
-- before that second edit, or the trail would show a confusing multi-hop
-- chain instead of a single "what was first entered" vs. "what it is now"
-- comparison. original_stylist_id gets the same treatment as the service
-- fields - a wrong-stylist correction silently moves commission between
-- two people, which is at least as consequential to leave untracked as a
-- wrong service.
--
-- original_stylist_name is required alongside original_stylist_id for the
-- same reason original_service_name exists alongside original_service_id:
-- commission_entries has never denormalized a stylist name the way it
-- already denormalizes service_name (stylists.name is only ever reached
-- via a join), and unlike services, a stylist is never hard-deleted
-- (deactivate-not-delete, see stylists.is_active) - but the name itself
-- IS freely editable after the fact. Without a snapshot, the trail would
-- silently re-resolve through original_stylist_id to whatever that
-- stylist is named *today*, not who they were at edit time - the exact
-- staleness problem the service snapshot was already built to avoid.
--
-- Two FKs to `services` (service_id, original_service_id) and two to
-- `stylists` (stylist_id, original_stylist_id) means every embedded
-- `service:services(...)`/`stylist:stylists(...)` select in application
-- code becomes ambiguous to PostgREST as of this migration - it can no
-- longer infer which FK to embed through. Every such select must add an
-- explicit hint (`service:services!commission_entries_service_id_fkey(...)`,
-- `stylist:stylists!commission_entries_stylist_id_fkey(...)`) - see the
-- PATCH/GET/POST commission-entries routes and the Reports page query.
alter table public.commission_entries
  add column if not exists edited_at timestamptz,
  add column if not exists original_service_id uuid references public.services (id) on delete set null,
  -- Snapshot, same denormalization reasoning as service_name/price_charged
  -- above - if the service is later renamed/deleted, the trail must still
  -- show what the entry originally said.
  add column if not exists original_service_name text,
  add column if not exists original_price numeric(10, 2),
  add column if not exists original_stylist_id uuid references public.stylists (id) on delete set null,
  add column if not exists original_stylist_name text;
