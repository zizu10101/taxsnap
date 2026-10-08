// Pure routing decision for public/sw.js, kept in its own file so it can be
// unit-tested in Node without a browser (src/lib/sw-routing.test.ts). The
// worker loads it with importScripts(); Node loads it with require().
//
// Why this exists: Next's client-side navigation and router.refresh() fetch
// the page's data with a plain fetch() - request.mode is "cors", NOT
// "navigate" - so a rule keyed on mode === "navigate" never matched them and
// they fell through to the cache-first branch, serving a stale copy of the
// page after every save. Those requests are recognised here by what Next
// itself puts on them, and are never cached.
(function (root) {
  // Headers Next sets on its own router fetches (RSC payloads and prefetches).
  var ROUTER_HEADERS = [
    "rsc",
    "next-router-state-tree",
    "next-router-prefetch",
    "next-router-segment-prefetch",
  ];

  // Same-origin paths that are static, content-hashed or otherwise safe to
  // serve from cache.
  var CACHEABLE_PREFIXES = ["/_next/static/", "/_next/image", "/icons/"];
  var CACHEABLE_FILES = ["/manifest.json", "/logo-mark.png"];
  var CACHEABLE_DESTINATIONS = ["script", "style", "font", "image", "manifest"];

  /**
   * @param {{method: string, url: string, mode?: string, destination?: string,
   *          headers: {get(name: string): string | null}}} req
   * @param {string} origin the worker's own origin (self.location.origin)
   * @returns {"bypass" | "network-only" | "network-first" | "cache"}
   *   bypass:        don't intercept; the browser handles it as if no worker existed
   *   network-only:  fetch fresh, never read or write the cache
   *   network-first: network, cache only as an offline fallback (page loads)
   *   cache:         static asset, cache-first with background refresh
   */
  function decideFetchStrategy(req, origin) {
    if (req.method !== "GET") return "bypass";

    var url = new URL(req.url);

    // Cross-origin (Supabase REST/Storage, fonts CDNs): signed URLs and query
    // results change under the same URL, so they must never be cached here.
    if (url.origin !== origin) return "bypass";

    if (url.pathname.indexOf("/api/") === 0) return "bypass";

    // Next router data: never cached, wherever the request came from.
    if (url.searchParams.has("_rsc")) return "network-only";
    if (url.pathname.indexOf("/_next/data/") === 0) return "network-only";
    for (var i = 0; i < ROUTER_HEADERS.length; i++) {
      if (req.headers.get(ROUTER_HEADERS[i]) !== null) return "network-only";
    }

    if (req.mode === "navigate") return "network-first";

    for (var p = 0; p < CACHEABLE_PREFIXES.length; p++) {
      if (url.pathname.indexOf(CACHEABLE_PREFIXES[p]) === 0) return "cache";
    }
    if (CACHEABLE_FILES.indexOf(url.pathname) !== -1) return "cache";
    if (CACHEABLE_DESTINATIONS.indexOf(req.destination || "") !== -1) return "cache";

    // Anything else (an unknown same-origin GET) is not assumed to be static.
    return "network-only";
  }

  var api = { decideFetchStrategy: decideFetchStrategy };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TaxSnapSwRouting = api;
})(typeof self !== "undefined" ? self : globalThis);
