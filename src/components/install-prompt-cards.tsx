"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Share, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandaloneDisplay() {
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    nav.standalone === true
  );
}

function isIOSDevice() {
  const ua = navigator.userAgent;
  const isAppleTouch =
    navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /iphone|ipad|ipod/i.test(ua) || isAppleTouch;
}

function subscribeToDisplayMode(callback: () => void) {
  const mql = window.matchMedia("(display-mode: standalone)");
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function noSubscription() {
  return () => {};
}

function getServerFalse() {
  return false;
}

export function InstallPromptCards() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [justInstalled, setJustInstalled] = useState(false);

  const isStandalone = useSyncExternalStore(
    subscribeToDisplayMode,
    isStandaloneDisplay,
    getServerFalse,
  );
  const isIOS = useSyncExternalStore(
    noSubscription,
    isIOSDevice,
    getServerFalse,
  );

  useEffect(() => {
    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    function onAppInstalled() {
      setJustInstalled(true);
      setDeferredPrompt(null);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  async function handleAndroidInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (outcome === "accepted") toast.success("TaxSnap installed!");
  }

  if (isStandalone || justInstalled) return null;

  return (
    <section className="border-t border-border">
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-8">
        <h2 className="font-heading text-2xl font-bold">
          Install TaxSnap on your phone
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          No app store needed - it installs straight from this page.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
            <img src="/logo-mark.png" alt="" className="h-10 w-10" />
            <h3 className="font-heading text-lg font-bold">
              iPhone &amp; iPad
            </h3>
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <Share className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              In Safari, tap the Share icon, then &quot;Add to Home
              Screen&quot;.
            </p>
          </div>
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
            <img src="/logo-mark.png" alt="" className="h-10 w-10" />
            <h3 className="font-heading text-lg font-bold">Android</h3>
            {deferredPrompt ? (
              <Button onClick={handleAndroidInstall} className="mt-1 self-start">
                Install Now
              </Button>
            ) : (
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                Open this page in Chrome, then tap Install when prompted.
              </p>
            )}
          </div>
        </div>
        {isIOS && (
          <p className="mt-4 text-xs text-muted-foreground">
            Tip: the Share icon is in Safari&apos;s toolbar - look for the
            square with an arrow pointing up.
          </p>
        )}
      </div>
    </section>
  );
}
