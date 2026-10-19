-- Retires the Basic ("Plus") plan: Free and Pro are the only plans now.
-- Rollback: none needed - the rows below held no paying subscribers, and the old
-- tier can't be told apart from Free once changed.
--
-- Run in the Supabase SQL Editor BEFORE the code that removes Basic ships.
--
--   * Any profile still on 'basic' becomes 'free' (no paid Basic subscribers exist, so there
--     is nothing to grandfather and no Stripe subscription to cancel).
--   * A scheduled downgrade TO 'basic' is dropped with its two companion columns.
--
-- Deliberately NOT done: the CHECK constraints on profiles.subscription_status and
-- profiles.pending_tier still allow 'basic' (harmless - the app treats anything but 'pro' as
-- Free, see normalizeTier in plan-limits.ts). Tightening them can wait for a quiet moment.

begin;

update public.profiles
   set pending_tier = null,
       pending_billing_interval = null,
       pending_change_effective_at = null
 where pending_tier = 'basic';

update public.profiles
   set subscription_status = 'free'
 where subscription_status = 'basic';

commit;
