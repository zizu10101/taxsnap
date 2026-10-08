"use client";

import { useEffect } from "react";

// Prefix of every cache public/sw.js creates ("taxsnap-shell-v2"). Used to
// clean up only our own caches - other apps may share this origin in dev.
const CACHE_PREFIX = "taxsnap-";

export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Development: never run a service worker. sw.js serves JS/CSS/fonts
    // cache-first, which in dev means the browser can keep showing an old
    // copy of a component after the code (or the git branch) changed - the
    // dev server's fresh output is never even asked for. Also tear down any
    // worker + caches an earlier dev session (or an older version of this
    // component) already installed, so a stale one can't keep controlling
    // the page. Takes effect on the next load after the first one.
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
        .catch(() => {});
      if ("caches" in window) {
        caches
          .keys()
          .then((keys) =>
            Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX)).map((k) => caches.delete(k))),
          )
          .catch(() => {});
      }
      return;
    }

    // updateViaCache "none": the browser re-fetches sw.js AND the script it
    // importScripts() (sw-routing.js) from the network on every update check,
    // never from the HTTP cache, so a routing fix can't be held back by it.
    let registration: ServiceWorkerRegistration | undefined;
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((reg) => {
        registration = reg;
      })
      .catch(() => {
        // Non-fatal: the app still works without offline support.
      });

    // An installed PWA can stay open for days without a full page load, and
    // browsers otherwise only look for a new worker on navigation or every
    // 24h. Check whenever the app comes back to the foreground, so a fixed
    // worker replaces the old one promptly (the new one skipWaiting()s and
    // clients.claim()s itself).
    const checkForUpdate = () => {
      if (document.visibilityState === "visible") registration?.update().catch(() => {});
    };
    document.addEventListener("visibilitychange", checkForUpdate);
    return () => document.removeEventListener("visibilitychange", checkForUpdate);
  }, []);

  return null;
}
