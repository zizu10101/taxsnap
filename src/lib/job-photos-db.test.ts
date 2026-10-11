import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { photoPaths } from "./job-photos.ts";

// Site-photo isolation against the real database and the real job-photos bucket, as REAL SIGNED-IN USERS
// (row-level security and the storage policies apply, exactly as in the app's routes).
//
// Runs against the REAL project (shared with production), so it is OFF unless
//   RUN_DB_ISOLATION_TEST=1 node --env-file=.env.local --test src/lib/job-photos-db.test.ts
// It creates throwaway users, always deletes them (their rows cascade) and removes every file it
// uploaded, verifying nothing is left. It skips itself until migration 0063 (the job_photos table) and
// 0063_job_photos_storage.sql (the job-photos bucket) are applied.

const RUN = process.env.RUN_DB_ISOLATION_TEST === "1";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "job-photos";
const password = `Pw-${randomUUID()}`;

// A tiny but real JPEG (start of image, a JFIF header, start of scan, end of image). The bucket checks
// the declared type and size, not the pixels.
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0x34, 0xff, 0xd9,
]);

describe("job photos isolation (real database, signed-in users)", { skip: !RUN || !URL_ || !ANON || !SERVICE }, () => {
  let admin: SupabaseClient;
  let notReady: string | null = null;
  const createdUsers: string[] = [];
  const uploaded: string[] = [];

  interface Person {
    id: string;
    client: SupabaseClient;
  }

  async function makePerson(label: string): Promise<Person> {
    const email = `job-photos-${label}-${randomUUID()}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(error);
    const id = data.user!.id;
    createdUsers.push(id);
    const client = createClient(URL_!, ANON!, { auth: { persistSession: false } });
    assert.ifError((await client.auth.signInWithPassword({ email, password })).error);
    return { id, client };
  }

  // A and B, plus A's job, one photo row and one file in A's folder - made once, as A, through the
  // same paths the app uses.
  let a: Person;
  let b: Person;
  let aJobId: string;
  let aPhotoId: string;
  let aPaths: { storage_path: string; thumb_path: string };

  before(async () => {
    admin = createClient(URL_!, SERVICE!, { auth: { persistSession: false } });

    const table = await admin.from("job_photos").select("id").limit(1);
    if (table.error) {
      notReady = "migration 0063 (job_photos table) is not applied yet";
      return;
    }
    const bucket = await admin.storage.getBucket(BUCKET);
    if (bucket.error || !bucket.data) {
      notReady = "the job-photos bucket (0063_job_photos_storage.sql) does not exist yet";
      return;
    }

    a = await makePerson("a");
    b = await makePerson("b");

    const job = await admin.from("jobs").insert({ user_id: a.id, name: `Photos job ${randomUUID().slice(0, 8)}` }).select("id").single();
    assert.ifError(job.error);
    aJobId = job.data!.id;

    aPhotoId = randomUUID();
    aPaths = photoPaths(a.id, aPhotoId);
    for (const path of [aPaths.storage_path, aPaths.thumb_path]) {
      const up = await a.client.storage.from(BUCKET).upload(path, JPEG, { contentType: "image/jpeg", upsert: false });
      assert.ifError(up.error);
      uploaded.push(path);
    }
    const row = await a.client.from("job_photos").insert({
      id: aPhotoId,
      user_id: a.id,
      job_id: aJobId,
      ...aPaths,
      caption: "A's photo",
    });
    assert.ifError(row.error);
  });

  after(async () => {
    if (!admin) return;
    if (uploaded.length > 0) await admin.storage.from(BUCKET).remove(uploaded);
    for (const id of createdUsers) await admin.auth.admin.deleteUser(id);
    if (createdUsers.length > 0) {
      const { count } = await admin.from("job_photos").select("*", { count: "exact", head: true }).in("user_id", createdUsers);
      assert.equal(count, 0, "leftover photo rows");
      for (const id of createdUsers) {
        const { data } = await admin.storage.from(BUCKET).list(id);
        assert.deepEqual(data ?? [], [], "leftover files in a throwaway user's folder");
      }
    }
  });

  // ------------------------------------------------------------ 1. rows

  it("the owner can read their own photo row", async (t) => {
    if (notReady) return t.skip(notReady);
    const { data, error } = await a.client.from("job_photos").select("id, caption").eq("id", aPhotoId);
    assert.ifError(error);
    assert.deepEqual(data, [{ id: aPhotoId, caption: "A's photo" }]);
  });

  it("B cannot select A's photo rows", async (t) => {
    if (notReady) return t.skip(notReady);
    const byId = await b.client.from("job_photos").select("*").eq("id", aPhotoId);
    assert.ifError(byId.error);
    assert.deepEqual(byId.data, []);
    const byJob = await b.client.from("job_photos").select("*").eq("job_id", aJobId);
    assert.deepEqual(byJob.data, []);
    const all = await b.client.from("job_photos").select("*");
    assert.ok((all.data ?? []).every((r) => r.user_id === b.id), "B only ever sees B's rows");
  });

  it("B cannot update A's photo row (no error, but nothing changes)", async (t) => {
    if (notReady) return t.skip(notReady);
    const res = await b.client.from("job_photos").update({ caption: "hacked", job_id: null }).eq("id", aPhotoId).select();
    assert.deepEqual(res.data ?? [], []);
    const { data } = await admin.from("job_photos").select("caption, job_id, user_id").eq("id", aPhotoId).single();
    assert.deepEqual(data, { caption: "A's photo", job_id: aJobId, user_id: a.id });
  });

  it("B cannot delete A's photo row (no error, row survives)", async (t) => {
    if (notReady) return t.skip(notReady);
    const res = await b.client.from("job_photos").delete().eq("id", aPhotoId).select();
    assert.deepEqual(res.data ?? [], []);
    const { count } = await admin.from("job_photos").select("*", { count: "exact", head: true }).eq("id", aPhotoId);
    assert.equal(count, 1);
  });

  // ------------------------------------------------------------ 2. inserts

  it("B cannot insert a photo row pointing at A's job (as B, or pretending to be A)", async (t) => {
    if (notReady) return t.skip(notReady);
    const id = randomUUID();
    const asB = await b.client.from("job_photos").insert({ id, user_id: b.id, job_id: aJobId, ...photoPaths(b.id, id) });
    assert.ok(asB.error, "RLS must refuse a job that is not B's");
    const id2 = randomUUID();
    const asA = await b.client.from("job_photos").insert({ id: id2, user_id: a.id, job_id: aJobId, ...photoPaths(a.id, id2) });
    assert.ok(asA.error, "RLS must refuse a row owned by someone else");
    const { count } = await admin.from("job_photos").select("*", { count: "exact", head: true }).in("id", [id, id2]);
    assert.equal(count, 0);
  });

  it("B cannot move one of their own photos onto A's job", async (t) => {
    if (notReady) return t.skip(notReady);
    const id = randomUUID();
    const own = await b.client.from("job_photos").insert({ id, user_id: b.id, job_id: null, ...photoPaths(b.id, id) });
    assert.ifError(own.error); // an Unsorted photo of their own is fine
    const move = await b.client.from("job_photos").update({ job_id: aJobId }).eq("id", id).select();
    assert.ok(move.error || (move.data ?? []).length === 0, "moving onto A's job must fail");
    const { data } = await admin.from("job_photos").select("job_id").eq("id", id).single();
    assert.equal(data!.job_id, null);
  });

  it("a row cannot point at another user's folder", async (t) => {
    if (notReady) return t.skip(notReady);
    const id = randomUUID();
    const res = await b.client.from("job_photos").insert({ id, user_id: b.id, job_id: null, ...photoPaths(a.id, id) });
    assert.ok(res.error, "the paths-in-own-folder check must refuse it");
  });

  // ------------------------------------------------------------ 3. B vs A's files

  it("B cannot create a signed URL for A's file", async (t) => {
    if (notReady) return t.skip(notReady);
    const res = await b.client.storage.from(BUCKET).createSignedUrl(aPaths.storage_path, 60);
    assert.ok(res.error || !res.data?.signedUrl, "no signed URL for another user's file");
    const many = await b.client.storage.from(BUCKET).createSignedUrls([aPaths.storage_path, aPaths.thumb_path], 60);
    assert.ok((many.data ?? []).every((d) => !d.signedUrl), "no signed URLs in bulk either");
  });

  it("B cannot download A's file, and cannot list A's folder", async (t) => {
    if (notReady) return t.skip(notReady);
    const dl = await b.client.storage.from(BUCKET).download(aPaths.storage_path);
    assert.ok(dl.error, "download must fail");
    const list = await b.client.storage.from(BUCKET).list(a.id);
    assert.deepEqual(list.data ?? [], []);
  });

  it("B cannot delete A's file (it is still there afterwards)", async (t) => {
    if (notReady) return t.skip(notReady);
    const res = await b.client.storage.from(BUCKET).remove([aPaths.storage_path, aPaths.thumb_path]);
    assert.deepEqual(res.data ?? [], [], "nothing is reported as removed");
    for (const path of [aPaths.storage_path, aPaths.thumb_path]) {
      const still = await admin.storage.from(BUCKET).download(path);
      assert.ifError(still.error);
    }
  });

  it("B cannot upload into A's folder, nor overwrite A's file", async (t) => {
    if (notReady) return t.skip(notReady);
    const evil = `${a.id}/${randomUUID()}.jpg`;
    const up = await b.client.storage.from(BUCKET).upload(evil, JPEG, { contentType: "image/jpeg" });
    assert.ok(up.error, "upload into someone else's folder must fail");
    const gone = await admin.storage.from(BUCKET).download(evil);
    assert.ok(gone.error, "and nothing was written");

    const overwrite = await b.client.storage
      .from(BUCKET)
      .upload(aPaths.storage_path, new Uint8Array([...JPEG, 0x00, 0x00]), { contentType: "image/jpeg", upsert: true });
    assert.ok(overwrite.error, "overwriting A's file must fail");
    const original = await admin.storage.from(BUCKET).download(aPaths.storage_path);
    assert.ifError(original.error);
    assert.equal(original.data!.size, JPEG.length, "A's file is unchanged");
  });

  // ------------------------------------------------------------ 4. own files, and bucket limits

  it("a user CAN upload, sign, download and delete their own file", async (t) => {
    if (notReady) return t.skip(notReady);
    const path = photoPaths(b.id, randomUUID()).storage_path;
    const up = await b.client.storage.from(BUCKET).upload(path, JPEG, { contentType: "image/jpeg", upsert: false });
    assert.ifError(up.error);
    uploaded.push(path);

    const signed = await b.client.storage.from(BUCKET).createSignedUrl(path, 60);
    assert.ifError(signed.error);
    const fetched = await fetch(signed.data!.signedUrl);
    assert.equal(fetched.status, 200);
    assert.equal((await fetched.arrayBuffer()).byteLength, JPEG.length);

    const dl = await b.client.storage.from(BUCKET).download(path);
    assert.ifError(dl.error);

    const del = await b.client.storage.from(BUCKET).remove([path]);
    assert.ifError(del.error);
    assert.equal((del.data ?? []).length, 1);
    assert.ok((await admin.storage.from(BUCKET).download(path)).error, "the file is really gone");
  });

  it("the bucket refuses a non-JPEG and anything over 500 KB, even in the user's own folder", async (t) => {
    if (notReady) return t.skip(notReady);
    const png = await b.client.storage
      .from(BUCKET)
      .upload(`${b.id}/${randomUUID()}.png`, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), { contentType: "image/png" });
    assert.ok(png.error, "a PNG must be refused");
    const text = await b.client.storage
      .from(BUCKET)
      .upload(`${b.id}/${randomUUID()}.jpg`, new Uint8Array([1, 2, 3]), { contentType: "text/plain" });
    assert.ok(text.error, "a non-image type must be refused");

    const big = new Uint8Array(500 * 1024 + 1024);
    big.set(JPEG);
    const bigPath = `${b.id}/${randomUUID()}.jpg`;
    const tooBig = await b.client.storage.from(BUCKET).upload(bigPath, big, { contentType: "image/jpeg" });
    assert.ok(tooBig.error, "a JPEG over the 500 KB bucket limit must be refused");
    assert.ok((await admin.storage.from(BUCKET).download(bigPath)).error, "and nothing was stored");
  });
});
