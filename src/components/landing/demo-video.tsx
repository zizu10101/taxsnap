"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Play } from "lucide-react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(callback: () => void) {
  const mql = window.matchMedia(REDUCED_MOTION_QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}
const getReducedMotion = () => window.matchMedia(REDUCED_MOTION_QUERY).matches;
// Server and first paint assume motion is fine; the real value swaps in after hydration.
const getServerReducedMotion = () => false;

/**
 * A muted, looping demo clip that costs nothing until it is on screen:
 * preload="none" (only the poster is fetched), played when scrolled into view
 * and paused when it leaves. With prefers-reduced-motion it never starts on its
 * own: the poster stays with a play button, and the viewer chooses to play.
 * No audio, ever. Sizing: fills its parent's width at the recording's 780x1688
 * aspect ratio, so a parent phone frame can wrap it.
 */
export function DemoVideo({
  mp4,
  poster,
  label,
}: {
  mp4: string;
  poster?: string;
  /** Describes the clip for screen readers. */
  label: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotion,
    getServerReducedMotion,
  );
  // Reduced motion: stays false until the viewer presses play.
  const [userStarted, setUserStarted] = useState(false);
  const allowed = !reducedMotion || userStarted;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !allowed) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // play() rejects if the browser blocks it or the source is gone; the poster just stays.
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(video);
    return () => {
      observer.disconnect();
      video.pause();
    };
  }, [allowed]);

  return (
    <div className="relative aspect-[780/1688] w-full bg-muted">
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        muted
        loop
        playsInline
        preload="none"
        poster={poster}
        aria-label={label}
        disablePictureInPicture
      >
        <source src={mp4} type="video/mp4" />
      </video>
      {reducedMotion && !userStarted && (
        <button
          type="button"
          onClick={() => setUserStarted(true)}
          aria-label={`Play video: ${label}`}
          className="absolute inset-0 flex items-center justify-center bg-black/20"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-[#c2410c] shadow-lg">
            <Play className="ml-0.5 h-6 w-6" fill="currentColor" />
          </span>
        </button>
      )}
    </div>
  );
}
