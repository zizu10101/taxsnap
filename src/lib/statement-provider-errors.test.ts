import assert from "node:assert/strict";
import test from "node:test";
import { describeProviderFailure } from "./statement-provider-errors.ts";

test("a 400 that isn't about the key means the file itself was refused", () => {
  const f = describeProviderFailure({
    status: 400,
    message: '{"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}',
  });
  assert.equal(f.code, "UNREADABLE_FILE");
  assert.equal(f.httpStatus, 422);
});

test("a 400 about the API key is our problem, not the file's", () => {
  const f = describeProviderFailure({ status: 400, message: "API key not valid. Please pass a valid API key." });
  assert.equal(f.code, "PROVIDER_ERROR");
  assert.equal(f.httpStatus, 502);
});

test("busy, rate limited and timed out each keep their own retryable code", () => {
  assert.equal(describeProviderFailure({ status: 503 }).code, "PROVIDER_BUSY");
  assert.equal(describeProviderFailure({ status: 429 }).code, "PROVIDER_RATE_LIMIT");
  assert.equal(describeProviderFailure({ name: "TimeoutError" }).code, "PROVIDER_TIMEOUT");
  assert.equal(describeProviderFailure({ name: "AbortError" }).httpStatus, 504);
});

test("anything else, including a non-error, is a generic provider error", () => {
  assert.equal(describeProviderFailure({ status: 500 }).code, "PROVIDER_ERROR");
  assert.equal(describeProviderFailure(null).code, "PROVIDER_ERROR");
  assert.equal(describeProviderFailure("boom").code, "PROVIDER_ERROR");
});

test("no user-facing message leaks upstream text", () => {
  const f = describeProviderFailure({ status: 400, message: "secret internal detail" });
  assert.ok(!f.message.includes("secret"));
});
