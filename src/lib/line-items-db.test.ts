import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
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
    (await p.client.from("line_items").select("*").eq("is_active", true).order("description", { ascending: true }))
      .data as { description: string; unit_price: number }[];

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
        { description: "Interior paint, per room", unit_price: 450 },
        { description: "Drywall patch", unit_price: 85.5 },
        { description: "Trim, per metre", unit_price: 6 },
      ],
      asFetch(pro),
    );
    assert.deepEqual(r, { saved: 3, failures: [] });

    // "Next estimate": a fresh read of the same data the picker is built from.
    const items = await pickerItems(pro);
    assert.deepEqual(
      items.map((i) => [i.description, Number(i.unit_price)]),
      [
        ["Drywall patch", 85.5],
        ["Interior paint, per room", 450],
        ["Trim, per metre", 6],
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

  // Needs migration 0059; skips until it has been applied (like the 0053 cases elsewhere).
  it("quantity is stored and comes back in the next picker load; a bad quantity writes nothing", async (t) => {
    const probe = await admin.from("line_items").select("quantity").limit(1);
    if (probe.error) return t.skip("migration 0059 (line_items.quantity) is not applied yet");

    const pro = await makePerson("qty", "pro");
    const r = await saveReusableItems([{ description: "Potlight, installed", unit_price: 120, quantity: 6 }], asFetch(pro));
    assert.deepEqual(r, { saved: 1, failures: [] });

    const [item] = (await pickerItems(pro)) as { description: string; unit_price: number; quantity: number }[];
    assert.equal(item.description, "Potlight, installed");
    assert.equal(Number(item.unit_price), 120);
    assert.equal(Number(item.quantity), 6);

    for (const bad of [0, -2, "abc"]) {
      const res = await createLineItem(pro.client as never, pro.id, { description: "Bad", unit_price: 1, quantity: bad });
      assert.equal(res.status, 400, String(bad));
    }
    assert.equal((await pickerItems(pro)).length, 1);
  });

  it("one owner never sees another's saved items", async () => {
    const a = await makePerson("iso-a", "pro");
    const b = await makePerson("iso-b", "pro");
    await saveReusableItems([{ description: "Only A's", unit_price: 9 }], asFetch(a));
    assert.deepEqual(await pickerItems(b), []);
    assert.equal((await pickerItems(a)).length, 1);
  });

  it("a blank description is rejected (400) and nothing is written", async () => {
    const pro = await makePerson("blank", "pro");
    const res = await createLineItem(pro.client as never, pro.id, { description: "  ", unit_price: 5 });
    assert.equal(res.status, 400);
    assert.deepEqual(await pickerItems(pro), []);
  });
});
