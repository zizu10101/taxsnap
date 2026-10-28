import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { FinalCta } from "@/components/landing/final-cta";
import { FooterFaqLink } from "@/components/landing/footer-faq-link";
import { FooterLegalLinks } from "@/components/landing/footer-legal-links";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/support";
import { LandingHeader } from "@/components/landing/landing-header";
import { availableHowToVideos } from "@/lib/how-to-videos-server";

export const metadata: Metadata = pageMetadata({
  title: "TaxSnap How-to Videos — Estimates, Invoices & Job Photos",
  description: "Short screen recordings of TaxSnap doing the everyday jobs, on a phone.",
  path: "/how-to",
});

// An index only: posters, no video elements, nothing that autoplays.
export default function HowToPage() {
  const videos = availableHowToVideos();

  return (
    <main className="flex flex-1 flex-col bg-background">
      <LandingHeader />

      <section className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8 lg:py-16">
        <h1 className="max-w-2xl font-heading text-4xl leading-[0.95] font-extrabold tracking-tight sm:text-5xl">
          How-to <span className="text-primary">Videos</span>
        </h1>
        <p className="mt-6 max-w-2xl text-base text-muted-foreground sm:text-lg">
          Short recordings of TaxSnap on a phone, doing the everyday jobs.
        </p>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-8">
          {videos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Videos are coming soon.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {videos.map((video) => (
                <Link
                  key={video.slug}
                  href={`/how-to/${video.slug}`}
                  className="group flex flex-col gap-4 rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary"
                >
                  <div className="mx-auto aspect-[780/1688] w-full max-w-[180px] overflow-hidden rounded-2xl border border-border bg-muted">
                    {video.poster && (
                      // eslint-disable-next-line @next/next/no-img-element -- fixed marketing asset, lazy-loaded
                      <img
                        src={video.poster}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div>
                    <h2 className="font-heading text-lg font-bold group-hover:text-primary">
                      {video.title}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">{video.description}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      <FinalCta />
      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        <div className="mx-auto max-w-4xl space-y-3 px-4">
          <p>
            Have questions? Reach us anytime at{" "}
            <a
              href={supportMailto()}
              className="font-medium text-foreground underline hover:text-primary"
            >
              {SUPPORT_EMAIL}
            </a>
          </p>
          <FooterFaqLink />
          <FooterLegalLinks />
          <p className="pt-2 text-muted-foreground/80">
            © {new Date().getFullYear()} TaxSnap. All rights reserved.
          </p>
        </div>
      </footer>
    </main>
  );
}
