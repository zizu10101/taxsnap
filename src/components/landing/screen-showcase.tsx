"use client";

import { useState } from "react";

export interface ShowcaseTab {
  id: string;
  label: string;
  title: string;
  description: string;
  src: string;
}

// Feature tabs, phone frame only. The page decides which tabs exist (it
// drops one whose image file is missing), so this component never renders a
// broken image. Every image is lazy and only the active one is displayed; an
// inactive `display: none` image is never fetched, so a tab's picture loads
// the first time it is opened.
export function ScreenShowcase({ tabs }: { tabs: ShowcaseTab[] }) {
  const [activeId, setActiveId] = useState(tabs[0]?.id);

  if (tabs.length === 0) return null;
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  return (
    <section className="border-t border-border">
      <div className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-8 sm:py-16">
        <h2 className="font-heading text-2xl font-bold sm:text-3xl">See it in action</h2>
        <p className="mt-1 text-sm text-muted-foreground sm:text-base">
          Real screens from the real app.
        </p>

        <div
          role="tablist"
          aria-label="App screens"
          className="-mx-4 mt-6 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:justify-center sm:px-0"
        >
          {tabs.map((tab) => {
            const selected = tab.id === active.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`showcase-tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={`showcase-panel-${tab.id}`}
                onClick={() => setActiveId(tab.id)}
                className={`inline-flex min-h-11 shrink-0 items-center rounded-full px-5 text-sm font-medium transition-colors ${
                  selected
                    ? "bg-primary text-white"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="mt-8 flex flex-col items-center gap-6 lg:flex-row lg:justify-center lg:gap-16">
          <div className="max-w-sm text-center lg:text-left">
            <h3 className="font-heading text-xl font-bold sm:text-2xl">{active.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground sm:text-base">
              {active.description}
            </p>
          </div>

          {tabs.map((tab) => (
            <div
              key={tab.id}
              role="tabpanel"
              id={`showcase-panel-${tab.id}`}
              aria-labelledby={`showcase-tab-${tab.id}`}
              hidden={tab.id !== active.id}
              className="w-full max-w-[280px] sm:max-w-[320px]"
            >
              <div className="rounded-[2.5rem] border-[10px] border-foreground/90 bg-foreground/90 shadow-2xl">
                {/* eslint-disable-next-line @next/next/no-img-element -- fixed marketing asset, lazy-loaded */}
                <img
                  src={tab.src}
                  alt={`${tab.label} screen on a phone`}
                  loading="lazy"
                  decoding="async"
                  className="block h-auto w-full rounded-[1.9rem]"
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
