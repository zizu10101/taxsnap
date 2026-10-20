import type { ReactNode } from "react";
import Link from "next/link";
import { LandingHeader } from "@/components/landing/landing-header";

// Shared shell for /terms and /privacy: the public marketing header, a readable column, a footer.
export function LegalPage({
  title,
  version,
  updated,
  children,
}: {
  title: string;
  version: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <main className="flex flex-1 flex-col bg-background">
      <LandingHeader />
      <article className="mx-auto w-full max-w-3xl space-y-6 px-4 py-10 text-sm leading-relaxed text-muted-foreground">
        <header className="space-y-2">
          <h1 className="font-heading text-3xl font-bold text-foreground">{title}</h1>
          <p>
            Last updated: {updated} (version {version})
          </p>
          <p className="rounded-md border border-border bg-muted/40 p-3 text-xs">
            Draft. This page is being reviewed and may change before it takes effect. It is not legal advice.
          </p>
        </header>
        {children}
      </article>
      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        <div className="mx-auto max-w-3xl space-y-2 px-4">
          <p className="space-x-4">
            <Link href="/terms" className="underline hover:text-primary">
              Terms of Service
            </Link>
            <Link href="/privacy" className="underline hover:text-primary">
              Privacy Policy
            </Link>
          </p>
          <p>© {new Date().getFullYear()} Edge Digital Business Solutions. All rights reserved.</p>
        </div>
      </footer>
    </main>
  );
}

export function LegalSection({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-2">
      <h2 className="font-heading text-xl font-bold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
