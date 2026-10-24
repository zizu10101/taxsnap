import { test } from "node:test";
import assert from "node:assert/strict";
import { HELP_GUIDE_LINKS, HELP_LEGAL_LINKS, HELP_PATH, HOW_TO_INDEX_HREF, howToHref } from "./help-links.ts";
import { SUPPORT_EMAIL, supportMailto } from "./support.ts";

test("how-to links point at the public /how-to pages", () => {
  assert.equal(HOW_TO_INDEX_HREF, "/how-to");
  assert.equal(howToHref("job-photos"), "/how-to/job-photos");
});

test("guide and legal links are in-app paths to existing public pages", () => {
  const hrefs = [...HELP_GUIDE_LINKS, ...HELP_LEGAL_LINKS].map((l) => l.href);
  assert.deepEqual(hrefs, ["/faq", "/features", "/terms", "/privacy"]);
  assert.equal(HELP_PATH, "/dashboard/help");
});

test("support email comes from one constant and builds a mailto link", () => {
  assert.match(SUPPORT_EMAIL, /^[^@\s]+@[^@\s]+\.[^@\s]+$/);
  assert.equal(supportMailto(), `mailto:${SUPPORT_EMAIL}`);
  assert.equal(supportMailto("a@b.co"), "mailto:a@b.co");
});

test("the Help copy has no plan names, prices or upgrade prompts", () => {
  const text = [...HELP_GUIDE_LINKS, ...HELP_LEGAL_LINKS].map((l) => l.label).join(" ");
  assert.ok(!/\b(pro|free|plan|upgrade|price|\$)\b/i.test(text));
});
