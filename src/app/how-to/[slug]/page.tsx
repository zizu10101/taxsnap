import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { DemoVideo } from "@/components/landing/demo-video";
import { FinalCta } from "@/components/landing/final-cta";
import { FooterFaqLink } from "@/components/landing/footer-faq-link";
import { LandingHeader } from "@/components/landing/landing-header";
import { PhoneFrame } from "@/components/landing/phone-frame";
import { featurePageForVideo } from "@/lib/feature-pages";
import { availableHowToVideos } from "@/lib/how-to-videos-server";

// Only the listed slugs exist; anything else is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return availableHowToVideos().map((video) => ({ slug: video.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const video = availableHowToVideos().find((v) => v.slug === slug);
  if (!video) return {};
  const url = `/how-to/${video.slug}`;
  return {
    title: `${video.title} — TaxSnap How-to`,
    description: video.description,
    alternates: { canonical: url },
    openGraph: {
      title: video.title,
      description: video.description,
      url,
      type: "website",
      ...(video.poster ? { images: [{ url: video.poster }] } : {}),
    },
  };
}

export default async function HowToVideoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const videos = availableHowToVideos();
  const index = videos.findIndex((v) => v.slug === slug);
  if (index === -1) notFound();

  const video = videos[index];
  const feature = featurePageForVideo(video.slug);
  const next = videos.length > 1 ? videos[(index + 1) % videos.length] : null;

  return (
    <main className="flex flex-1 flex-col bg-background">
      <LandingHeader />

      <section className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8 lg:py-14">
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,340px)_1fr] lg:gap-16">
          <div className="mx-auto w-full max-w-[300px] lg:max-w-none">
            <PhoneFrame>
              <DemoVideo mp4={video.mp4} poster={video.poster} label={video.title} />
            </PhoneFrame>
          </div>

          <div>
            <h1 className="font-heading text-3xl leading-[1] font-extrabold tracking-tight sm:text-4xl">
              {video.title}
            </h1>
            <p className="mt-4 text-base text-muted-foreground sm:text-lg">{video.description}</p>
            {video.planNote && (
              <p className="mt-2 text-sm font-medium text-primary">{video.planNote}</p>
            )}

            <h2 className="mt-8 font-heading text-xl font-bold">Steps</h2>
            <ol className="mt-3 space-y-3">
              {video.steps.map((step, i) => (
                <li key={step} className="flex gap-3 text-sm sm:text-base">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-xs text-white">
                    {i + 1}
                  </span>
                  <span className="pt-0.5">{step}</span>
                </li>
              ))}
            </ol>

            <div className="mt-10 flex flex-col gap-3 text-sm font-medium">
              {feature && (
                <Link
                  href={feature.href}
                  className="inline-flex items-center gap-2 text-primary underline-offset-4 hover:underline"
                >
                  Learn more about this feature: {feature.title}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              )}
              {next && (
                <Link
                  href={`/how-to/${next.slug}`}
                  className="inline-flex items-center gap-2 text-primary underline-offset-4 hover:underline"
                >
                  Next video: {next.title}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              )}
              <Link
                href="/how-to"
                className="inline-flex items-center gap-2 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to all how-to videos
              </Link>
            </div>
          </div>
        </div>
      </section>

      <FinalCta />
      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        <div className="mx-auto max-w-4xl space-y-3 px-4">
          <p>
            Have questions? Reach us anytime at{" "}
            <a
              href="mailto:info@gettaxsnap.ca"
              className="font-medium text-foreground underline hover:text-primary"
            >
              info@gettaxsnap.ca
            </a>
          </p>
          <FooterFaqLink />
          <p className="pt-2 text-muted-foreground/80">
            © {new Date().getFullYear()} TaxSnap. All rights reserved.
          </p>
        </div>
      </footer>
    </main>
  );
}
