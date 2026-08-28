// Fixed palette a new service's color is auto-assigned from (round-robin by
// existing count), editable afterward. Chosen to read clearly against the
// warm "work order paper" background (see globals.css) without clashing
// with --primary (orange) or --success (green), which are reserved
// meanings elsewhere in the app.
export const SERVICE_COLOR_PALETTE = [
  "#c2410c", // orange
  "#b45309", // amber
  "#854d0e", // gold
  "#4d7c0f", // olive green
  "#0f766e", // teal
  "#0369a1", // blue
  "#6d28d9", // violet
  "#a21caf", // magenta
  "#be123c", // rose
  "#57534e", // warm gray
];

export function nextServiceColor(existingCount: number): string {
  return SERVICE_COLOR_PALETTE[existingCount % SERVICE_COLOR_PALETTE.length];
}
