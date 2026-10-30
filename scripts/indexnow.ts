// Tells IndexNow-enabled search engines (Bing and others) that our pages exist or changed.
// Reads every URL from the live sitemap and POSTs them in one request.
//
// Run by hand after a deploy: node scripts/indexnow.ts
// The key file public/<key>.txt must already be live at KEY_LOCATION.

const KEY = "d3c203e231db045487ea8e7443abb6b8";
const HOST = "www.gettaxsnap.ca";
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const SITEMAP_URL = `https://${HOST}/sitemap.xml`;
const ENDPOINT = "https://api.indexnow.org/indexnow";

async function main() {
  const sitemapRes = await fetch(SITEMAP_URL);
  if (!sitemapRes.ok) throw new Error(`Sitemap fetch failed: ${sitemapRes.status}`);
  const xml = await sitemapRes.text();

  const urlList = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  if (urlList.length === 0) throw new Error("No <loc> entries found in the sitemap");

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList }),
  });

  console.log(`Submitted ${urlList.length} URLs. IndexNow answered ${res.status} ${res.statusText}`);
  if (!res.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
