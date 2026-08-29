// Explicit column list for every stylist select that a client ever sees
// (API JSON responses, server-page props). Never include pin_hash here -
// it's also blocked at the DB level via a column-level REVOKE
// (0013_stylist_pin.sql), so a bare .select("*")/.select() now fails
// outright rather than leaking the hash, but keeping every call site
// explicit avoids relying on that as the only line of defense.
export const STYLIST_PUBLIC_COLUMNS =
  "id, user_id, name, is_active, pay_type, commission_rate, has_pin, created_at";
