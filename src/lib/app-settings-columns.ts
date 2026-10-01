// Explicit column list for every app_settings select that a client ever
// sees (API JSON responses, server-page props). Never include
// owner_pin_hash/staff_pin_hash here - they're blocked at the DB level
// (0042_revoke_pin_hash_exposure.sql: table-level REVOKE + per-column GRANT,
// so a bare .select("*") fails outright). The column-level REVOKE in
// 0017_app_lock.sql alone was a no-op and the hashes were readable until 0042.
// Keeping every call site explicit is still the first line of defense.
export const APP_SETTINGS_PUBLIC_COLUMNS = "user_id, has_owner_pin, has_staff_pin, created_at";
