import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_PLACE_LENGTH,
  defaultPlaceOfWork,
  parsePlaceText,
  placeOfWorkForNew,
  clientForJobChange,
  jobClientIdByName,
  jobPickerOptions,
  validateJobPatch,
} from "./job-fields.ts";

const free = { hasDraws: false, hasChanges: false };
const none = { contract_value: null, retainage_rate: null };
const billed = { contract_value: 5000, retainage_rate: 10 };

test("parsePlaceText: not sent, cleared and set are different", () => {
  assert.deepEqual(parsePlaceText(undefined, "x"), { ok: true, value: undefined });
  assert.deepEqual(parsePlaceText(null, "x"), { ok: true, value: null });
  assert.deepEqual(parsePlaceText("   ", "x"), { ok: true, value: null });
  assert.deepEqual(parsePlaceText("  12 Main St ", "x"), { ok: true, value: "12 Main St" });
});

test("parsePlaceText rejects non-text and over-long values", () => {
  assert.equal(parsePlaceText(5, "Location").ok, false);
  assert.equal(parsePlaceText("a".repeat(MAX_PLACE_LENGTH), "x").ok, true);
  assert.equal(parsePlaceText("a".repeat(MAX_PLACE_LENGTH + 1), "x").ok, false);
});

test("a name is required when sent, and trimmed", () => {
  assert.equal(validateJobPatch({ name: "  " }, none, free).ok, false);
  assert.deepEqual(validateJobPatch({ name: " A " }, none, free), { ok: true, update: { name: "A" } });
  assert.deepEqual(validateJobPatch({}, none, free), { ok: true, update: {} });
});

test("location and customer can be set and cleared", () => {
  assert.deepEqual(validateJobPatch({ location: " 1 Elm ", client_id: "c1" }, none, free), {
    ok: true,
    update: { location: "1 Elm", client_id: "c1" },
  });
  assert.deepEqual(validateJobPatch({ location: "", client_id: null }, none, free), {
    ok: true,
    update: { location: null, client_id: null },
  });
});

test("contract value must be a positive, finite, in-range amount (never silently 0)", () => {
  for (const v of [0, -5, "abc", NaN, 1e12]) {
    const r = validateJobPatch({ contract_value: v }, none, free);
    assert.equal(r.ok, false, String(v));
    if (!r.ok) assert.equal(r.status, 400);
  }
  assert.deepEqual(validateJobPatch({ contract_value: "1000.456" }, none, free), {
    ok: true,
    update: { contract_value: 1000.46 },
  });
});

test("clearing the contract value clears the retainage too", () => {
  assert.deepEqual(validateJobPatch({ contract_value: null }, billed, free), {
    ok: true,
    update: { contract_value: null, retainage_rate: null },
  });
});

test("retainage: blank/0 = none, under 100, and needs a contract value", () => {
  assert.deepEqual(validateJobPatch({ contract_value: 100, retainage_rate: 0 }, none, free), {
    ok: true,
    update: { contract_value: 100 },
  });
  assert.deepEqual(validateJobPatch({ contract_value: 100, retainage_rate: 10 }, none, free), {
    ok: true,
    update: { contract_value: 100, retainage_rate: 10 },
  });
  for (const r of [100, 150, -1, "x"]) {
    assert.equal(validateJobPatch({ contract_value: 100, retainage_rate: r }, none, free).ok, false, String(r));
  }
  assert.equal(validateJobPatch({ retainage_rate: 10 }, none, free).ok, false);
});

test("contract numbers are frozen once draws or change orders exist (409)", () => {
  for (const locks of [
    { hasDraws: true, hasChanges: false },
    { hasDraws: false, hasChanges: true },
  ]) {
    for (const body of [{ contract_value: 6000 }, { retainage_rate: 5 }, { contract_value: null }]) {
      const r = validateJobPatch(body, billed, locks);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.status, 409);
    }
  }
});

test("resending unchanged contract numbers on a locked job is fine (the edit form always sends them)", () => {
  const locks = { hasDraws: true, hasChanges: true };
  assert.deepEqual(
    validateJobPatch({ name: "N", contract_value: 5000, retainage_rate: 10 }, billed, locks),
    { ok: true, update: { name: "N" } },
  );
});

test("a new document uses the typed place, else the job's location", () => {
  assert.equal(placeOfWorkForNew("Other St", "Job St"), "Other St");
  assert.equal(placeOfWorkForNew(undefined, " Job St "), "Job St");
  assert.equal(placeOfWorkForNew(null, "Job St"), "Job St");
  assert.equal(placeOfWorkForNew(undefined, null), null);
});

test("the builder prefills from the picked job", () => {
  const jobs = [
    { name: "A", location: "1 A St" },
    { name: "B", location: null },
  ];
  assert.equal(defaultPlaceOfWork(jobs, "A"), "1 A St");
  assert.equal(defaultPlaceOfWork(jobs, "B"), "");
  assert.equal(defaultPlaceOfWork(jobs, null), "");
  assert.equal(defaultPlaceOfWork(jobs, "Missing"), "");
});

test("place of work is locked with the rest of a sent document's content and copied on conversion", () => {
  const patch = readFileSync("src/app/api/documents/[id]/route.ts", "utf8");
  assert.ok(/CONTENT_KEYS = \[[\s\S]*?"place_of_work"[\s\S]*?\];/.test(patch));
  assert.match(readFileSync("src/lib/estimate-conversion.ts", "utf8"), /place_of_work: estimate\.place_of_work/);
});

test("the EditJobDialog no longer sends only the name", () => {
  const src = readFileSync("src/components/jobs/edit-job-dialog.tsx", "utf8");
  for (const key of ["location", "client_id", "contract_value", "retainage_rate"]) {
    assert.ok(src.includes(key), key);
  }
});

const readLf = (path: string) => readFileSync(path, "utf8").split("\r\n").join("\n");

// Ownership checks: a foreign key proves a row exists, not that it is the signed-in owner's. These
// pin that each route looks the id up scoped to user_id and answers 404 before any write.
function ownerLookup(source: string, table: string, idExpr: string): boolean {
  const re = new RegExp(
    String.raw`from\("${table}"\)\s*\.select\("id"\)\s*\.eq\("id", ${idExpr}\)\s*\.eq\("user_id", user\.id\)`,
  );
  return re.test(source);
}

test("jobs routes verify the customer (client_id) belongs to the signed-in user", () => {
  const post = readLf("src/app/api/jobs/route.ts");
  const patch = readLf("src/app/api/jobs/[id]/route.ts");
  assert.ok(ownerLookup(post, "clients", "clientId"));
  assert.ok(ownerLookup(patch, "clients", "update\.client_id"));
  for (const src of [post, patch]) assert.ok(src.includes('"Customer not found."'));
  // checked before the write
  assert.ok(post.indexOf('"Customer not found."') < post.indexOf(".insert({"));
  assert.ok(patch.indexOf('"Customer not found."') < patch.indexOf('.from("jobs")\n    .update('));
});

test("documents routes verify client_id and job_id belong to the signed-in user", () => {
  const post = readLf("src/app/api/documents/route.ts");
  const patch = readLf("src/app/api/documents/[id]/route.ts");
  assert.ok(ownerLookup(post, "clients", "clientIdInput"));
  assert.ok(ownerLookup(patch, "clients", "body\.client_id"));
  assert.ok(ownerLookup(post, "jobs", "jobIdInput"));
  assert.ok(ownerLookup(patch, "jobs", "jobId"));
  for (const src of [post, patch]) {
    assert.ok(src.includes('"Client not found."'));
    assert.ok(src.includes('"Job not found."'));
  }
  // the client check runs before the first write (the inline new-client insert / the update)
  assert.ok(post.indexOf('"Client not found."') < post.indexOf('.from("clients")\n      .insert('));
  assert.ok(patch.indexOf('"Client not found."') < patch.indexOf('.from("clients")\n      .insert('));
});

const known = ["c1", "c2"];

test("a job's customer fills an empty client and records it as a job prefill", () => {
  assert.deepEqual(clientForJobChange({ clientId: null, source: "user" }, "c1", known), {
    clientId: "c1",
    source: "job",
  });
});

test("a client the person picked is never overwritten", () => {
  const picked = { clientId: "c2", source: "user" as const };
  assert.equal(clientForJobChange(picked, "c1", known), picked);
});

test("switching job re-prefills a job-prefilled client, but not a picked one", () => {
  assert.deepEqual(clientForJobChange({ clientId: "c1", source: "job" }, "c2", known), {
    clientId: "c2",
    source: "job",
  });
  const picked = { clientId: "c1", source: "user" as const };
  assert.equal(clientForJobChange(picked, "c2", known), picked);
});

test("a job with no customer, or one not in the owner's clients, prefills nothing", () => {
  const prefilled = { clientId: "c1", source: "job" as const };
  assert.equal(clientForJobChange(prefilled, null, known), prefilled);
  assert.equal(clientForJobChange(prefilled, undefined, known), prefilled);
  assert.equal(clientForJobChange(prefilled, "gone", known), prefilled);
  const empty = { clientId: null, source: "user" as const };
  assert.equal(clientForJobChange(empty, null, known), empty);
  assert.equal(clientForJobChange(empty, "gone", known), empty);
});

test("re-picking the same job keeps the same pick object", () => {
  const prefilled = { clientId: "c1", source: "job" as const };
  assert.equal(clientForJobChange(prefilled, "c1", known), prefilled);
});

test("jobClientIdByName finds the picked job's customer", () => {
  const jobs = [{ name: "A", client_id: "c1" }, { name: "B", client_id: null }, { name: "C" }];
  assert.equal(jobClientIdByName(jobs, "A"), "c1");
  assert.equal(jobClientIdByName(jobs, "B"), null);
  assert.equal(jobClientIdByName(jobs, "C"), null);
  assert.equal(jobClientIdByName(jobs, null), null);
  assert.equal(jobClientIdByName(jobs, "Nope"), null);
});

test("converting an estimate keeps the document's own client (never re-derived from the job)", () => {
  const src = readLf("src/lib/estimate-conversion.ts");
  assert.ok(src.includes("client_id: estimate.client_id"));
  assert.ok(!/clientForJobChange|jobs"\)[\s\S]{0,80}client_id/.test(src));
});

test("the builder and the editor both use the shared prefill helper", () => {
  for (const f of ["document-builder", "document-editor"]) {
    const src = readLf(`src/components/invoices/${f}.tsx`);
    assert.ok(src.includes("clientForJobChange"), f);
  }
});

const pickerJobs = [
  { id: "j1", name: "Kitchen", client_id: "c1", contract_value: null },
  { id: "j2", name: "Condo", client_id: null, contract_value: null },
  { id: "j3", name: "Tower", client_id: "c2", contract_value: 50000 },
];
const pickerClients = [
  { id: "c1", name: "Ann" },
  { id: "c2", name: "Bo" },
];

test("the job picker lists every job with its customer", () => {
  const o = jobPickerOptions(pickerJobs, pickerClients, { type: "estimate", isDraw: false, selectedName: null });
  assert.deepEqual(o.map((x) => x.value), ["Kitchen", "Condo", "Tower"]);
  assert.deepEqual(o.map((x) => x.label), ["Kitchen · Ann", "Condo", "Tower · Bo"]);
  assert.ok(o.every((x) => !x.disabled), "an estimate can use any job, progress-billed or not");
});

test("a progress-billed job is shown (never hidden) but disabled for a plain invoice", () => {
  const o = jobPickerOptions(pickerJobs, pickerClients, { type: "invoice", isDraw: false, selectedName: null });
  assert.equal(o.length, 3);
  const tower = o.find((x) => x.value === "Tower");
  assert.equal(tower?.disabled, true);
  assert.match(tower?.label ?? "", /progress billing/);
  assert.equal(o.filter((x) => x.disabled).length, 1);
});

test("a draw, or the document's own job, can still use a progress-billed job", () => {
  const draw = jobPickerOptions(pickerJobs, pickerClients, { type: "invoice", isDraw: true, selectedName: null });
  assert.ok(draw.every((x) => !x.disabled));
  const own = jobPickerOptions(pickerJobs, pickerClients, { type: "invoice", isDraw: false, selectedName: "Tower" });
  assert.equal(own.find((x) => x.value === "Tower")?.disabled, false);
});

test("a customer that is not in the client list just shows the job name", () => {
  const o = jobPickerOptions([{ id: "x", name: "Solo", client_id: "gone" }], pickerClients, {
    type: "estimate",
    isDraw: false,
    selectedName: null,
  });
  assert.equal(o[0].label, "Solo");
});

test("no estimate/invoice page filters the job list down (every job is loaded, with client_id)", () => {
  for (const page of [
    "estimates/new",
    "invoices/new",
    "estimates/[id]",
    "estimates/[id]/edit",
    "invoices/[id]",
    "invoices/[id]/edit",
  ]) {
    const src = readLf(`src/app/(app)/dashboard/${page}/page.tsx`);
    const jobsQuery = src.slice(src.indexOf('.from("jobs")'), src.indexOf('.from("jobs")') + 220);
    assert.ok(jobsQuery.includes("client_id"), `${page} must load client_id`);
    assert.ok(jobsQuery.includes("contract_value"), `${page} must load contract_value`);
    assert.ok(!/\.is\("contract_value"/.test(src), `${page} must not hide progress-billed jobs`);
    assert.ok(!/j\.contract_value === null/.test(src), `${page} must not filter jobs in memory`);
  }
});
