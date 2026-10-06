import assert from "node:assert/strict";
import test from "node:test";
import { mapStatementDbError } from "./statement-errors.ts";

test("known function errors map to a status and a stable code", () => {
  assert.deepEqual(
    [mapStatementDbError({ message: "STATEMENT_CAP_REACHED" }).status, mapStatementDbError({ message: "STATEMENT_CAP_REACHED" }).code],
    [403, "STATEMENT_CAP_REACHED"],
  );
  assert.equal(mapStatementDbError({ message: "DUPLICATE_LINES" }).status, 409);
  assert.equal(mapStatementDbError({ message: "ACCOUNT_NOT_CARD" }).status, 400);
});

test("a code embedded in a longer message is still recognised", () => {
  assert.equal(mapStatementDbError({ message: "ERROR: UNCONFIRMED_CATEGORIES" }).code, "UNCONFIRMED_CATEGORIES");
});

test("unique and check violations get their own friendly mapping", () => {
  assert.equal(mapStatementDbError({ message: "duplicate key value violates ...", code: "23505" }).code, "CLAIM_CONFLICT");
  assert.equal(mapStatementDbError({ message: "violates check constraint", code: "23514" }).status, 400);
});

test("anything unknown is a generic 500 that leaks no database text", () => {
  const e = mapStatementDbError({ message: 'relation "statement_lines" does not exist', code: "42P01" });
  assert.equal(e.status, 500);
  assert.ok(!e.message.includes("statement_lines"));
});

test("a missing error is still handled", () => {
  assert.equal(mapStatementDbError(null).status, 500);
});
