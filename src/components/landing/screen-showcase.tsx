"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PhoneMockup } from "@/components/landing/phone-mockup";
import { BrowserMockup } from "@/components/landing/browser-mockup";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface ShowcaseScreen {
  title: string;
  description: string;
  mobileSrc: string;
  desktopSrc: string;
}

export interface ShowcaseGroup {
  label: string;
  screens: ShowcaseScreen[];
}

type View = "mobile" | "desktop";

// One physical wheel "flick" should feel like one slide change, not one
// slide per tiny trackpad delta event - this is the cooldown between
// accepted advances.
const ADVANCE_COOLDOWN_MS = 550;

// Real screenshots from the actual app (test account, real data). One
// Mobile/Desktop toggle drives every screen. A fixed-height "stage" shows
// one screen at a time instead of stacking all six down the page (that
// made the section very tall) - scrolling the wheel while hovering the
// stage advances/rewinds through the six screens, like a horizontal
// carousel driven by vertical scroll. Touch devices have no wheel events
// at all, so a horizontal swipe on the stage does the equivalent job
// there (plus the pagination dots below always work as a tap-to-jump
// fallback on either input type).
//
// preventDefault only fires while there's still another screen in that
// direction (wheel) or while the gesture is clearly a horizontal swipe
// with another screen to reveal (touch), so interacting here never traps
// the page scroll - reach the first/last screen, or swipe mostly
// vertically, and it just scrolls the page like normal. A native
// (non-React) listener is required for preventDefault to actually take
// effect: React attaches onWheel/onTouchMove as passive by default, which
// silently no-ops preventDefault().
const SWIPE_THRESHOLD_PX = 40;

export function ScreenShowcase({ groups }: { groups: ShowcaseGroup[] }) {
  const [view, setView] = useState<View>("mobile");
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const lockRef = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);

  const flat = groups.flatMap((g) => g.screens.map((s) => ({ ...s, groupLabel: g.label })));
  const flatLength = flat.length;

  const advance = useCallback(
    (goingForward: boolean) => {
      const hasMore = goingForward ? indexRef.current < flatLength - 1 : indexRef.current > 0;
      if (!hasMore || lockRef.current) return false;

      lockRef.current = true;
      const next = indexRef.current + (goingForward ? 1 : -1);
      indexRef.current = next;
      setIndex(next);
      setTimeout(() => {
        lockRef.current = false;
      }, ADVANCE_COOLDOWN_MS);
      return true;
    },
    [flatLength],
  );

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    function onWheel(e: WheelEvent) {
      if (advance(e.deltaY > 0)) e.preventDefault();
    }

    let touchStart: { x: number; y: number } | null = null;
    let touchHandled = false;

    function onTouchStart(e: TouchEvent) {
      const t = e.touches[0];
      touchStart = { x: t.clientX, y: t.clientY };
      touchHandled = false;
    }

    function onTouchMove(e: TouchEvent) {
      if (!touchStart || touchHandled) return;
      const t = e.touches[0];
      const dx = t.clientX - touchStart.x;
      const dy = t.clientY - touchStart.y;
      // Only claim the gesture once it's clearly a horizontal swipe past a
      // small threshold - anything more vertical (or too small) falls
      // through to normal page scroll instead.
      if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) < Math.abs(dy)) return;

      if (advance(dx < 0)) {
        e.preventDefault();
        touchHandled = true;
      }
    }

    function onTouchEnd() {
      touchStart = null;
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [advance]);

  function goTo(i: number) {
    indexRef.current = i;
    setIndex(i);
  }

  const current = flat[index];

  return (
    <section className="border-t border-border">
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-8">
        <h2 className="font-heading text-2xl font-bold">See it in action</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Real screens from the real app - on your phone and on your computer.
        </p>

        <div className="mt-4 flex justify-center">
          <Tabs value={view} onValueChange={(v) => v && setView(v as View)}>
            <TabsList>
              <TabsTrigger value="mobile">Mobile</TabsTrigger>
              <TabsTrigger value="desktop">Desktop</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div
          ref={stageRef}
          className="mt-4 flex h-[640px] flex-col items-center overflow-hidden"
        >
          <div className="shrink-0 text-center">
            <span className="font-heading text-sm font-bold text-primary">
              {current.groupLabel}
            </span>
            <h3 className="mt-0.5 font-heading text-lg font-bold">{current.title}</h3>
            <p className="mx-auto mt-0.5 max-w-sm text-center text-sm text-muted-foreground">
              {current.description}
            </p>
          </div>
          <div className="mt-3 flex min-h-0 flex-1 items-center justify-center">
            {view === "mobile" ? (
              <PhoneMockup src={current.mobileSrc} alt={`${current.title} on mobile`} />
            ) : (
              <BrowserMockup src={current.desktopSrc} alt={`${current.title} on desktop`} />
            )}
          </div>
        </div>

        <div className="mt-5 flex justify-center gap-2">
          {flat.map((screen, i) => (
            <button
              key={screen.title}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Show ${screen.title}`}
              aria-current={i === index}
              className="-m-2 p-2"
            >
              <span
                className={`block h-1.5 rounded-full transition-all ${
                  i === index ? "w-6 bg-primary" : "w-1.5 bg-border hover:bg-primary/40"
                }`}
              />
            </button>
          ))}
        </div>
        <p className="mt-1 text-center text-xs text-muted-foreground">
          Scroll or swipe to see more
        </p>
      </div>
    </section>
  );
}
