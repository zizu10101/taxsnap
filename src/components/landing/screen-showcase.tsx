"use client";

import { useEffect, useRef, useState } from "react";
import { PhoneMockup } from "@/components/landing/phone-mockup";
import { LaptopMockup } from "@/components/landing/laptop-mockup";
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
// carousel driven by vertical scroll.
//
// preventDefault only fires while there's still another screen in that
// direction, so hovering here never traps the page scroll - reach the
// first/last screen and the next wheel tick just scrolls the page like
// normal. A native (non-React) wheel listener is required for
// preventDefault to actually take effect: React attaches onWheel as a
// passive listener by default, which silently no-ops preventDefault().
export function ScreenShowcase({ groups }: { groups: ShowcaseGroup[] }) {
  const [view, setView] = useState<View>("mobile");
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const lockRef = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);

  const flat = groups.flatMap((g) => g.screens.map((s) => ({ ...s, groupLabel: g.label })));
  const flatLength = flat.length;

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    function onWheel(e: WheelEvent) {
      const goingForward = e.deltaY > 0;
      const hasMore = goingForward ? indexRef.current < flatLength - 1 : indexRef.current > 0;
      if (!hasMore || lockRef.current) return;

      e.preventDefault();
      lockRef.current = true;
      const next = indexRef.current + (goingForward ? 1 : -1);
      indexRef.current = next;
      setIndex(next);
      setTimeout(() => {
        lockRef.current = false;
      }, ADVANCE_COOLDOWN_MS);
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [flatLength]);

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

        <div className="mt-6 flex justify-center">
          <Tabs value={view} onValueChange={(v) => v && setView(v as View)}>
            <TabsList>
              <TabsTrigger value="mobile">Mobile</TabsTrigger>
              <TabsTrigger value="desktop">Desktop</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div
          ref={stageRef}
          className="mt-8 flex h-[600px] flex-col items-center justify-center overflow-hidden"
        >
          <span className="font-heading text-sm font-bold text-primary">
            {current.groupLabel}
          </span>
          <h3 className="mt-1 font-heading text-lg font-bold">{current.title}</h3>
          <p className="mx-auto mt-0.5 max-w-sm text-center text-sm text-muted-foreground">
            {current.description}
          </p>
          <div className="mt-6">
            {view === "mobile" ? (
              <PhoneMockup src={current.mobileSrc} alt={`${current.title} on mobile`} />
            ) : (
              <LaptopMockup src={current.desktopSrc} alt={`${current.title} on desktop`} />
            )}
          </div>
        </div>

        <div className="flex justify-center gap-2">
          {flat.map((screen, i) => (
            <button
              key={screen.title}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Show ${screen.title}`}
              aria-current={i === index}
              className={`h-1.5 rounded-full transition-all ${
                i === index ? "w-6 bg-primary" : "w-1.5 bg-border hover:bg-primary/40"
              }`}
            />
          ))}
        </div>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Scroll to see more
        </p>
      </div>
    </section>
  );
}
