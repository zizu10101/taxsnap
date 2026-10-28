import { test } from "node:test";
import assert from "node:assert/strict";
import { organizationJsonLd } from "./seo.ts";
import { INSTAGRAM_URL, SOCIAL_LINKS, YOUTUBE_URL } from "./social.ts";

const URLS = [INSTAGRAM_URL, YOUTUBE_URL];

test("social URLs are https", () => {
  for (const url of URLS) assert.equal(new URL(url).protocol, "https:");
});

test("both URLs are in SOCIAL_LINKS with their labels", () => {
  assert.deepEqual(SOCIAL_LINKS, [
    { label: "Instagram", href: INSTAGRAM_URL },
    { label: "YouTube", href: YOUTUBE_URL },
  ]);
});

test("both URLs are in the Organization JSON-LD sameAs", () => {
  const { sameAs } = organizationJsonLd("https://www.gettaxsnap.ca");
  for (const url of URLS) assert.ok(sameAs.includes(url), `${url} missing from sameAs`);
});
