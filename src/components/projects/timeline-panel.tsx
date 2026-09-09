"use client";

import { useCallback, useEffect, useState } from "react";
import { Film, Loader2, RefreshCw } from "lucide-react";
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

type TimelineAvailability = {
  productionAvailable: boolean;
  localDevAvailable: boolean;
  canCompose: boolean;
};

type ShotView = {
  id: string;
  trackKey: string;
  order: number;
  mediaRole?: string;
  timelineStartMs: number;
  timelineEndMs: number;
  captionText?: string;
};

type UnmetRoleView = {
  role: string;
  reason?: string;
};

type TimelineView = {
  id: string;
  version: number;
  status: string;
  document: {
    schemaVersion: string;
    title?: string;
    totalDurationMs: number;
    clips: ShotView[];
    unmetMediaRoles?: UnmetRoleView[];
  };
  createdAt: string;
};

type JobStatusView = {
  jobId: string;
  status: string;
  error: string | null;
  timelineId: string | null;
  version: number | null;
};

function statusLabel(status: string) {
  switch (status) {
    case "PENDING":
      return "Queued";
    case "RUNNING":
      return "Building";
    case "SUCCEEDED":
    case "READY":
      return "Ready";
    case "FAILED":
      return "Couldn’t finish";
    case "SUPERSEDED":
      return "Earlier version";
    case "DRAFT":
      return "Draft";
    default:
      return "In progress";
  }
}

function formatClock(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatRange(startMs: number, endMs: number) {
  return `${formatClock(startMs)}–${formatClock(endMs)}`;
}

function shotLabel(clip: ShotView, index: number) {
  if (clip.mediaRole) {
    return clip.mediaRole.replaceAll("_", " ");
  }
  return `Shot ${index + 1}`;
}

export function TimelinePanel({
  projectId,
  initialTimeline,
  initialTimelines,
  initialAvailability,
  storyReady,
}: {
  projectId: string;
  initialTimeline: TimelineView | null;
  initialTimelines: TimelineView[];
  initialAvailability: TimelineAvailability;
  storyReady: boolean;
}) {
  const [availability, setAvailability] = useState(initialAvailability);
  const [timeline, setTimeline] = useState<TimelineView | null>(initialTimeline);
  const [history, setHistory] = useState<TimelineView[]>(initialTimelines);
  const [storyIsReady, setStoryIsReady] = useState(storyReady);
  const [job, setJob] = useState<JobStatusView | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshTimeline = useCallback(async () => {
    const [latestResponse, allResponse] = await Promise.all([
      fetch(`/api/projects/${projectId}/timeline`),
      fetch(`/api/projects/${projectId}/timeline?all=1`),
    ]);
    const latestPayload = (await latestResponse.json()) as {
      timeline?: TimelineView | null;
      error?: { message?: string };
    };
    const allPayload = (await allResponse.json()) as {
      timelines?: TimelineView[];
      error?: { message?: string };
    };
    if (!latestResponse.ok) {
      throw new Error(latestPayload.error?.message || "Could not load your cut.");
    }
    if (!allResponse.ok) {
      throw new Error(allPayload.error?.message || "Could not load cut history.");
    }
    setTimeline(latestPayload.timeline ?? null);
    setHistory(allPayload.timelines ?? []);
  }, [projectId]);

  const refreshAvailability = useCallback(async () => {
    const [composeResponse, storyResponse] = await Promise.all([
      fetch(`/api/projects/${projectId}/timeline/compose`),
      fetch(`/api/projects/${projectId}/story`),
    ]);
    const payload = (await composeResponse.json()) as TimelineAvailability & {
      error?: { message?: string };
    };
    const storyPayload = (await storyResponse.json()) as {
      story?: { id?: string } | null;
    };
    if (storyResponse.ok) {
      setStoryIsReady(Boolean(storyPayload.story));
    }
    if (!composeResponse.ok) {
      return;
    }
    setAvailability({
      productionAvailable: payload.productionAvailable,
      localDevAvailable: payload.localDevAvailable,
      canCompose: payload.canCompose,
    });
  }, [projectId]);

  useEffect(() => {
    if (!job || job.status === "SUCCEEDED" || job.status === "FAILED") {
      return;
    }
    const timer = window.setInterval(() => {
      void (async () => {
        const response = await fetch(`/api/projects/${projectId}/timeline/jobs/${job.jobId}`);
        const payload = (await response.json()) as JobStatusView & {
          error?: { message?: string };
        };
        if (!response.ok) {
          return;
        }
        setJob(payload);
        if (payload.status === "SUCCEEDED") {
          await refreshTimeline();
          toast.success("Your cut is ready.");
        }
        if (payload.status === "FAILED") {
          toast.error(payload.error || "Couldn’t build your cut.");
        }
      })();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [job, projectId, refreshTimeline]);

  async function compose() {
    setBusy(true);
    try {
      await refreshAvailability();
      const response = await fetch(`/api/projects/${projectId}/timeline/compose`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        jobId?: string;
        status?: string;
        error?: { message?: string; code?: string };
      };
      if (!response.ok || !payload.jobId) {
        throw new Error(payload.error?.message || "Could not start building your cut.");
      }
      setJob({
        jobId: payload.jobId,
        status: payload.status ?? "PENDING",
        error: null,
        timelineId: null,
        version: null,
      });
      toast.message(timeline ? "Rebuilding your cut." : "Building your cut.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn’t start.");
    } finally {
      setBusy(false);
    }
  }

  const building = job?.status === "PENDING" || job?.status === "RUNNING";
  const canBuild = availability.canCompose && storyIsReady && !busy && !building;
  const older = history.filter((item) => item.id !== timeline?.id);

  return (
    <Card className="mt-10">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="font-heading text-xl">Your cut</CardTitle>
            <CardDescription className="mt-1.5">
              A simple ordered shot list from your story and footage. Review only — not an editor,
              and not a finished movie.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {availability.productionAvailable ? (
              <Badge>Ready to build</Badge>
            ) : availability.localDevAvailable ? (
              <Badge variant="outline">Local only</Badge>
            ) : (
              <Badge variant="outline">Unavailable</Badge>
            )}
            {job ? <Badge variant="secondary">{statusLabel(job.status)}</Badge> : null}
            {timeline && !job ? <Badge variant="secondary">Ready</Badge> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {!availability.canCompose ? (
          <p className="text-sm text-muted-foreground">
            Cut building isn’t available yet. A genuine cut builder must be configured for
            production. Local technical tools do not count.
          </p>
        ) : !availability.productionAvailable && availability.localDevAvailable ? (
          <p className="text-sm text-muted-foreground">
            Using a local development cut builder. This is not a production cut.
          </p>
        ) : !storyIsReady ? (
          <p className="text-sm text-muted-foreground">
            Build your cut after this project’s story is ready.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {timeline
              ? "Rebuild to write a new version. Earlier versions stay in history."
              : "Build a cut from this project’s story and footage."}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={!canBuild} onClick={() => void compose()}>
            {busy || building ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Film className="size-4" />
            )}
            {timeline ? "Rebuild" : "Build"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              void Promise.all([refreshTimeline(), refreshAvailability()]).catch((error: unknown) => {
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
            <p className="font-medium text-destructive">Couldn’t build your cut</p>
            <p className="mt-1 text-muted-foreground">{job.error || "Something went wrong."}</p>
          </div>
        ) : null}

        {timeline ? (
          <ShotList timeline={timeline} />
        ) : (
          <p className="text-sm text-muted-foreground">No cut yet for this project.</p>
        )}

        {older.length > 0 ? (
          <div className="space-y-3">
            <p className="text-xs tracking-widest text-muted-foreground uppercase">
              Version history
            </p>
            <ul className="space-y-2">
              {older.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2 text-sm"
                >
                  <span>
                    Version {item.version}
                    {item.document.title ? ` — ${item.document.title}` : ""}
                  </span>
                  <Badge variant="outline">{statusLabel(item.status)}</Badge>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ShotList({ timeline }: { timeline: TimelineView }) {
  const shots = [...timeline.document.clips].sort((a, b) => {
    if (a.timelineStartMs !== b.timelineStartMs) {
      return a.timelineStartMs - b.timelineStartMs;
    }
    return a.order - b.order;
  });
  const unmet = timeline.document.unmetMediaRoles ?? [];

  return (
    <div className="space-y-4 rounded-lg border border-border/70 bg-muted/20 p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Version {timeline.version}</span>
        <span>·</span>
        <span>{statusLabel(timeline.status)}</span>
        <span>·</span>
        <span>{formatClock(timeline.document.totalDurationMs)}</span>
      </div>
      {timeline.document.title ? (
        <h3 className="font-heading text-lg">{timeline.document.title}</h3>
      ) : null}

      {shots.length > 0 ? (
        <ol className="space-y-2">
          {shots.map((shot, index) => (
            <li
              key={shot.id}
              className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-border/50 bg-background/60 px-3 py-2"
            >
              <p className="text-sm">
                <span className="text-muted-foreground">{index + 1}.</span> {shotLabel(shot, index)}
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {formatRange(shot.timelineStartMs, shot.timelineEndMs)}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">
          No shots could be placed from existing footage yet.
        </p>
      )}

      {unmet.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Some story footage roles weren’t filled:{" "}
          {unmet.map((item) => item.role.replaceAll("_", " ")).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}
