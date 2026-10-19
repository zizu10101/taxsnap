import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { AddPhotosButton } from "@/components/photos/add-photos-dialog";
import { PhotoGallery } from "@/components/photos/photo-gallery";
import { UnsortedEmpty } from "@/components/photos/unsorted-empty";

export const metadata: Metadata = {
  title: "Photos — TaxSnap",
};

// Photos > Unsorted: pictures snapped without a job. Open one and tap Move to file it under a job
// (or Delete). The photos themselves load client-side from /api/job-photos as signed URLs.
export default async function PhotosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth");

  const { data: profile } = await supabase
    .from("profiles")
    .select("business_type")
    .eq("id", user.id)
    .single();
  if (profile?.business_type === "salon") redirect("/dashboard");

  const { data: jobs } = await supabase.from("jobs").select("name").eq("is_sample", false).order("name", { ascending: true });

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 lg:max-w-none">
      <PageHeader
        backHref="/dashboard/jobs"
        backLabel="Back to jobs"
        title="Photos"
        subtitle="Unsorted: snapped without a job. Open a photo to move it to one."
        actions={<AddPhotosButton jobNames={(jobs ?? []).map((j) => j.name)} />}
      />

      <Card>
        <CardContent className="pt-4">
          <PhotoGallery jobId={null} empty={<UnsortedEmpty jobNames={(jobs ?? []).map((j) => j.name)} />} />
        </CardContent>
      </Card>
    </div>
  );
}
