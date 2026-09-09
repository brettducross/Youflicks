"use client";

import { useCallback, useEffect, useState } from "react";
import { Clapperboard, Loader2, RefreshCw } from "lucide-react";
import { PlaybackPlayer } from "@/components/projects/playback-player";
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

type RenderAvailability = {
  productionAvailable: boolean;
  localDevAvailable: boolean;
  canRender: boolean;
};

type RenderView = {
  id: string;
  status: string;
  timelineVersion: number;
  outputProfile: string | null;
  mimeType: string | null;
  durationMs: number | null;
  byteSize: number | null;
  checksum: string | null;
  createdAt: string;
};

type JobStatusView = {
  jobId: string;
  renderJobId: string | null;
  status: string;
  renderStatus: string | null;
  error: string | null;
  progress: { percent?: number; stage?: string } | null;
};

function statusLabel(status: string) {
  switch (status) {
    case "PENDING":
    case "QUEUED":
      return "Queued";
    case "RUNNING":
      return "Rendering";
    case "SUCCEEDED":
      return "Ready";
    case "FAILED":
      return "Couldn’t finish";
    case "CANCELLED":
      return "Stopped";
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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function RenderPanel({
  projectId,
  initialRender,
  initialAvailability,
  timelineReady,
  unmetRoleCount,
}: {
  projectId: string;
  initialRender: RenderView | null;
  initialAvailability: RenderAvailability;
  timelineReady: boolean;
  unmetRoleCount: number;
}) {
  const [availability, setAvailability] = useState(initialAvailability);
  const [render, setRender] = useState<RenderView | null>(initialRender);
  const [cutReady, setCutReady] = useState(timelineReady);
  const [openGaps, setOpenGaps] = useState(unmetRoleCount);
  const [job, setJob] = useState<JobStatusView | null>(null);
  const [busy, setBusy] = useState(false);
  const [watching, setWatching] = useState(false);

  const refreshRender = useCallback(async () => {
    const [latestResponse, timelineResponse] = await Promise.all([
      fetch(`/api/projects/${projectId}/render/latest`),
      fetch(`/api/projects/${projectId}/timeline`),
    ]);
    const latestPayload = (await latestResponse.json()) as {
      render?: RenderView | null;
      error?: { message?: string };
    };
    const timelinePayload = (await timelineResponse.json()) as {
      timeline?: { document?: { unmetMediaRoles?: unknown[] } } | null;
    };
    if (!latestResponse.ok) {
      throw new Error(latestPayload.error?.message || "Could not load your movie render.");
    }
    setRender(latestPayload.render ?? null);
    if (timelineResponse.ok) {
      setCutReady(Boolean(timelinePayload.timeline));
      setOpenGaps(timelinePayload.timeline?.document?.unmetMediaRoles?.length ?? 0);
    }
  }, [projectId]);

  const refreshAvailability = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}/render`);
    const payload = (await response.json()) as RenderAvailability & {
      error?: { message?: string };
    };
    if (!response.ok) {
      return;
    }
    setAvailability({
      productionAvailable: payload.productionAvailable,
      localDevAvailable: payload.localDevAvailable,
      canRender: payload.canRender,
    });
  }, [projectId]);

  useEffect(() => {
    if (!job || job.status === "SUCCEEDED" || job.status === "FAILED" || job.status === "CANCELLED") {
      return;
    }
    const timer = window.setInterval(() => {
      void (async () => {
        const response = await fetch(`/api/projects/${projectId}/render/jobs/${job.jobId}`);
        const payload = (await response.json()) as JobStatusView & {
          error?: { message?: string };
        };
        if (!response.ok) {
          return;
        }
        setJob(payload);
        if (payload.status === "SUCCEEDED") {
          await refreshRender();
          toast.success("Ready to watch.");
        }
        if (payload.status === "FAILED") {
          toast.error(payload.error || "Couldn’t render your movie.");
        }
        if (payload.status === "CANCELLED") {
          toast.message("Stopped. Earlier finished renders are still here.");
        }
      })();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [job, projectId, refreshRender]);

  async function startRender() {
    setBusy(true);
    try {
      await refreshAvailability();
      const response = await fetch(`/api/projects/${projectId}/render`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json()) as {
        jobId?: string;
        status?: string;
        error?: { message?: string };
      };
      if (!response.ok || !payload.jobId) {
        throw new Error(payload.error?.message || "Could not start rendering.");
      }
      setJob({
        jobId: payload.jobId,
        renderJobId: null,
        status: payload.status ?? "PENDING",
        renderStatus: "QUEUED",
        error: null,
        progress: null,
      });
      toast.message("Rendering your movie.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn’t start.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!job) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/render/jobs/${job.jobId}/cancel`,
        { method: "POST" },
      );
      const payload = (await response.json()) as JobStatusView & {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message || "Could not stop.");
      }
      setJob(payload);
      toast.message("Stopping. Unfinished output will not be marked ready.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn’t stop.");
    } finally {
      setBusy(false);
    }
  }

  const working = job?.status === "PENDING" || job?.status === "RUNNING";
  const canRender = availability.canRender && cutReady && !busy && !working;

  return (
    <Card className="mt-10">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="font-heading text-xl">Your movie</CardTitle>
            <CardDescription className="mt-1.5">
              Render this cut into a movie file, then watch it. Not an editor, and not a library keep.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {availability.productionAvailable ? (
              <Badge>Ready to render</Badge>
            ) : availability.localDevAvailable ? (
              <Badge variant="outline">Local only</Badge>
            ) : (
              <Badge variant="outline">Unavailable</Badge>
            )}
            {job ? <Badge variant="secondary">{statusLabel(job.status)}</Badge> : null}
            {render && !job ? <Badge variant="secondary">Ready</Badge> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {!availability.canRender ? (
          <p className="text-sm text-muted-foreground">
            Rendering isn’t available yet. A genuine renderer must be configured for production.
            Local technical tools do not count.
          </p>
        ) : !availability.productionAvailable && availability.localDevAvailable ? (
          <p className="text-sm text-muted-foreground">
            Using a local development renderer. This is not a production render.
          </p>
        ) : !cutReady ? (
          <p className="text-sm text-muted-foreground">
            Build your cut first. Rendering uses the current READY cut as-is.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Render assembles the current cut. Watch plays that file. It does not keep a library film.
          </p>
        )}

        {cutReady && openGaps > 0 ? (
          <p className="text-xs text-muted-foreground">
            This cut still has missing pieces. Rendering will use the current shots as they are.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={!canRender} onClick={() => void startRender()}>
            {busy || working ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Clapperboard className="size-4" />
            )}
            Render
          </Button>
          {working ? (
            <Button type="button" variant="outline" disabled={busy} onClick={() => void cancel()}>
              Stop
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              void Promise.all([refreshRender(), refreshAvailability()]).catch((error: unknown) => {
                toast.error(error instanceof Error ? error.message : "Refresh failed.");
              });
            }}
          >
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        </div>

        {working && job.progress?.percent !== undefined ? (
          <p className="text-xs text-muted-foreground">Progress {Math.round(job.progress.percent)}%</p>
        ) : null}

        {job?.status === "FAILED" ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
            <p className="font-medium text-destructive">Couldn’t render your movie</p>
            <p className="mt-1 text-muted-foreground">{job.error || "Something went wrong."}</p>
          </div>
        ) : null}

        {render ? (
          <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-4">
            <p className="text-sm font-medium">Ready to watch</p>
            <p className="text-xs text-muted-foreground">
              Cut version {render.timelineVersion}
              {render.outputProfile ? ` · ${render.outputProfile.replaceAll("_", " ")}` : ""}
              {render.durationMs !== null ? ` · ${formatClock(render.durationMs)}` : ""}
              {render.byteSize !== null ? ` · ${formatBytes(render.byteSize)}` : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={busy}
                onClick={() => setWatching((open) => !open)}
              >
                {watching ? "Hide player" : "Watch"}
              </Button>
            </div>
            {watching ? (
              <PlaybackPlayer
                projectId={projectId}
                renderJobId={render.id}
                fallbackDurationMs={render.durationMs}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                Watch plays this render. It does not keep a library film or share it.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No render yet for this project.</p>
        )}
      </CardContent>
    </Card>
  );
}
