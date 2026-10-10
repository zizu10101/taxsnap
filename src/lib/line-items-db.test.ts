import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { lineDescription, lineName } from "./line-format.ts";
import { lineFromSavedItem, sortSavedItems } from "./saved-items.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createLineItem } from "./line-items-server.ts";
import { saveReusableItems } from "./save-line-items.ts";

// The "Save for next time" flow against the real database, as REAL SIGNED-IN USERS: the same client
// createLineItem gets in POST /api/line-items (row-level security applies), driven through the same
// saveReusableItems the estimate/invoice/change-order forms call, then read back with the query the
// saved-items picker uses (line_items where is_active, by description).
//
// Runs against the REAL project (shared with production), so it is OFF unless
//   RUN_DB_ISOLATION_TEST=1 node --env-file=.env.local --test src/lib/line-items-db.test.ts
// It creates throwaway users and always deletes them, verifying nothing is left.

const RUN = process.env.RUN_DB_ISOLATION_TEST === "1";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = `Pw-${randomUUID()}`;

describe("saved items (real database, signed-in users)", { skip: !RUN || !URL_ || !ANON || !SERVICE }, () => {
  let admin: SupabaseClient;
  const created: string[] = [];
  interface Person {
    id: string;
    client: SupabaseClient;
  }

  async function makePerson(label: string, tier: "free" | "pro"): Promise<Person> {
    const email = `line-items-${label}-${randomUUID()}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(error);
    const id = data.user!.id;
    created.push(id);
    // handle_new_user() created the profile row; set the tier the way billing would.
    assert.ifError((await admin.from("profiles").update({ subscription_status: tier }).eq("id", id)).error);
    const client = createClient(URL_!, ANON!, { auth: { persistSession: false } });
    assert.ifError((await client.auth.signInWithPassword({ email, password })).error);
    return { id, client };
  }

  // What POST /api/line-items does, minus the HTTP envelope: fetch(...) -> createLineItem(...).
  const asFetch = (p: Person) =>
    (async (_url: unknown, init?: RequestInit) => {
      const { status, body } = await createLineItem(p.client as never, p.id, JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;

  // The picker's data source (see e.g. estimates/new/page.tsx).
  const pickerItems = async (p: Person) =>
    sortSavedItems(
      (await p.client.from("line_items").select("*").eq("is_active", true)).data as {
        name: string | null;
        description: string;
        unit: string | null;
        unit_price: number;
      }[],
    );

  before(() => {
    admin = createClient(URL_!, SERVICE!, { auth: { persistSession: false } });
  });

  after(async () => {
    for (const id of created) await admin.auth.admin.deleteUser(id);
    if (created.length > 0) {
      const { count } = await admin.from("line_items").select("*", { count: "exact", head: true }).in("user_id", created);
      assert.equal(count, 0, "leftover line items");
    }
  });

  it("Pro user: ticked items are saved and show up in the NEXT picker load, with their prices", async () => {
    const pro = await makePerson("pro", "pro");
    assert.deepEqual(await pickerItems(pro), []);

    const r = await saveReusableItems(
      [
        { name: "Interior paint", description: "per room", unit: "each", unit_price: 450 },
        { name: "Drywall patch", description: "", unit_price: 85.5 },
        // the older caller shape (description only) is read as name = description
        { description: "Trim, per metre", unit_price: 6 },
      ],
      asFetch(pro),
    );
    assert.deepEqual(r, { saved: 3, failures: [] });

    // "Next estimate": a fresh read of the same data the picker is built from.
    const items = await pickerItems(pro);
    assert.deepEqual(
      items.map((i) => [lineName(i), lineDescription(i), i.unit, Number(i.unit_price)]),
      [
        ["Drywall patch", "", null, 85.5], // blank unit is null, never ""
        ["Interior paint", "per room", "each", 450],
        ["Trim, per metre", "", null, 6],
      ],
    );
  });

  it("Free user at the cap: the failure is reported, nothing extra is saved", async () => {
    const free = await makePerson("free", "free"); // cap is 1 active saved item
    const r = await saveReusableItems(
      [
        { description: "First", unit_price: 1 },
        { description: "Second", unit_price: 2 },
      ],
      asFetch(free),
    );
    assert.equal(r.saved, 1);
    assert.equal(r.failures.length, 1);
    assert.match(r.failures[0], /"Second"/);
    assert.equal((await pickerItems(free)).length, 1);
  });

  // Needs migration 0059 (the column still exists; nothing writes or reads it any more).
  it("a saved item stores no quantity, and an old row's stored quantity is not recalled on pick", async (t) => {
    const probe = await admin.from("line_items").select("quantity").limit(1);
    if (probe.error) return t.skip("migration 0059 (line_items.quantity) is not applied yet");

    const pro = await makePerson("qty", "pro");
    // The forms' drafts carry a quantity (800 sq ft); saving for reuse must not store it.
    const draft = { name: "Flooring", description: "oak", unit: "sq ft", unit_price: 5, quantity: 800 };
    const r = await saveReusableItems([draft], asFetch(pro));
    assert.deepEqual(r, { saved: 1, failures: [] });

    // A direct API call that sends a quantity is ignored too (an old tab), not rejected.
    const direct = await createLineItem(pro.client as never, pro.id, { name: "Trim", unit_price: 2, quantity: 6 });
    assert.equal(direct.status, 201);

    const rows = (await pickerItems(pro)) as unknown as { name: string; unit: string; unit_price: number; quantity: number }[];
    assert.deepEqual(rows.map((i) => Number(i.quantity)), [1, 1]); // the column default, never 800 / 6

    // An existing row from before the change that DOES hold a quantity (inserted straight in):
    await admin.from("line_items").insert({ user_id: pro.id, name: "Old row", description: "", unit_price: 9, quantity: 6 });
    const all = (await pickerItems(pro)) as unknown as Parameters<typeof lineFromSavedItem>[0][];
    const old = all.find((i) => lineName(i) === "Old row")!;
    assert.equal(Number((old as unknown as { quantity: number }).quantity), 6); // still stored
    assert.equal(lineFromSavedItem(old).quantity, 1); // but a pick comes back with 1
    assert.ok(all.every((i) => lineFromSavedItem(i).quantity === 1));
  });

  it("a blank name is rejected (400) and nothing is written", async () => {
    const pro = await makePerson("blank", "pro");
    const res = await createLineItem(pro.client as never, pro.id, { name: "  ", description: "kept?", unit_price: 5 });
    assert.equal(res.status, 400);
    assert.deepEqual(await pickerItems(pro), []);
  });
});
