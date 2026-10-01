// Explicit column list for every stylist select that a client ever sees
// (API JSON responses, server-page props). Never include pin_hash here -
// it's blocked at the DB level (0042_revoke_pin_hash_exposure.sql: table-level
// REVOKE + per-column GRANT, so a bare .select("*")/.select() fails outright
// rather than leaking the hash). NOTE the column-level REVOKE in
// 0013_stylist_pin.sql alone did NOT do this - it was a no-op against
// Supabase's table-level grants and the hash was readable until 0042.
// Keeping every call site explicit is still the first line of defense.
export const STYLIST_PUBLIC_COLUMNS =
  "id, user_id, name, is_active, pay_type, commission_rate, has_pin, created_at";
