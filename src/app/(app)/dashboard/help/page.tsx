import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ReopenSetupGuideButton } from "@/components/help/reopen-setup-guide-button";
import { availableHowToVideos } from "@/lib/how-to-videos-server";
import { HELP_GUIDE_LINKS, HELP_LEGAL_LINKS, HOW_TO_INDEX_HREF, howToHref } from "@/lib/help-links";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/support";

export const metadata: Metadata = {
  title: "Help",
};

const linkClass =
  "flex min-h-10 items-center justify-between gap-2 rounded-md px-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// Links go to the public pages (same app), in a new tab so nobody loses their place. The
// video list comes from the same source as the public /how-to page, so the two always
// match. No plan names, prices or upgrade prompts belong on this screen.
export default async function HelpPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth");

  const videos = availableHowToVideos();

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Link
        href="/dashboard"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to dashboard
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold">Help</h1>
        <p className="text-muted-foreground">Short videos, answers and a way to reach us.</p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Learn how it works</CardTitle>
            <CardDescription>These open in a new tab.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <a
              href={HOW_TO_INDEX_HREF}
              target="_blank"
              rel="noopener"
              className={`${linkClass} font-semibold`}
            >
              All how-to videos
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            </a>
            {videos.map((v) => (
              <a key={v.slug} href={howToHref(v.slug)} target="_blank" rel="noopener" className={linkClass}>
                {v.title}
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              </a>
            ))}
            {HELP_GUIDE_LINKS.map((l) => (
              <a key={l.href} href={l.href} target="_blank" rel="noopener" className={linkClass}>
                {l.label}
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              </a>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Setup guide</CardTitle>
            <CardDescription>
              Closed the getting-started checklist on your dashboard? Bring it back.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ReopenSetupGuideButton userId={user.id} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contact support</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            Questions or something not working? Email{" "}
            <a className="underline" href={supportMailto()}>
              {SUPPORT_EMAIL}
            </a>
            .
          </CardContent>
        </Card>

        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {HELP_LEGAL_LINKS.map((l) => (
            <a key={l.href} className="underline" href={l.href} target="_blank" rel="noopener">
              {l.label}
            </a>
          ))}
        </p>
      </div>
    </div>
  );
}
