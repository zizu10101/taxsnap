import assert from "node:assert/strict";
import test from "node:test";
import { planChunks, validateChunkPlan } from "./statement-chunks.ts";

test("planChunks splits into runs of 3 with a short last chunk", () => {
  assert.deepEqual(planChunks(7), [
    { page_from: 1, page_to: 3 },
    { page_from: 4, page_to: 6 },
    { page_from: 7, page_to: 7 },
  ]);
});

test("planChunks handles a single page and one-page chunks", () => {
  assert.deepEqual(planChunks(1), [{ page_from: 1, page_to: 1 }]);
  assert.equal(planChunks(4, 1).length, 4);
});

test("planChunks refuses nonsense page counts", () => {
  assert.deepEqual(planChunks(0), []);
  assert.deepEqual(planChunks(2.5), []);
});

test("validateChunkPlan accepts a plan from planChunks", () => {
  assert.equal(validateChunkPlan(7, planChunks(7)), null);
});

test("validateChunkPlan rejects gaps, overlaps and short coverage", () => {
  assert.ok(validateChunkPlan(4, [{ page_from: 1, page_to: 2 }, { page_from: 4, page_to: 4 }]));
  assert.ok(validateChunkPlan(4, [{ page_from: 1, page_to: 3 }, { page_from: 3, page_to: 4 }]));
  assert.ok(validateChunkPlan(4, [{ page_from: 1, page_to: 3 }]));
  assert.ok(validateChunkPlan(4, [{ page_from: 2, page_to: 4 }]));
});

test("validateChunkPlan enforces the page cap and shape", () => {
  assert.ok(validateChunkPlan(31, planChunks(31)));
  assert.ok(validateChunkPlan(3, "nope"));
  assert.ok(validateChunkPlan(3, []));
  assert.ok(validateChunkPlan("3", planChunks(3)));
});
