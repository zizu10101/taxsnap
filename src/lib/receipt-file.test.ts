import { test } from "node:test";
import assert from "node:assert/strict";
import { isPdfContentType, isPdfPath } from "./receipt-file.ts";

test("a .pdf path is a PDF, whatever the case", () => {
  assert.equal(isPdfPath("4a3d/9f1c.pdf"), true);
  assert.equal(isPdfPath("4a3d/9f1c.PDF"), true);
  assert.equal(isPdfPath("4a3d/9f1c.Pdf"), true);
});

test("photo paths are not PDFs", () => {
  for (const p of ["u/a.jpg", "u/a.jpeg", "u/a.png", "u/a.webp", "u/a.heic", "u/a"]) {
    assert.equal(isPdfPath(p), false, p);
  }
});

test("a query string does not hide the extension", () => {
  assert.equal(isPdfPath("u/a.pdf?token=abc"), true);
  assert.equal(isPdfPath("u/a.jpg?download=a.pdf"), false);
});

test("a name that only contains pdf is not a PDF", () => {
  assert.equal(isPdfPath("u/pdf-receipt.jpg"), false);
  assert.equal(isPdfPath("u/receipt.pdf.png"), false);
});

test("missing paths are not PDFs", () => {
  assert.equal(isPdfPath(null), false);
  assert.equal(isPdfPath(undefined), false);
  assert.equal(isPdfPath(""), false);
});

test("content-type detection ignores parameters and case", () => {
  assert.equal(isPdfContentType("application/pdf"), true);
  assert.equal(isPdfContentType("Application/PDF; charset=binary"), true);
  assert.equal(isPdfContentType("image/png"), false);
  assert.equal(isPdfContentType(null), false);
});
