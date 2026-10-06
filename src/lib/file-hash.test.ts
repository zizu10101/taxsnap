import assert from "node:assert/strict";
import test from "node:test";
import { isSha256Hex, sha256Hex } from "./file-hash.ts";

const bytes = (...n: number[]) => new Uint8Array(n);
const file = (data: Uint8Array, name: string, type = "image/jpeg") => new File([data as BlobPart], name, { type });

test("sha256Hex matches the published SHA-256 test vector for 'abc'", async () => {
  assert.equal(
    await sha256Hex(new Blob(["abc"])),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("the same file renamed (or re-downloaded under another name) has the same hash - the hash is of the BYTES", async () => {
  const data = bytes(1, 2, 3, 4, 5, 6, 7, 8);
  const a = await sha256Hex(file(data, "receipt.jpg"));
  const b = await sha256Hex(file(data, "IMG_0042 (copy).jpg"));
  const c = await sha256Hex(file(data, "renamed.JPEG", "image/png"));
  assert.equal(a, b);
  assert.equal(a, c);
});

test("a different file - even one byte different - has a different hash", async () => {
  const a = await sha256Hex(file(bytes(1, 2, 3, 4), "a.jpg"));
  const b = await sha256Hex(file(bytes(1, 2, 3, 5), "a.jpg"));
  assert.notEqual(a, b);
});

test("the ORIGINAL file and its compressed copy hash differently - which is why the hash is taken before compression", async () => {
  const original = bytes(...Array.from({ length: 64 }, (_, i) => i));
  const compressed = original.slice(0, 40); // stand-in for the re-encoded smaller upload
  assert.notEqual(await sha256Hex(file(original, "photo.jpg")), await sha256Hex(file(compressed, "photo.jpg")));
});

test("only a fixed-size hash comes out, never anything of the file's content or size", async () => {
  const big = new Uint8Array(3 * 1024 * 1024).fill(7);
  const h = await sha256Hex(file(big, "big.jpg"));
  assert.equal(h.length, 64);
  assert.match(h, /^[0-9a-f]{64}$/);
});

test("isSha256Hex accepts exactly 64 lowercase hex characters", () => {
  assert.equal(isSha256Hex("a".repeat(64)), true);
  assert.equal(isSha256Hex("0123456789abcdef".repeat(4)), true);
  assert.equal(isSha256Hex("A".repeat(64)), false, "uppercase");
  assert.equal(isSha256Hex("a".repeat(63)), false, "too short");
  assert.equal(isSha256Hex("a".repeat(65)), false, "too long");
  assert.equal(isSha256Hex("g".repeat(64)), false, "not hex");
  assert.equal(isSha256Hex(null), false);
  assert.equal(isSha256Hex(undefined), false);
  assert.equal(isSha256Hex(12345), false);
  assert.equal(isSha256Hex(""), false);
});
