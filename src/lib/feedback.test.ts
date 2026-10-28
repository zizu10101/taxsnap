import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_PAGE_PATH_MAX,
  FEEDBACK_TRYING_TO_DO_MAX,
  validateFeedback,
} from "./feedback.ts";
import {
  FEEDBACK_LIMIT,
  FEEDBACK_WINDOW_MS,
  allowFeedback,
  refundFeedback,
  resetFeedbackLimits,
} from "./feedback-rate-limit.ts";

function ok(body: unknown) {
  const r = validateFeedback(body);
  assert.ok(r.ok, "expected valid");
  return r.value;
}

test("message is trimmed and required", () => {
  assert.equal(ok({ message: "  hello  " }).message, "hello");
  for (const message of ["", "   \n ", undefined, 5]) {
    assert.equal(validateFeedback({ message }).ok, false);
  }
  assert.equal(validateFeedback(null).ok, false);
});

test("message limit is inclusive, counted after trimming", () => {
  assert.ok(validateFeedback({ message: "a".repeat(FEEDBACK_MESSAGE_MAX) }).ok);
  assert.ok(validateFeedback({ message: ` ${"a".repeat(FEEDBACK_MESSAGE_MAX)} ` }).ok);
  assert.equal(validateFeedback({ message: "a".repeat(FEEDBACK_MESSAGE_MAX + 1) }).ok, false);
});

test("trying-to-do is optional, trimmed, and limited", () => {
  assert.equal(ok({ message: "x" }).tryingToDo, null);
  assert.equal(ok({ message: "x", tryingToDo: "   " }).tryingToDo, null);
  assert.equal(ok({ message: "x", tryingToDo: " send an invoice " }).tryingToDo, "send an invoice");
  assert.ok(validateFeedback({ message: "x", tryingToDo: "a".repeat(FEEDBACK_TRYING_TO_DO_MAX) }).ok);
  assert.equal(
    validateFeedback({ message: "x", tryingToDo: "a".repeat(FEEDBACK_TRYING_TO_DO_MAX + 1) }).ok,
    false,
  );
});

test("a good page path is kept; a bad one is dropped, not an error", () => {
  assert.equal(ok({ message: "x", pagePath: "/dashboard/help" }).pagePath, "/dashboard/help");
  const longest = "/" + "a".repeat(FEEDBACK_PAGE_PATH_MAX - 1);
  assert.equal(ok({ message: "x", pagePath: longest }).pagePath, longest);
  for (const pagePath of [
    "dashboard",
    "https://evil.example/",
    "",
    "/" + "a".repeat(FEEDBACK_PAGE_PATH_MAX),
    "/a\nUser id: someone-else",
    42,
    undefined,
  ]) {
    assert.equal(ok({ message: "x", pagePath }).pagePath, null);
  }
});

test("rate limit: 5 per hour per user, frees up after the window", () => {
  resetFeedbackLimits();
  const t = 1_000_000;
  for (let i = 0; i < FEEDBACK_LIMIT; i++) assert.ok(allowFeedback("u1", t + i));
  assert.equal(allowFeedback("u1", t + 10), false);
  assert.ok(allowFeedback("u2", t + 10), "another user is unaffected");
  assert.ok(allowFeedback("u1", t + FEEDBACK_WINDOW_MS + 1));
});

test("a refunded attempt gives its slot back", () => {
  resetFeedbackLimits();
  for (let i = 0; i < FEEDBACK_LIMIT; i++) allowFeedback("u3", 5);
  refundFeedback("u3");
  assert.ok(allowFeedback("u3", 6));
});
