import assert from "node:assert/strict";
import test from "node:test";
import { isStatementImportEnabled, parseStatementAllowlist } from "./statement-config.ts";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

test("the feature is off when the allowlist is unset or empty", () => {
  assert.equal(isStatementImportEnabled(A, undefined), false);
  assert.equal(isStatementImportEnabled(A, ""), false);
  assert.equal(isStatementImportEnabled(A, " , "), false);
});

test("only listed user ids are enabled, case- and space-insensitively", () => {
  const raw = ` ${A.toUpperCase()} , ${B}`;
  assert.equal(isStatementImportEnabled(A, raw), true);
  assert.equal(isStatementImportEnabled(B, raw), true);
  assert.equal(isStatementImportEnabled("33333333-3333-3333-3333-333333333333", raw), false);
});

test("there is no wildcard", () => {
  assert.equal(isStatementImportEnabled(A, "*"), false);
  assert.equal(parseStatementAllowlist("*").has("*"), true); // just a literal id that never matches a uuid
});

test("a missing user is never enabled", () => {
  assert.equal(isStatementImportEnabled(null, A), false);
  assert.equal(isStatementImportEnabled(undefined, A), false);
});
