"use client";

import { useCallback, useEffect, useState } from "react";
import { BookOpen, Loader2, RefreshCw } from "lucide-react";
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

type StoryAvailability = {
  productionAvailable: boolean;
  localDevAvailable: boolean;
  canCompose: boolean;
};

type StorySceneView = {
  id: string;
  order: number;
  title?: string;
  purpose: string;
  dramaticFunction: string;
  mood?: string;
  pacing?: string;
  mediaRoles: Array<{ role: string; purpose?: string }>;
  voiceOverOutline?: string;
  dialogueOutline?: string;
  notes?: string;
};

type StoryActView = {
  id: string;
  order: number;
  title?: string;
  purpose: string;
  targetDurationMs?: number;
  scenes: StorySceneView[];
};

type StoryView = {
  id: string;
  version: number;
  status: string;
  document: {
    schemaVersion: string;
    title?: string;
    logline?: string;
    spine: { opening: string; development: string; resolution: string };
    acts: StoryActView[];
    rationale?: string;
  };
  createdAt: string;
};

type JobStatusView = {
  jobId: string;
  status: string;
  error: string | null;
  storyStructureId: string | null;
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

function formatNarrativeTarget(ms?: number) {
  if (!ms) return null;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `About ${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return `About ${minutes} min`;
}

function functionLabel(value: string) {
  return value.replaceAll("_", " ");
}

export function StoryPanel({
  projectId,
  initialStory,
  initialStories,
  initialAvailability,
  directionReady,
}: {
  projectId: string;
  initialStory: StoryView | null;
  initialStories: StoryView[];
  initialAvailability: StoryAvailability;
  directionReady: boolean;
}) {
  const [availability, setAvailability] = useState(initialAvailability);
  const [story, setStory] = useState<StoryView | null>(initialStory);
  const [history, setHistory] = useState<StoryView[]>(initialStories);
  const [job, setJob] = useState<JobStatusView | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshStory = useCallback(async () => {
    const [latestResponse, allResponse] = await Promise.all([
      fetch(`/api/projects/${projectId}/story`),
      fetch(`/api/projects/${projectId}/story?all=1`),
    ]);
    const latestPayload = (await latestResponse.json()) as {
      story?: StoryView | null;
      error?: { message?: string };
    };
    const allPayload = (await allResponse.json()) as {
      stories?: StoryView[];
      error?: { message?: string };
    };
    if (!latestResponse.ok) {
      throw new Error(latestPayload.error?.message || "Could not load your story.");
    }
    if (!allResponse.ok) {
      throw new Error(allPayload.error?.message || "Could not load story history.");
    }
    setStory(latestPayload.story ?? null);
    setHistory(allPayload.stories ?? []);
  }, [projectId]);

  const refreshAvailability = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}/story/compose`);
    const payload = (await response.json()) as StoryAvailability & {
      error?: { message?: string };
    };
    if (!response.ok) {
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
        const response = await fetch(`/api/projects/${projectId}/story/jobs/${job.jobId}`);
        const payload = (await response.json()) as JobStatusView & {
          error?: { message?: string };
        };
        if (!response.ok) {
          return;
        }
        setJob(payload);
        if (payload.status === "SUCCEEDED") {
          await refreshStory();
          toast.success("Your story is ready.");
        }
        if (payload.status === "FAILED") {
          toast.error(payload.error || "Couldn’t build your story.");
        }
      })();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [job, projectId, refreshStory]);

  async function compose() {
    setBusy(true);
    try {
      await refreshAvailability();
      const response = await fetch(`/api/projects/${projectId}/story/compose`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        jobId?: string;
        status?: string;
        error?: { message?: string; code?: string };
      };
      if (!response.ok || !payload.jobId) {
        throw new Error(payload.error?.message || "Could not start building your story.");
      }
      setJob({
        jobId: payload.jobId,
        status: payload.status ?? "PENDING",
        error: null,
        storyStructureId: null,
        version: null,
      });
      toast.message(story ? "Rebuilding your story." : "Building your story.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn’t start.");
    } finally {
      setBusy(false);
    }
  }

  const building = job?.status === "PENDING" || job?.status === "RUNNING";
  const canBuild = availability.canCompose && directionReady && !busy && !building;
  const older = history.filter((item) => item.id !== story?.id);

  return (
    <Card className="mt-10">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="font-heading text-xl">Your story</CardTitle>
            <CardDescription className="mt-1.5">
              A readable outline of this film — what happens, and why. Not a timeline or a finished
              movie.
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
            {story && !job ? <Badge variant="secondary">Ready</Badge> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {!availability.canCompose ? (
          <p className="text-sm text-muted-foreground">
            Story building isn’t available yet. A genuine story builder must be configured for
            production. Local technical tools do not count.
          </p>
        ) : !availability.productionAvailable && availability.localDevAvailable ? (
          <p className="text-sm text-muted-foreground">
            Using a local development story builder. This is not a production story.
          </p>
        ) : !directionReady ? (
          <p className="text-sm text-muted-foreground">
            Build your story after this project’s direction is ready.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {story
              ? "Rebuild to write a new version. Earlier versions stay in history."
              : "Build a story outline from this project’s direction and footage."}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={!canBuild} onClick={() => void compose()}>
            {busy || building ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <BookOpen className="size-4" />
            )}
            {story ? "Rebuild" : "Build"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              void refreshStory().catch((error: unknown) => {
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
            <p className="font-medium text-destructive">Couldn’t build your story</p>
            <p className="mt-1 text-muted-foreground">{job.error || "Something went wrong."}</p>
          </div>
        ) : null}

        {story ? (
          <StoryOutline story={story} />
        ) : (
          <p className="text-sm text-muted-foreground">No story yet for this project.</p>
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

function StoryOutline({ story }: { story: StoryView }) {
  const { document } = story;
  const acts = [...document.acts].sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-5 rounded-lg border border-border/70 bg-muted/20 p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Version {story.version}</span>
        <span>·</span>
        <span>{statusLabel(story.status)}</span>
      </div>
      {document.title ? <h3 className="font-heading text-lg">{document.title}</h3> : null}
      {document.logline ? <p className="text-sm text-muted-foreground">{document.logline}</p> : null}

      <div className="grid gap-3 md:grid-cols-3">
        <OutlineBlock label="Opening" body={document.spine.opening} />
        <OutlineBlock label="Development" body={document.spine.development} />
        <OutlineBlock label="Resolution" body={document.spine.resolution} />
      </div>

      <div className="space-y-4">
        {acts.map((act) => (
          <div key={act.id} className="space-y-3">
            <div>
              <p className="text-xs tracking-widest text-muted-foreground uppercase">
                {act.title || `Act ${act.order + 1}`}
                {formatNarrativeTarget(act.targetDurationMs)
                  ? ` · ${formatNarrativeTarget(act.targetDurationMs)}`
                  : ""}
              </p>
              <p className="mt-1 text-sm">{act.purpose}</p>
            </div>
            <ol className="space-y-3">
              {[...act.scenes]
                .sort((a, b) => a.order - b.order)
                .map((scene) => (
                  <li key={scene.id} className="rounded-md border border-border/50 bg-background/60 p-3">
                    <p className="text-sm font-medium">
                      {scene.title || `Scene ${scene.order + 1}`}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {functionLabel(scene.dramaticFunction)}
                      </span>
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">{scene.purpose}</p>
                    {scene.mood || scene.pacing ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {[scene.mood, scene.pacing].filter(Boolean).join(" · ")}
                      </p>
                    ) : null}
                    {scene.mediaRoles.length > 0 ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Footage roles:{" "}
                        {scene.mediaRoles.map((role) => role.role.replaceAll("_", " ")).join(", ")}
                      </p>
                    ) : null}
                    {scene.voiceOverOutline ? (
                      <p className="mt-2 text-sm">VO: {scene.voiceOverOutline}</p>
                    ) : null}
                    {scene.dialogueOutline ? (
                      <p className="mt-1 text-sm">Dialogue: {scene.dialogueOutline}</p>
                    ) : null}
                  </li>
                ))}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}

function OutlineBlock({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <p className="text-xs tracking-widest text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 text-sm">{body}</p>
    </div>
  );
}
