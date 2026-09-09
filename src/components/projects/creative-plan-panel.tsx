"use client";

import { useCallback, useEffect, useState } from "react";
import { Clapperboard, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type DirectorAvailability = {
  productionAvailable: boolean;
  localDevAvailable: boolean;
  canCompose: boolean;
  canGenerate?: boolean;
  emailVerified?: boolean;
  generationDenyCode?: string | null;
};

type CreativePlanView = {
  id: string;
  version: number;
  status: string;
  plan: {
    schemaVersion: string;
    concept?: string;
    objective?: string;
    tone?: string;
    emotionalArc?: string;
    narrativeApproach?: string;
    pacing?: string;
    visualDirection?: string;
    musicDirection?: string;
    voiceDirection?: string;
    mediaStrategy?: string;
    constraints?: string[];
    decisions?: Array<{ kind: string; subject?: string; summary: string }>;
    rationale?: string;
  };
  jobId: string | null;
  inputFingerprint: string;
  providerKey: string;
  capability: string;
  modelId: string | null;
  createdAt: string;
};

type JobStatusView = {
  jobId: string;
  status: string;
  error: string | null;
  creativePlanId: string | null;
  version: number | null;
};

function jobLabel(status: string) {
  switch (status) {
    case "PENDING":
      return "Queued";
    case "RUNNING":
      return "Composing";
    case "SUCCEEDED":
      return "Ready";
    case "FAILED":
      return "Failed";
    default:
      return status;
  }
}

export function CreativePlanPanel({
  projectId,
  initialPlan,
  initialAvailability,
}: {
  projectId: string;
  initialPlan: CreativePlanView | null;
  initialAvailability: DirectorAvailability;
}) {
  const [availability, setAvailability] = useState(initialAvailability);
  const [plan, setPlan] = useState<CreativePlanView | null>(initialPlan);
  const [job, setJob] = useState<JobStatusView | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshPlan = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}/director/plan`);
    const payload = (await response.json()) as {
      plan?: CreativePlanView | null;
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new Error(payload.error?.message || "Could not load the creative plan.");
    }
    setPlan(payload.plan ?? null);
  }, [projectId]);

  const refreshAvailability = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}/director/compose`);
    const payload = (await response.json()) as DirectorAvailability & {
      error?: { message?: string };
    };
    if (!response.ok) {
      return;
    }
    setAvailability({
      productionAvailable: payload.productionAvailable,
      localDevAvailable: payload.localDevAvailable,
      canCompose: payload.canCompose,
      canGenerate: payload.canGenerate,
      emailVerified: payload.emailVerified,
      generationDenyCode: payload.generationDenyCode,
    });
  }, [projectId]);

  useEffect(() => {
    if (!job || job.status === "SUCCEEDED" || job.status === "FAILED") {
      return;
    }
    const timer = window.setInterval(() => {
      void (async () => {
        const response = await fetch(
          `/api/projects/${projectId}/director/jobs/${job.jobId}`,
        );
        const payload = (await response.json()) as JobStatusView & {
          error?: { message?: string };
        };
        if (!response.ok) {
          return;
        }
        setJob(payload);
        if (payload.status === "SUCCEEDED") {
          await refreshPlan();
          toast.success("Creative plan is ready.");
        }
        if (payload.status === "FAILED") {
          toast.error(payload.error || "Director composition failed.");
        }
      })();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [job, projectId, refreshPlan]);

  async function compose() {
    setBusy(true);
    try {
      await refreshAvailability();
      const response = await fetch(`/api/projects/${projectId}/director/compose`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        jobId?: string;
        status?: string;
        error?: { message?: string; code?: string };
      };
      if (!response.ok || !payload.jobId) {
        throw new Error(payload.error?.message || "Could not enqueue Director composition.");
      }
      setJob({
        jobId: payload.jobId,
        status: payload.status ?? "PENDING",
        error: null,
        creativePlanId: null,
        version: null,
      });
      toast.message("Director composition queued.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Compose failed.");
    } finally {
      setBusy(false);
    }
  }

  const composing = job?.status === "PENDING" || job?.status === "RUNNING";
  const emailVerified = availability.emailVerified !== false;
  const canGenerate = availability.canGenerate ?? (availability.canCompose && emailVerified);
  const canStart = canGenerate && !busy && !composing;

  return (
    <Card className="mt-10">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="font-heading text-xl">Creative plan</CardTitle>
            <CardDescription className="mt-1.5">
              Meaning-level Director output for this project. Not a story structure, timeline, or
              render.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {availability.productionAvailable ? (
              <Badge>Production Director</Badge>
            ) : availability.localDevAvailable ? (
              <Badge variant="outline">Local / test only</Badge>
            ) : (
              <Badge variant="outline">Director unavailable</Badge>
            )}
            {job ? <Badge variant="secondary">{jobLabel(job.status)}</Badge> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {!emailVerified ? (
          <p className="text-sm text-muted-foreground">
            Verify your email before composing a creative plan. Generation stays locked until
            that address is confirmed.
          </p>
        ) : !availability.canCompose ? (
          <p className="text-sm text-muted-foreground">
            Production Director AI is not configured. Local technical analysis does not count as
            Director availability. Configure a genuine Director adapter, or enable{" "}
            <code className="text-xs">DIRECTOR_ALLOW_LOCAL</code> for explicit local development
            only.
          </p>
        ) : !availability.productionAvailable && availability.localDevAvailable ? (
          <p className="text-sm text-muted-foreground">
            Using the local deterministic Director for development. This is not production AI and
            must not be treated as a commercial Director.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Request a composition to enqueue an <code className="text-xs">AI_DIRECT</code> job. The
            worker validates and persists a versioned CreativePlan.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={!canStart}
            onClick={() => void compose()}
          >
            {busy || composing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Clapperboard className="size-4" />
            )}
            {plan ? "Recompose" : "Compose creative plan"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              void refreshPlan().catch((error: unknown) => {
                toast.error(error instanceof Error ? error.message : "Refresh failed.");
              });
            }}
          >
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        </div>

        {job?.status === "FAILED" ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
            <p className="font-medium text-destructive">Composition failed</p>
            <p className="mt-1 text-muted-foreground">{job.error || "Unknown error."}</p>
          </div>
        ) : null}

        {plan ? (
          <div className="space-y-4 rounded-lg border border-border/70 bg-muted/20 p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Version {plan.version}</span>
              <span>·</span>
              <span>{plan.status}</span>
              <span>·</span>
              <span className="font-mono">{plan.inputFingerprint.slice(0, 12)}…</span>
              {plan.jobId ? (
                <>
                  <span>·</span>
                  <span className="font-mono">job {plan.jobId.slice(0, 8)}</span>
                </>
              ) : null}
            </div>
            {plan.plan.concept ? (
              <div>
                <p className="text-xs tracking-widest text-muted-foreground uppercase">Concept</p>
                <p className="mt-1 text-sm">{plan.plan.concept}</p>
              </div>
            ) : null}
            {plan.plan.tone ? (
              <div>
                <p className="text-xs tracking-widest text-muted-foreground uppercase">Tone</p>
                <p className="mt-1 text-sm">{plan.plan.tone}</p>
              </div>
            ) : null}
            {plan.plan.emotionalArc ? (
              <div>
                <p className="text-xs tracking-widest text-muted-foreground uppercase">
                  Emotional arc
                </p>
                <p className="mt-1 text-sm">{plan.plan.emotionalArc}</p>
              </div>
            ) : null}
            {plan.plan.mediaStrategy ? (
              <div>
                <p className="text-xs tracking-widest text-muted-foreground uppercase">
                  Media strategy
                </p>
                <p className="mt-1 text-sm">{plan.plan.mediaStrategy}</p>
              </div>
            ) : null}
            {plan.plan.rationale ? (
              <div>
                <p className="text-xs tracking-widest text-muted-foreground uppercase">Rationale</p>
                <p className="mt-1 text-sm">{plan.plan.rationale}</p>
              </div>
            ) : null}
            {plan.plan.decisions && plan.plan.decisions.length > 0 ? (
              <div>
                <p className="text-xs tracking-widest text-muted-foreground uppercase">Decisions</p>
                <ul className="mt-2 space-y-2">
                  {plan.plan.decisions.map((decision, index) => (
                    <li key={`${decision.kind}-${index}`} className="text-sm">
                      <span className="font-medium">{decision.kind}</span>
                      <span className="text-muted-foreground"> — {decision.summary}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No CreativePlan yet for this project.</p>
        )}
      </CardContent>
    </Card>
  );
}
