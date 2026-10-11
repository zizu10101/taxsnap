// The token counts Gemini reports for one call, in the shape the server logs use. Logging only:
// nothing here is stored or sent to the browser. thoughts_tokens is left out when the model
// reported none, so a model without thinking doesn't log a misleading 0.

export interface GeminiUsage {
  prompt_tokens: number;
  candidates_tokens: number;
  thoughts_tokens?: number;
}

export function geminiUsage(
  usage:
    | { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
    | null
    | undefined,
): GeminiUsage {
  const out: GeminiUsage = {
    prompt_tokens: usage?.promptTokenCount ?? 0,
    candidates_tokens: usage?.candidatesTokenCount ?? 0,
  };
  if (typeof usage?.thoughtsTokenCount === "number") out.thoughts_tokens = usage.thoughtsTokenCount;
  return out;
}
