export interface ReusableItemInput {
  description: string;
  unit_price: number;
  /** Saved with the item so picking it later fills the quantity too. */
  quantity?: number;
}

export interface SaveReusableItemsResult {
  saved: number;
  /** One human-readable message per item that did NOT save. */
  failures: string[];
}

/**
 * Saves the "Save for next time" line items of a just-saved estimate, invoice
 * or change order to the owner's saved-items list (POST /api/line-items).
 *
 * This used to be fire-and-forget (`fetch(...).catch(() => {})`) inside the
 * save handlers: a 403 plan cap or a 500 resolves rather than rejects, so a
 * failed save was invisible, and the requests ran in parallel so the cap
 * check could race. Now they run one after another and every failure is
 * reported back so the caller can tell the owner.
 *
 * `fetchImpl` is injectable so the behaviour is testable without a server.
 */
export async function saveReusableItems(
  items: ReusableItemInput[],
  fetchImpl: typeof fetch = fetch,
): Promise<SaveReusableItemsResult> {
  const result: SaveReusableItemsResult = { saved: 0, failures: [] };
  for (const item of items) {
    try {
      const res = await fetchImpl("/api/line-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: item.description,
          unit_price: item.unit_price,
          // Omitted when it isn't a usable number; the server then keeps the default of 1.
          ...(Number(item.quantity) > 0 ? { quantity: Number(item.quantity) } : {}),
        }),
      });
      if (res.ok) {
        result.saved += 1;
        continue;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      result.failures.push(`"${item.description}": ${body.error ?? `HTTP ${res.status}`}`);
    } catch {
      result.failures.push(`"${item.description}": network error`);
    }
  }
  return result;
}

/** Toast text for a partial/total failure, or null when everything saved. */
export function savedItemsFailureMessage(result: SaveReusableItemsResult): string | null {
  if (result.failures.length === 0) return null;
  const head =
    result.saved > 0
      ? `Saved ${result.saved}, but ${result.failures.length} saved item${result.failures.length === 1 ? "" : "s"} couldn't be saved`
      : `Your document was saved, but ${result.failures.length === 1 ? "the saved item" : "the saved items"} couldn't be saved`;
  return `${head}. ${result.failures.join("; ")}`;
}
