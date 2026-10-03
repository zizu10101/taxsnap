import { test } from "node:test";
import assert from "node:assert/strict";
import { createScopedReader, SCOPED_TABLES } from "./scoped-reader.ts";

// A recording stand-in for the Supabase client: from(t).select(...) returns an
// object whose eq() records the filter, so we can see exactly what was asked.
function fakeClient() {
  const calls: { table: string; select: unknown[]; filters: [string, string][] }[] = [];
  const client = {
    from(table: string) {
      return {
        select: (...select: unknown[]) => {
          const call = { table, select, filters: [] as [string, string][] };
          calls.push(call);
          const builder = {
            eq(col: string, value: string) {
              call.filters.push([col, value]);
              return builder;
            },
          };
          return builder;
        },
        insert: () => assert.fail("a write reached the client"),
        update: () => assert.fail("a write reached the client"),
        delete: () => assert.fail("a write reached the client"),
      };
    },
  };
  return { client, calls };
}

test("every read is filtered to the session's business", () => {
  const { client, calls } = fakeClient();
  const reader = createScopedReader(client as never, "user-1");
  for (const table of SCOPED_TABLES) {
    reader.from(table).select("id, name");
  }
  assert.equal(calls.length, SCOPED_TABLES.length);
  for (const call of calls) {
    assert.deepEqual(call.filters, [["user_id", "user-1"]], call.table);
    assert.deepEqual(call.select, ["id, name"]);
  }
});

test("select arguments (columns, count options) pass through untouched", () => {
  const { client, calls } = fakeClient();
  createScopedReader(client as never, "u").from("receipts").select("*", { count: "exact", head: true });
  assert.deepEqual(calls[0].select, ["*", { count: "exact", head: true }]);
});

test("tables outside the accountant scope can't be opened", () => {
  const { client, calls } = fakeClient();
  const reader = createScopedReader(client as never, "user-1");
  for (const table of [
    "clients",
    "profiles",
    "employee_pins",
    "employee_sessions",
    "client_portal_logins",
    "accountant_logins",
    "accountant_sessions",
    "contract_changes",
    "time_sessions",
    "stylists",
    "services",
    "commission_entries",
    "payouts",
    "app_settings",
    "sales",
    "payments",
    "document_items",
  ]) {
    assert.throws(() => reader.from(table as never), /can't read/, table);
  }
  assert.equal(calls.length, 0);
});

test("the reader has no write methods at all", () => {
  const { client } = fakeClient();
  const table = createScopedReader(client as never, "user-1").from("receipts") as unknown as Record<
    string,
    unknown
  >;
  for (const method of ["insert", "update", "upsert", "delete"]) {
    assert.equal(table[method], undefined, method);
  }
  const reader = createScopedReader(client as never, "user-1") as unknown as Record<string, unknown>;
  for (const method of ["rpc", "storage", "auth"]) {
    assert.equal(reader[method], undefined, method);
  }
});
