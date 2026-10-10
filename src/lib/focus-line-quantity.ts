// After a saved item is picked, put the cursor in that line's quantity field with its "1" selected, so
// typing replaces it (a saved item never recalls a quantity). The field is found by the data-line-qty
// index the line forms put on it; this runs after React has rendered the new line.
export function focusLineQuantity(index: number): void {
  if (typeof window === "undefined") return;
  window.requestAnimationFrame(() => {
    const el = window.document.querySelector<HTMLInputElement>(`[data-line-qty="${index}"]`);
    if (!el) return;
    el.focus();
    el.select();
  });
}
