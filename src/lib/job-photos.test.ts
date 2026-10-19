import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DISPLAY_MAX_EDGE,
  DISPLAY_QUALITIES,
  DISPLAY_TARGET_BYTES,
  MAX_DISPLAY_BYTES,
  MAX_SHRINKS,
  PHOTO_BUCKET,
  THUMB_MAX_EDGE,
  THUMB_QUALITIES,
  THUMB_TARGET_BYTES,
} from "./photo-config.ts";
import { encodeDisplay, encodeThumbnail, encodeWithinBudget, fitWithin } from "./photo-sizing.ts";
import { hasMetadataSegment, isJpeg } from "./jpeg-check.ts";
import {
  MAX_BULK_PHOTOS,
  parseCaption,
  parseIdList,
  parseJobRef,
  parseTakenAt,
  pathBelongsTo,
  photoPaths,
  validatePhotoFiles,
} from "./job-photos.ts";
import { deletePhoto, deletePhotos, filePaths, movePhotos, removePhotoFiles } from "./job-photos-server.ts";
import { limitReachedMessage, PLAN_LIMITS, wouldExceedTotalLimit } from "./plan-limits.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

// ------------------------------------------------------------ sizing (no browser)

test("fitWithin: long edge is capped, aspect kept, never scaled up", () => {
  assert.deepEqual(fitWithin(4000, 3000, 1600), { width: 1600, height: 1200 });
  assert.deepEqual(fitWithin(3000, 4000, 1600), { width: 1200, height: 1600 }); // portrait
  assert.deepEqual(fitWithin(800, 600, 1600), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(4000, 3000, 300), { width: 300, height: 225 });
  assert.deepEqual(fitWithin(0, 0, 300), { width: 1, height: 1 });
  assert.equal(fitWithin(10000, 1, 300).height, 1);
});

// A stand-in encoder: bytes grow with pixel count and quality, like a real JPEG.
const fakeEncode =
  (bytesPerPixelAtQ1: number) =>
  async (size: { width: number; height: number }, quality: number) =>
    new Blob([new Uint8Array(Math.round(size.width * size.height * bytesPerPixelAtQ1 * quality))]);

test("encodeWithinBudget: steps quality down until it fits, and stops at the first that does", async () => {
  const seen: number[] = [];
  const encode = async (size: { width: number; height: number }, quality: number) => {
    seen.push(quality);
    return fakeEncode(0.3)(size, quality);
  };
  // 1600x1200 at 0.3 B/px: q .82 -> 472 KB ... q .42 -> 242 KB, the first under 250 KB
  const r = await encodeDisplay(4000, 3000, encode);
  assert.ok(r.blob.size <= DISPLAY_TARGET_BYTES || !r.withinBudget);
  assert.equal(r.width, 1600);
  assert.deepEqual(seen, seen.slice().sort((a, b) => b - a), "qualities only go down");
  assert.ok(seen.length >= 2, "needed more than one attempt");
});

test("encodeWithinBudget: a photo that is already small is accepted at the top quality", async () => {
  const r = await encodeDisplay(640, 480, fakeEncode(0.05));
  assert.equal(r.quality, DISPLAY_QUALITIES[0]);
  assert.ok(r.withinBudget);
  assert.deepEqual([r.width, r.height], [640, 480]);
});

test("encodeWithinBudget: shrinks the edge when no quality fits, up to MAX_SHRINKS, then returns the smallest", async () => {
  let calls = 0;
  const hopeless = async () => {
    calls += 1;
    return new Blob([new Uint8Array(900_000 - calls)]); // always far over budget, slowly shrinking
  };
  const r = await encodeWithinBudget(4000, 3000, { maxEdge: 1600, targetBytes: 1000, qualities: [0.8, 0.5] }, hopeless);
  assert.equal(r.withinBudget, false);
  assert.equal(calls, (MAX_SHRINKS + 1) * 2);
  assert.equal(r.blob.size, 900_000 - calls, "the smallest attempt is returned");
});

test("encodeWithinBudget: shrinking the edge can bring a stubborn photo under budget", async () => {
  // Even q .35 at 1600 px is over 250 KB here, but the 0.8x edge (1280 px) fits.
  const r = await encodeDisplay(4000, 3000, fakeEncode(0.5));
  assert.ok(r.withinBudget);
  assert.equal(r.width, 1280);
});

test("thumbnail: ~300 px long edge, under ~20 KB", async () => {
  const r = await encodeThumbnail(4000, 3000, fakeEncode(0.25));
  assert.equal(r.width, THUMB_MAX_EDGE);
  assert.ok(r.blob.size <= THUMB_TARGET_BYTES);
  assert.ok(THUMB_QUALITIES.length > 1);
});

test("the sizes live in one file with the values from the spec", () => {
  assert.equal(THUMB_MAX_EDGE, 300);
  assert.equal(THUMB_TARGET_BYTES, 20 * 1024);
  assert.equal(DISPLAY_MAX_EDGE, 1600);
  assert.equal(DISPLAY_TARGET_BYTES, 250 * 1024);
  assert.ok(MAX_DISPLAY_BYTES > DISPLAY_TARGET_BYTES, "the server limit leaves headroom over the client target");
  // photo-sizing and photo-compress take every number from photo-config, none of their own
  assert.doesNotMatch(read("./photo-sizing.ts") + read("./photo-compress.ts"), /\b(1600|300|250 \* 1024|20 \* 1024)\b/);
});

// ------------------------------------------------------------ jpeg bytes

const seg = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
const jpeg = (...segments: number[][]) =>
  new Uint8Array([0xff, 0xd8, ...segments.flat(), ...seg(0xda, [1, 1, 0, 0, 63, 0]), 0x12, 0x34, 0xff, 0xd9]);
const jfif = seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const exif = seg(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, 1, 2, 3]);

test("isJpeg / hasMetadataSegment: a plain re-encoded JPEG is clean, EXIF/XMP/IPTC/comment are caught", () => {
  assert.ok(isJpeg(jpeg(jfif)));
  assert.equal(hasMetadataSegment(jpeg(jfif)), false);
  assert.equal(hasMetadataSegment(jpeg(jfif, exif)), true);
  assert.equal(hasMetadataSegment(jpeg(exif)), true);
  assert.equal(hasMetadataSegment(jpeg(jfif, seg(0xed, [1, 2, 3]))), true); // Photoshop / IPTC
  assert.equal(hasMetadataSegment(jpeg(jfif, seg(0xfe, [104, 105]))), true); // comment
  assert.equal(isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0])), false); // PNG
  assert.equal(isJpeg(new Uint8Array([])), false);
});

// ------------------------------------------------------------ upload rules

const file = (bytes: Uint8Array, type = "image/jpeg"): { type: string; size: number; bytes: Uint8Array } => ({
  type,
  size: bytes.length,
  bytes,
});

test("validatePhotoFiles: accepts clean JPEGs, refuses everything else with a reason", () => {
  const good = file(jpeg(jfif));
  assert.equal(validatePhotoFiles(good, good), null);
  assert.match(validatePhotoFiles(null, good)!, /required/);
  assert.match(validatePhotoFiles(good, null)!, /required/);
  assert.match(validatePhotoFiles(file(new Uint8Array(0)), good)!, /empty/);
  // declared type wrong, or bytes are not a JPEG even though the type says so
  assert.match(validatePhotoFiles(file(jpeg(jfif), "image/png"), good)!, /JPEG/);
  assert.match(validatePhotoFiles(file(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])), good)!, /JPEG/);
  // metadata still present
  assert.match(validatePhotoFiles(file(jpeg(jfif, exif)), good)!, /metadata/);
  // too big: the photo over its limit, the thumbnail over its (smaller) one
  const big = new Uint8Array(MAX_DISPLAY_BYTES + 1);
  big.set([0xff, 0xd8, 0xff]);
  assert.match(validatePhotoFiles(file(big), good)!, /too large/);
  const bigThumb = new Uint8Array(70 * 1024);
  bigThumb.set([0xff, 0xd8, 0xff]);
  assert.match(validatePhotoFiles(good, file(bigThumb))!, /thumbnail is too large/);
});

test("parseCaption / parseJobRef / parseTakenAt", () => {
  assert.deepEqual(parseCaption("  front door  "), { ok: true, value: "front door" });
  assert.deepEqual(parseCaption("   "), { ok: true, value: null });
  assert.deepEqual(parseCaption(null), { ok: true, value: null });
  assert.equal(parseCaption("x".repeat(200)).ok, true);
  assert.equal(parseCaption("x".repeat(201)).ok, false);
  assert.equal(parseCaption(42).ok, false);

  const id = "3f2b8c1e-0a4d-4e6f-9b1a-7c5d2e8f9a01";
  assert.deepEqual(parseJobRef(id), { ok: true, jobId: id });
  assert.deepEqual(parseJobRef(""), { ok: true, jobId: null });
  assert.deepEqual(parseJobRef("unsorted"), { ok: true, jobId: null });
  assert.equal(parseJobRef("not-a-uuid").ok, false);
  assert.equal(parseJobRef("1 or 1=1").ok, false);

  const now = new Date("2026-10-11T12:00:00Z");
  assert.equal(parseTakenAt("2026-10-01T09:30:00Z", now), "2026-10-01T09:30:00.000Z");
  assert.equal(parseTakenAt("2030-01-01T00:00:00Z", now), now.toISOString(), "never in the future");
  assert.equal(parseTakenAt("garbage", now), now.toISOString());
  assert.equal(parseTakenAt(undefined, now), now.toISOString());
});

test("photoPaths: both files go in the owner's folder, and nothing else counts as theirs", () => {
  const p = photoPaths("user-1", "photo-9");
  assert.deepEqual(p, { storage_path: "user-1/photo-9.jpg", thumb_path: "user-1/photo-9_thumb.jpg" });
  assert.ok(pathBelongsTo("user-1", p.storage_path));
  assert.ok(!pathBelongsTo("user-2", p.storage_path));
  assert.ok(!pathBelongsTo("user-1", "user-1/../user-2/x.jpg"));
  assert.ok(!pathBelongsTo("user-1", "user-1/sub/x.jpg"));
  assert.ok(!pathBelongsTo("user-1", "user-10/x.jpg"));
});

// ------------------------------------------------------------ caps

function capDb(tier: string, photos: number) {
  return {
    from(table: string) {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { subscription_status: tier } }) }) }) };
      }
      if (table === "job_photos") {
        return { select: () => ({ eq: async () => ({ count: photos }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

test("photo caps: placeholder numbers per tier (Free 10, Pro 2000)", () => {
  assert.equal(PLAN_LIMITS.free.photos, 10);
  assert.equal(PLAN_LIMITS.pro.photos, 2000);
  assert.match(read("./plan-limits.ts"), /photos: 10, \/\/ PLACEHOLDER/);
  assert.match(read("./plan-limits.ts"), /PLACEHOLDER numbers/);
});

test("photo caps: counted from the database, blocked AT the cap, not before", async () => {
  assert.equal((await wouldExceedTotalLimit(capDb("free", 9), "u", "photos")).exceeded, false);
  const atCap = await wouldExceedTotalLimit(capDb("free", 10), "u", "photos");
  assert.equal(atCap.exceeded, true);
  assert.equal(atCap.limit, 10);
  // A leftover 'basic' row (the retired tier) is Free, never an unknown key.
  assert.equal((await wouldExceedTotalLimit(capDb("basic", 9), "u", "photos")).exceeded, false);
  assert.equal((await wouldExceedTotalLimit(capDb("basic", 10), "u", "photos")).exceeded, true);
  assert.equal((await wouldExceedTotalLimit(capDb("pro", 1999), "u", "photos")).exceeded, false);
  assert.equal((await wouldExceedTotalLimit(capDb("pro", 2000), "u", "photos")).exceeded, true);
});

test("photo caps: the upgrade message points at Pro", async () => {
  const free = await wouldExceedTotalLimit(capDb("free", 10), "u", "photos");
  assert.match(limitReachedMessage(free, "photo"), /Free accounts can have 10 photos\. Upgrade to Pro/);
});

test("the POST route trusts nothing from the client: no count or limit field is read from the form", () => {
  const route = read("../app/api/job-photos/route.ts");
  assert.match(route, /wouldExceedTotalLimit\(supabase, user\.id, "photos"\)/);
  assert.doesNotMatch(route, /form\.get\("(count|total|limit|user_id|usage)"\)/);
  assert.match(route, /FREE_LIMIT_REACHED/);
});

// ------------------------------------------------------------ user scoping

test("every job_photos / jobs query in the photo routes is scoped to the signed-in user", () => {
  for (const rel of ["../app/api/job-photos/route.ts", "../app/api/job-photos/[id]/route.ts"]) {
    const src = read(rel);
    assert.match(src, /requireUser\(\)/, `${rel} requires a signed-in user`);
    // each .from("job_photos"|"jobs") call has a user_id filter within the same chain
    for (const m of src.matchAll(/\.from\("(job_photos|jobs)"\)([\s\S]*?)(?:;\n|\n\s*\n)/g)) {
      // a read/update/delete filters on user_id; an insert writes it
      const scoped = m[2].includes(".insert(") ? /user_id: user\.id/ : /\.eq\("user_id", user\.id\)/;
      assert.match(m[2], scoped, `${rel}: ${m[1]} query is not scoped to the user`);
    }
  }
  const server = read("./job-photos-server.ts");
  for (const m of server.matchAll(/\.from\("job_photos"\)([\s\S]*?);\n/g)) {
    assert.match(m[1], /\.eq\("user_id", userId\)/, "server helper query is not scoped to the user");
  }
});

test("the target job must be the user's own, on upload and on move", () => {
  for (const rel of ["../app/api/job-photos/route.ts", "../app/api/job-photos/[id]/route.ts"]) {
    const src = read(rel);
    assert.match(src, /\.from\("jobs"\)[\s\S]*?\.eq\("id", ref\.jobId\)[\s\S]*?\.eq\("user_id", user\.id\)/, rel);
    assert.match(src, /Job not found\./);
  }
});

test("storage is private: signed URLs only, never a public URL; the migration says so", () => {
  const sources = [
    read("./job-photos-server.ts"),
    read("../app/api/job-photos/route.ts"),
    read("../components/photos/photo-gallery.tsx"),
  ].join("\n");
  assert.doesNotMatch(sources, /getPublicUrl/);
  assert.match(sources, /createSignedUrls/);
  const storageSql = readFileSync(new URL("../../supabase/migrations/0063_job_photos_storage.sql", import.meta.url), "utf8");
  assert.match(storageSql, /values \('job-photos', 'job-photos', false/);
  assert.equal(PHOTO_BUCKET, "job-photos");
  for (const op of ["insert", "select", "delete"]) {
    assert.match(storageSql, new RegExp(`for ${op}[\\s\\S]*?storage\\.foldername\\(name\\)\\)\\[1\\] = auth\\.uid\\(\\)::text`));
  }
});

test("the original file is never uploaded: only the re-encoded blobs go in the form", () => {
  const dialog = read("../components/photos/add-photos-dialog.tsx");
  assert.match(dialog, /preparePhoto\(item\.file\)/);
  assert.match(dialog, /form\.set\("photo", photo,/);
  assert.match(dialog, /form\.set\("thumb", thumb,/);
  assert.doesNotMatch(dialog, /form\.(set|append)\([^)]*item\.file/);
});

// ------------------------------------------------------------ cleanup on delete

function fakeStorage(failWith?: string) {
  const calls: { bucket: string; paths: string[] }[] = [];
  return {
    calls,
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          calls.push({ bucket, paths });
          return { error: failWith ? { message: failWith } : null };
        },
      }),
    },
  };
}

const rows = [
  { storage_path: "u1/a.jpg", thumb_path: "u1/a_thumb.jpg" },
  { storage_path: "u1/b.jpg", thumb_path: "u1/b_thumb.jpg" },
];

test("removePhotoFiles: removes the display image AND the thumbnail of every photo", async () => {
  assert.deepEqual(filePaths(rows), ["u1/a.jpg", "u1/a_thumb.jpg", "u1/b.jpg", "u1/b_thumb.jpg"]);
  const { calls, storage } = fakeStorage();
  assert.equal(await removePhotoFiles(storage, rows), true);
  assert.deepEqual(calls, [{ bucket: "job-photos", paths: filePaths(rows) }]);
});

test("removePhotoFiles: nothing to remove is a no-op; a storage error is reported, not thrown", async () => {
  const none = fakeStorage();
  assert.equal(await removePhotoFiles(none.storage, []), true);
  assert.equal(none.calls.length, 0);
  const failing = fakeStorage("boom");
  const origError = console.error;
  const logged: unknown[][] = [];
  console.error = (...a: unknown[]) => void logged.push(a);
  try {
    assert.equal(await removePhotoFiles(failing.storage, rows), false);
  } finally {
    console.error = origError;
  }
  assert.ok(!JSON.stringify(logged).includes("u1/"), "the log never contains a path (which starts with the user id)");
});

// A tiny recording stand-in for the Supabase query builder.
function fakeDb(existing: { id: string; storage_path: string; thumb_path: string } | null, events: string[]) {
  return {
    from(table: string) {
      assert.equal(table, "job_photos");
      return {
        select: () => {
          const filters: string[] = [];
          const chain = {
            eq: (col: string, val: string) => {
              filters.push(`${col}=${val}`);
              return chain;
            },
            maybeSingle: async () => {
              events.push(`select where ${filters.join(",")}`);
              const ok = existing && filters.includes(`id=${existing.id}`) && filters.includes("user_id=u1");
              return { data: ok ? existing : null, error: null };
            },
          };
          return chain;
        },
        delete: () => {
          const filters: string[] = [];
          const chain = {
            eq: (col: string, val: string) => {
              filters.push(`${col}=${val}`);
              return filters.length === 2 ? Promise.resolve({ error: null, ...(events.push(`delete where ${filters.join(",")}`), {}) }) : chain;
            },
          };
          return chain;
        },
      };
    },
  } as never;
}

test("deletePhoto: deletes the row, then both files, all scoped to the user", async () => {
  const events: string[] = [];
  const { calls, storage } = fakeStorage();
  const wrapped = { from: (b: string) => ({ remove: async (p: string[]) => (events.push("files removed"), storage.from(b).remove(p)) }) };
  const out = await deletePhoto(
    fakeDb({ id: "p1", storage_path: "u1/p1.jpg", thumb_path: "u1/p1_thumb.jpg" }, events),
    wrapped,
    "u1",
    "p1",
  );
  assert.deepEqual(out, { filesRemoved: true });
  assert.deepEqual(events, ["select where id=p1,user_id=u1", "delete where id=p1,user_id=u1", "files removed"]);
  assert.deepEqual(calls[0].paths, ["u1/p1.jpg", "u1/p1_thumb.jpg"]);
});

test("deletePhoto: someone else's photo is not found, nothing is deleted from storage", async () => {
  const events: string[] = [];
  const { calls, storage } = fakeStorage();
  const out = await deletePhoto(
    fakeDb({ id: "p1", storage_path: "u2/p1.jpg", thumb_path: "u2/p1_thumb.jpg" }, events),
    storage,
    "u3",
    "p1",
  );
  assert.equal(out, null);
  assert.equal(calls.length, 0);
});

test("deleting a job: the photo paths are read first, the job deleted, then the files removed", () => {
  const route = read("../app/api/jobs/[id]/route.ts");
  const listAt = route.indexOf("listJobPhotoPaths(");
  const deleteAt = route.indexOf('.from("jobs").delete()');
  const removeAt = route.indexOf("removePhotoFiles(supabase.storage, photoRows)");
  assert.ok(listAt > 0 && deleteAt > listAt && removeAt > deleteAt, "list -> delete job -> remove files");
  // the blockers (hours, payments...) still run before any of it
  assert.ok(route.indexOf("jobDeleteBlocker({") < listAt);
  // and the migration cascades the rows, so there is no row left pointing at a deleted job
  assert.match(
    readFileSync(new URL("../../supabase/migrations/0063_job_photos.sql", import.meta.url), "utf8"),
    /job_id uuid references public\.jobs \(id\) on delete cascade/,
  );
});

// ------------------------------------------------------------ discoverability

test("the unsorted count reaches both navs: layout query -> shell -> sidebar and bottom nav -> badge", () => {
  const layout = read("../app/(app)/dashboard/layout.tsx");
  assert.match(layout, /from\("job_photos"\)[\s\S]*?\.eq\("user_id", user\.id\)[\s\S]*?\.is\("job_id", null\)/);
  assert.match(layout, /unsortedPhotoCount=\{unsortedPhotoCount \?\? 0\}/);
  const shell = read("../components/dashboard/dashboard-shell.tsx");
  assert.equal((shell.match(/unsortedPhotoCount=\{unsortedPhotoCount\}/g) ?? []).length, 2, "sidebar and bottom nav");
  for (const rel of ["../components/dashboard/dashboard-sidebar.tsx", "../components/dashboard/dashboard-mobile-nav.tsx"]) {
    assert.match(read(rel), /badge=\{item\.key === "photos" \? unsortedPhotoCount : 0\}/, rel);
  }
});

test("the Jobs page still links to the Unsorted photos", () => {
  assert.match(read("../app/(app)/dashboard/jobs/page.tsx"), /href="\/dashboard\/photos"/);
});

test("saving as Unsorted offers a 'View unsorted photos' link", () => {
  const dialog = read("../components/photos/add-photos-dialog.tsx");
  assert.match(dialog, /jobId === ""/);
  assert.match(dialog, /label: "View unsorted photos", onClick: \(\) => router\.push\("\/dashboard\/photos"\)/);
});

test("the Photos page has an empty state with the add buttons", () => {
  const page = read("../app/(app)/dashboard/photos/page.tsx");
  assert.match(page, /empty=\{<UnsortedEmpty/);
  const empty = read("../components/photos/unsorted-empty.tsx");
  assert.match(empty, /No unsorted photos yet/);
  assert.match(empty, /<AddPhotosButtons/);
  const dialog = read("../components/photos/add-photos-dialog.tsx");
  assert.match(dialog, /Take photo/);
  assert.match(dialog, /Choose from gallery/);
});

// ------------------------------------------------------------ bulk delete / move

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

interface MemRow {
  id: string;
  user_id: string;
  job_id: string | null;
  storage_path: string;
  thumb_path: string;
}

// An in-memory job_photos table with just the query-builder calls the server helpers make, plus a way
// to make one photo's delete fail.
function memDb(rows: MemRow[], opts: { failDeleteFor?: string[] } = {}) {
  return {
    rows,
    from(table: string) {
      assert.equal(table, "job_photos");
      return {
        select: () => {
          const f: Record<string, string> = {};
          const chain = {
            eq: (c: string, v: string) => ((f[c] = v), chain),
            maybeSingle: async () => ({
              data: rows.find((r) => Object.entries(f).every(([c, v]) => (r as unknown as Record<string, string>)[c] === v)) ?? null,
              error: null,
            }),
          };
          return chain;
        },
        delete: () => {
          const f: Record<string, string> = {};
          const chain = {
            eq: (c: string, v: string) => {
              f[c] = v;
              if (!("id" in f && "user_id" in f)) return chain;
              if (opts.failDeleteFor?.includes(f.id)) return Promise.resolve({ error: { message: "boom" } });
              const at = rows.findIndex((r) => r.id === f.id && r.user_id === f.user_id);
              if (at >= 0) rows.splice(at, 1);
              return Promise.resolve({ error: null });
            },
          };
          return chain;
        },
        update: (patch: { job_id: string | null }) => ({
          in: (_c: string, ids: string[]) => ({
            eq: (_c2: string, userId: string) => ({
              select: async () => {
                const hit = rows.filter((r) => ids.includes(r.id) && r.user_id === userId);
                hit.forEach((r) => (r.job_id = patch.job_id));
                return { data: hit.map((r) => ({ id: r.id })), error: null };
              },
            }),
          }),
        }),
      };
    },
  } as never;
}

const mem = (id: string, user = U1): MemRow => ({
  id,
  user_id: user,
  job_id: null,
  ...photoPaths(user, id),
});

test("parseIdList: 1..100 real uuids, de-duplicated; anything else is refused", () => {
  assert.deepEqual(parseIdList([ID(1), ID(2), ID(1)]), { ok: true, ids: [ID(1), ID(2)] });
  assert.equal(parseIdList([]).ok, false);
  assert.equal(parseIdList("x").ok, false);
  assert.equal(parseIdList([ID(1), "nope"]).ok, false);
  assert.equal(parseIdList([ID(1), "1; drop table job_photos"]).ok, false);
  assert.equal(parseIdList(Array.from({ length: MAX_BULK_PHOTOS + 1 }, () => ID(1))).ok, false);
});

test("bulk delete: removes every row and BOTH files of every photo, one photo at a time", async () => {
  const db = memDb([mem(ID(1)), mem(ID(2)), mem(ID(3))]);
  const { calls, storage } = fakeStorage();
  const out = await deletePhotos(db, storage, U1, [ID(1), ID(2), ID(3)]);
  assert.deepEqual(out, { deleted: [ID(1), ID(2), ID(3)], filesLeft: [], failed: [] });
  assert.equal((db as unknown as { rows: MemRow[] }).rows.length, 0, "all rows are gone");
  // one storage call per photo, each carrying the display image and the thumbnail
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((c) => c.paths), [1, 2, 3].map((n) => filePaths([photoPaths(U1, ID(n))])));
  assert.ok(calls.every((c) => c.bucket === "job-photos" && c.paths.length === 2));
});

test("bulk delete: a failure is reported and does not stop or hide the others", async () => {
  const db = memDb([mem(ID(1)), mem(ID(2)), mem(ID(3))], { failDeleteFor: [ID(2)] });
  const { calls, storage } = fakeStorage();
  const origError = console.error;
  console.error = () => {};
  let out;
  try {
    out = await deletePhotos(db, storage, U1, [ID(1), ID(2), ID(3)]);
  } finally {
    console.error = origError;
  }
  assert.deepEqual(out.deleted, [ID(1), ID(3)]);
  assert.deepEqual(out.failed, [{ id: ID(2), reason: "error" }]);
  const left = (db as unknown as { rows: MemRow[] }).rows;
  assert.deepEqual(left.map((r) => r.id), [ID(2)], "the failed photo is still there, untouched");
  assert.equal(calls.length, 2, "no file was removed for the photo whose row delete failed");
  assert.ok(!calls.flatMap((c) => c.paths).some((p) => p.includes(ID(2))));
});

test("bulk delete: files storage refused to remove are reported, not hidden", async () => {
  const db = memDb([mem(ID(1)), mem(ID(2))]);
  const { storage } = fakeStorage("storage down");
  const origError = console.error;
  console.error = () => {};
  let out;
  try {
    out = await deletePhotos(db, storage, U1, [ID(1), ID(2)]);
  } finally {
    console.error = origError;
  }
  assert.deepEqual(out.deleted, [ID(1), ID(2)], "the rows are gone");
  assert.deepEqual(out.filesLeft, [ID(1), ID(2)], "and the leftover files are called out");
  assert.deepEqual(out.failed, []);
});

test("bulk delete: someone else's photos and unknown ids are failures, and their files are never touched", async () => {
  const db = memDb([mem(ID(1), U2), mem(ID(2), U1)]);
  const { calls, storage } = fakeStorage();
  const out = await deletePhotos(db, storage, U1, [ID(1), ID(3), ID(2)]);
  assert.deepEqual(out.deleted, [ID(2)]);
  assert.deepEqual(out.failed, [
    { id: ID(1), reason: "not_found" }, // U2's photo
    { id: ID(3), reason: "not_found" }, // does not exist
  ]);
  const left = (db as unknown as { rows: MemRow[] }).rows;
  assert.deepEqual(left.map((r) => [r.id, r.user_id]), [[ID(1), U2]], "U2's row survives");
  assert.ok(calls.flatMap((c) => c.paths).every((p) => p.startsWith(`${U1}/`)), "only U1's folder was touched");
});

test("bulk move: only the user's own photos move; the rest are reported not found", async () => {
  const rows = [mem(ID(1)), mem(ID(2), U2)];
  const job = "3f2b8c1e-0a4d-4e6f-9b1a-7c5d2e8f9a01";
  const out = await movePhotos(memDb(rows), U1, [ID(1), ID(2), ID(3)], job);
  assert.deepEqual(out, { moved: [ID(1)], notFound: [ID(2), ID(3)] });
  assert.equal(rows[0].job_id, job);
  assert.equal(rows[1].job_id, null, "U2's photo did not move");
  assert.deepEqual((await movePhotos(memDb(rows), U1, [ID(1)], null)).moved, [ID(1)]);
  assert.equal(rows[0].job_id, null, "null files it back under Unsorted");
});

test("the bulk route is scoped to the user and validates the target job", () => {
  const route = read("../app/api/job-photos/bulk/route.ts");
  assert.match(route, /requireUser\(\)/);
  assert.match(route, /parseIdList\(body\.ids\)/);
  assert.match(route, /deletePhotos\(supabase, supabase\.storage, user\.id, list\.ids\)/);
  assert.match(route, /movePhotos\(supabase, user\.id, list\.ids, ref\.jobId\)/);
  assert.match(route, /\.from\("jobs"\)[\s\S]*?\.eq\("id", ref\.jobId\)[\s\S]*?\.eq\("user_id", user\.id\)/);
  const server = read("./job-photos-server.ts");
  const move = server.slice(server.indexOf("export async function movePhotos"));
  assert.match(move, /\.in\("id", ids\)\s*\.eq\("user_id", userId\)/);
});

test("deleting needs the confirm dialog: every delete control only asks, and only the dialog deletes", () => {
  const gallery = read("../components/photos/photo-gallery.tsx");
  // the one place that calls the delete endpoint is performDelete, and it is wired to ConfirmDialog
  assert.equal((gallery.match(/action: "delete"/g) ?? []).length, 1);
  assert.match(gallery, /onConfirm=\{performDelete\}/);
  assert.equal((gallery.match(/performDelete/g) ?? []).length, 2, "defined once, used once (as the dialog's onConfirm)");
  // the thumbnail trash, bulk Delete and the viewer's Delete all go through askDelete (which only opens the dialog)
  assert.match(gallery, /aria-label="Delete photo"\s*onClick=\{\(\) => askDelete\(\[p\.id\]\)\}/);
  assert.match(gallery, /onClick=\{\(\) => askDelete\(\[\.\.\.selected\]\)\}/);
  assert.match(gallery, /onRequestDelete=\{\(\) => \{[\s\S]*?askDelete\(\[photos\[at\]\.id\], at\)/);
  assert.match(gallery, /onClick=\{onRequestDelete\}/);
  // the dialog copy
  assert.match(gallery, /"Delete this photo\?"/);
  assert.match(gallery, /"This can't be undone\."/);
  assert.match(gallery, /Delete \$\{plural\(confirm\.ids\.length\)\}\?/);
  assert.match(gallery, /import \{ ConfirmDialog \}/);
});

test("the thumbnail trash is always visible (not hover-only) and select mode has Select all / Delete / Move", () => {
  const gallery = read("../components/photos/photo-gallery.tsx");
  const trash = gallery.slice(gallery.indexOf('aria-label="Delete photo"'));
  const classes = trash.slice(0, trash.indexOf("</button>"));
  assert.doesNotMatch(classes, /opacity-0|hidden|group-hover|invisible/);
  assert.match(gallery, /Select all \(\$\{photos\.length\}\)/);
  assert.match(gallery, /Move to job\.\.\./);
  assert.match(gallery, /Delete\{selected\.size > 0/);
});

test("after a delete the grid updates in place, the nav catches up and the toast counts", () => {
  const gallery = read("../components/photos/photo-gallery.tsx");
  assert.match(gallery, /removeLocal\(deleted\)/);
  assert.match(gallery, /router\.refresh\(\)/);
  assert.match(gallery, /toast\.success\(`Deleted \$\{plural\(deleted\.length\)\}`\)/);
  assert.match(gallery, /toast\.warning\(/, "leftover files are surfaced");
  assert.match(gallery, /toast\.error\(`\$\{plural\(notDeleted\.length\)\} couldn't be deleted/, "failures are surfaced");
});
