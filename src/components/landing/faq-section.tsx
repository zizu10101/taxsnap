"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

export interface FaqItem {
  question: string;
  answer: string;
}

// Independent open/closed state per item (not a single-open-at-a-time
// accordion) - same "plain conditional render + chevron flip, no
// animation library" pattern hst-summary-card.tsx already uses for its own
// collapsible card, just one instance per question instead of one for the
// whole card.
function FaqAccordionItem({ item }: { item: FaqItem }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-border py-4 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 text-left"
      >
        <span className="font-heading text-base font-bold">{item.question}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <p className="mt-3 text-sm text-muted-foreground">{item.answer}</p>
      )}
    </div>
  );
}

// Takes its question set as a prop rather than owning fixed content - the
// homepage and /salons need different questions (Jobs vs. Commission,
// Estimates present or not - see the two landing pages' own FAQ arrays)
// even though the accordion shell itself is identical, same reasoning as
// PricingSection reading its copy from props/pricing-plans.ts instead of
// hardcoding it.
export function FaqSection({ items }: { items: FaqItem[] }) {
  return (
    <section id="faq" className="border-t border-border">
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-8">
        <h2 className="font-heading text-2xl font-bold">
          Frequently asked questions
        </h2>
        <div className="mt-6">
          {items.map((item) => (
            <FaqAccordionItem key={item.question} item={item} />
          ))}
        </div>
      </div>
    </section>
  );
}
