// "3:12:05" from a whole-second count - the live elapsed clock.
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// Hours to 2 dp, rounded the same way the DB does when it writes the linked
// hour_entries row (round(epoch/3600, 2)), so what an employee/owner sees
// matches what lands in job costing.
export function sessionHours(clockInAt: string, clockOutAt: string): number {
  const seconds = (new Date(clockOutAt).getTime() - new Date(clockInAt).getTime()) / 1000;
  return Math.round((seconds / 3600) * 100) / 100;
}

export function formatSessionHours(clockInAt: string, clockOutAt: string): string {
  return `${sessionHours(clockInAt, clockOutAt).toFixed(2)} h`;
}

// "3h 12m" for an open session's running length on the owner's page.
export function formatElapsedShort(fromIso: string, nowMs: number): string {
  const minutes = Math.max(0, Math.floor((nowMs - new Date(fromIso).getTime()) / 60000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
