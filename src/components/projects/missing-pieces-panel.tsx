"use client";

import { useCallback, useEffect, useState } from "react";
import { Film, Loader2, RefreshCw, Sparkles } from "lucide-react";
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

type CapabilityAvailability = {
  productionAvailable: boolean;
  localDevAvailable: boolean;
  canGenerate: boolean;
};

type AssetAvailability = {
  productionAvailable: boolean;
  localDevAvailable: boolean;
  canGenerate: boolean;
  capabilities: Record<string, CapabilityAvailability>;
};

type UnmetRoleView = {
  role: string;
  storySceneId?: string;
  reason?: string;
};

type GeneratedAssetView = {
  id: string;
  status: string;
  kind: string;
  role: string;
  mimeType: string;
  previewUrl: string | null;
  originalUrl: string;
  createdAt: string;
};

type JobStatusView = {
  jobId: string;
  status: string;
  error: string | null;
  assetIds: string[];
};

function statusLabel(status: string) {
  switch (status) {
    case "PENDING":
      return "Queued";
    case "RUNNING":
      return "Making pieces";
    case "SUCCEEDED":
    case "READY":
      return "Ready";
    case "FAILED":
      return "Couldn’t finish";
    case "CANCELLED":
      return "Stopped";
    case "SUPERSEDED":
      return "Earlier version";
    default:
      return "In progress";
  }
}

function kindLabel(kind: string) {
  switch (kind) {
    case "IMAGE":
      return "Image";
    case "VOICE_OVER":
      return "Voice-over";
    case "MUSIC":
      return "Music";
    case "SFX":
      return "Sound";
    case "VIDEO_CLIP":
      return "Clip";
    case "ENHANCEMENT":
      return "Enhancement";
    default:
      return kind;
  }
}

export function MissingPiecesPanel({
  projectId,
  initialAssets,
  initialAvailability,
  initialUnmetRoles,
  timelineReady,
}: {
  projectId: string;
  initialAssets: GeneratedAssetView[];
  initialAvailability: AssetAvailability;
  initialUnmetRoles: UnmetRoleView[];
  timelineReady: boolean;
}) {
  const [availability, setAvailability] = useState(initialAvailability);
  const [assets, setAssets] = useState<GeneratedAssetView[]>(initialAssets);
  const [unmet, setUnmet] = useState<UnmetRoleView[]>(initialUnmetRoles);
  const [cutReady, setCutReady] = useState(timelineReady);
  const [job, setJob] = useState<JobStatusView | null>(null);
  const [busy, setBusy] = useState(false);
  const [rebuildBusy, setRebuildBusy] = useState(false);

  const refreshAssets = useCallback(async () => {
    const [assetsResponse, timelineResponse] = await Promise.all([
      fetch(`/api/projects/${projectId}/generated-assets`),
      fetch(`/api/projects/${projectId}/timeline`),
    ]);
    const assetsPayload = (await assetsResponse.json()) as {
      assets?: GeneratedAssetView[];
      error?: { message?: string };
    };
    const timelinePayload = (await timelineResponse.json()) as {
      timeline?: { document?: { unmetMediaRoles?: UnmetRoleView[] } } | null;
    };
    if (!assetsResponse.ok) {
      throw new Error(assetsPayload.error?.message || "Could not load missing pieces.");
    }
    setAssets(assetsPayload.assets ?? []);
    if (timelineResponse.ok) {
      setCutReady(Boolean(timelinePayload.timeline));
      setUnmet(timelinePayload.timeline?.document?.unmetMediaRoles ?? []);
    }
  }, [projectId]);

  const refreshAvailability = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}/generated-assets/generate`);
    const payload = (await response.json()) as AssetAvailability & {
      error?: { message?: string };
    };
    if (!response.ok) {
      return;
    }
    setAvailability({
      productionAvailable: payload.productionAvailable,
      localDevAvailable: payload.localDevAvailable,
      canGenerate: payload.canGenerate,
      capabilities: payload.capabilities,
    });
  }, [projectId]);

  useEffect(() => {
    if (!job || job.status === "SUCCEEDED" || job.status === "FAILED" || job.status === "CANCELLED") {
      return;
    }
    const timer = window.setInterval(() => {
      void (async () => {
        const response = await fetch(
          `/api/projects/${projectId}/generated-assets/jobs/${job.jobId}`,
        );
        const payload = (await response.json()) as JobStatusView & {
          error?: { message?: string };
        };
        if (!response.ok) {
          return;
        }
        setJob(payload);
        if (payload.status === "SUCCEEDED") {
          await refreshAssets();
          toast.success("Missing pieces are ready. Rebuild your cut to place them.");
        }
        if (payload.status === "FAILED") {
          await refreshAssets();
          toast.error(payload.error || "Couldn’t make those pieces.");
        }
        if (payload.status === "CANCELLED") {
          await refreshAssets();
          toast.message("Stopped. Pieces already made are still here.");
        }
      })();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [job, projectId, refreshAssets]);

  async function generate() {
    setBusy(true);
    try {
      await refreshAvailability();
      const response = await fetch(`/api/projects/${projectId}/generated-assets/generate`, {
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
        throw new Error(payload.error?.message || "Could not start making missing pieces.");
      }
      setJob({
        jobId: payload.jobId,
        status: payload.status ?? "PENDING",
        error: null,
        assetIds: [],
      });
      toast.message("Making missing pieces.");
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
        `/api/projects/${projectId}/generated-assets/jobs/${job.jobId}/cancel`,
        { method: "POST" },
      );
      const payload = (await response.json()) as JobStatusView & {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message || "Could not stop.");
      }
      setJob(payload);
      toast.message("Stopping. Pieces already made stay.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn’t stop.");
    } finally {
      setBusy(false);
    }
  }

  async function rebuildCut() {
    setRebuildBusy(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/timeline/rebuild`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        jobId?: string;
        error?: { message?: string };
      };
      if (!response.ok || !payload.jobId) {
        throw new Error(payload.error?.message || "Could not rebuild your cut.");
      }
      toast.message("Rebuilding your cut with the new pieces.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn’t rebuild.");
    } finally {
      setRebuildBusy(false);
    }
  }

  const working = job?.status === "PENDING" || job?.status === "RUNNING";
  const canGenerate = availability.canGenerate && cutReady && !busy && !working;
  const readyAssets = assets.filter((item) => item.status === "READY");
  const canRebuild = cutReady && readyAssets.length > 0 && !rebuildBusy && !working;

  return (
    <Card className="mt-10">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="font-heading text-xl">Missing pieces</CardTitle>
            <CardDescription className="mt-1.5">
              Fill story roles your footage didn’t cover. Review status and simple previews — not
              an editor, and not a finished movie.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {availability.productionAvailable ? (
              <Badge>Ready to make</Badge>
            ) : availability.localDevAvailable ? (
              <Badge variant="outline">Local only</Badge>
            ) : (
              <Badge variant="outline">Unavailable</Badge>
            )}
            {job ? <Badge variant="secondary">{statusLabel(job.status)}</Badge> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {!availability.canGenerate ? (
          <p className="text-sm text-muted-foreground">
            Making missing pieces isn’t available yet. A genuine generator must be configured for
            production. Local technical tools do not count.
          </p>
        ) : !availability.productionAvailable && availability.localDevAvailable ? (
          <p className="text-sm text-muted-foreground">
            Using a local development generator. This is not production media.
          </p>
        ) : !cutReady ? (
          <p className="text-sm text-muted-foreground">
            Build your cut first. Missing pieces are made from roles the cut couldn’t fill.
          </p>
        ) : unmet.length === 0 && readyAssets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This cut has no missing story roles right now.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Generate fills the open roles. Rebuild your cut afterwards to place them — it never
            happens automatically.
          </p>
        )}

        {unmet.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs tracking-widest text-muted-foreground uppercase">Open roles</p>
            <ul className="flex flex-wrap gap-2">
              {unmet.map((item) => (
                <li key={`${item.storySceneId ?? "scene"}-${item.role}`}>
                  <Badge variant="outline">{item.role.replaceAll("_", " ")}</Badge>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={!canGenerate} onClick={() => void generate()}>
            {busy || working ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Generate
          </Button>
          {working ? (
            <Button type="button" variant="outline" disabled={busy} onClick={() => void cancel()}>
              Stop
            </Button>
          ) : null}
          <Button type="button" variant="outline" disabled={!canRebuild} onClick={() => void rebuildCut()}>
            {rebuildBusy ? <Loader2 className="size-4 animate-spin" /> : <Film className="size-4" />}
            Rebuild cut
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              void Promise.all([refreshAssets(), refreshAvailability()]).catch((error: unknown) => {
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
            <p className="font-medium text-destructive">Couldn’t make those pieces</p>
            <p className="mt-1 text-muted-foreground">{job.error || "Something went wrong."}</p>
          </div>
        ) : null}

        {assets.length > 0 ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {assets.map((asset) => (
              <li
                key={asset.id}
                className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm">{asset.role.replaceAll("_", " ")}</p>
                  <Badge variant="outline">{statusLabel(asset.status)}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{kindLabel(asset.kind)}</p>
                {asset.status === "READY" ? <SimplePreview asset={asset} /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No generated pieces yet for this project.</p>
        )}
      </CardContent>
    </Card>
  );
}

function SimplePreview({ asset }: { asset: GeneratedAssetView }) {
  const src = asset.previewUrl ?? asset.originalUrl;
  if (asset.mimeType.startsWith("image/")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" className="max-h-32 rounded-md border border-border/50 object-contain" />
    );
  }
  if (asset.mimeType.startsWith("audio/")) {
    return <audio controls preload="none" src={src} className="w-full" />;
  }
  if (asset.mimeType.startsWith("video/")) {
    return <video controls preload="none" src={src} className="max-h-32 w-full rounded-md" />;
  }
  return null;
}
