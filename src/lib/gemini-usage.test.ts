import { test } from "node:test";
import assert from "node:assert/strict";
import { geminiUsage } from "./gemini-usage.ts";

test("geminiUsage maps the three counts and keeps thoughts only when reported", () => {
  assert.deepEqual(
    geminiUsage({ promptTokenCount: 1200, candidatesTokenCount: 300, thoughtsTokenCount: 80 }),
    { prompt_tokens: 1200, candidates_tokens: 300, thoughts_tokens: 80 },
  );
  assert.deepEqual(geminiUsage({ promptTokenCount: 5, candidatesTokenCount: 2 }), {
    prompt_tokens: 5,
    candidates_tokens: 2,
  });
  assert.deepEqual(geminiUsage(undefined), { prompt_tokens: 0, candidates_tokens: 0 });
});
