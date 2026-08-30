// Explicit column list for every app_settings select that a client ever
// sees (API JSON responses, server-page props). Never include
// owner_pin_hash/staff_pin_hash here - they're also blocked at the DB level
// via a column-level REVOKE (0017_app_lock.sql), so a bare .select("*")
// fails outright rather than leaking either hash, but keeping every call
// site explicit avoids relying on that as the only line of defense.
export const APP_SETTINGS_PUBLIC_COLUMNS = "user_id, has_owner_pin, has_staff_pin, created_at";
