import Link from "next/link";
import { ChevronDown } from "lucide-react";

export interface FaqItem {
  question: string;
  answer: string;
  /** A how-to video that shows the answer. */
  link?: { href: string; label: string };
}

// Independent open/closed state per item (not a single-open-at-a-time
// accordion). A native <details> keeps every answer in the server-rendered HTML
// - crawlers and AI engines read it without running JavaScript - while it still
// collapses for visitors. The question is the heading inside <summary>.
function FaqAccordionItem({ item }: { item: FaqItem }) {
  return (
    <details className="group border-b border-border py-4 last:border-b-0">
      <summary className="flex w-full cursor-pointer list-none items-center justify-between gap-4 text-left [&::-webkit-details-marker]:hidden">
        <h3 className="font-heading text-base font-bold">{item.question}</h3>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-3 space-y-2 text-sm text-muted-foreground">
        <p>{item.answer}</p>
        {item.link && (
          <Link
            href={item.link.href}
            className="inline-block font-medium text-primary underline-offset-4 hover:underline"
          >
            {item.link.label}
          </Link>
        )}
      </div>
    </details>
  );
}

// Takes its question set as a prop rather than owning fixed content - the
// homepage and /salons need different questions (Jobs vs. Commission,
// Estimates present or not - see the two landing pages' own FAQ arrays)
// even though the accordion shell itself is identical, same reasoning as
// PricingSection reading its copy from props/pricing-plans.ts instead of
// hardcoding it.
export function FaqSection({
  items,
  seeAllHref,
}: {
  items: FaqItem[];
  seeAllHref?: string;
}) {
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
        {seeAllHref && (
          <Link
            href={seeAllHref}
            className="mt-4 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            See all questions
          </Link>
        )}
      </div>
    </section>
  );
}
