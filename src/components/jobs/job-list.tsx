"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { JobCostNav } from "@/components/jobs/job-cost-nav";
import { NewJobDialog } from "@/components/jobs/new-job-dialog";
import { JobWorkstation } from "@/components/jobs/job-workstation";
import { UsageLimitBar } from "@/components/dashboard/usage-limit-bar";
import { PLAN_LIMITS } from "@/lib/plan-limits";
import type { Job, SubscriptionStatus } from "@/lib/database.types";
import type { JobCostSummary } from "@/lib/job-revenue";

export function JobList({
  initialJobs,
  subscriptionStatus,
  costSummaries,
}: {
  initialJobs: Job[];
  subscriptionStatus: SubscriptionStatus;
  costSummaries: Record<string, JobCostSummary>;
}) {
  const router = useRouter();
  const [jobs, setJobs] = useState(initialJobs);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="space-y-4">
      <JobCostNav active="jobs" />

      <UsageLimitBar
        tier={subscriptionStatus}
        current={jobs.length}
        limit={PLAN_LIMITS[subscriptionStatus].jobs}
        noun="job"
      />

      <div className="space-y-3 lg:hidden">
      <Button className="w-full" onClick={() => setDialogOpen(true)}>
        <Plus className="h-4 w-4" />
        New job
      </Button>

      {jobs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <Briefcase className="h-8 w-8" />
            <p className="text-sm">
              No jobs yet. Tag a receipt with a job name or create one here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <Card
              key={job.id}
              role="button"
              tabIndex={0}
              onClick={() => router.push(`/dashboard/jobs/${job.id}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  router.push(`/dashboard/jobs/${job.id}`);
                }
              }}
              className="cursor-pointer outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
            >
              <CardContent className="flex items-center gap-3 py-4">
                <Briefcase className="h-4 w-4 shrink-0 text-muted-foreground" />
                <p className="truncate font-medium">{job.name}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      </div>

      <div className="hidden lg:block">
        <Button className="mb-3 w-full max-w-xs" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          New job
        </Button>
        <JobWorkstation jobs={jobs} costSummaries={costSummaries} />
      </div>

      <NewJobDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={(job) => {
          setJobs((prev) => [...prev, job].sort((a, b) => a.name.localeCompare(b.name)));
          router.push(`/dashboard/jobs/${job.id}`);
        }}
      />
    </div>
  );
}
