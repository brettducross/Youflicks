"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, Loader2, RefreshCw } from "lucide-react";
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

type MovieView = {
  id: string;
  title: string;
  status: string;
  durationMs: number | null;
  keptAt: string | null;
  createdAt: string;
};

type LibraryPayload = {
  movies?: MovieView[];
  canKeep?: boolean;
  error?: { message?: string };
};

function statusLabel(status: string) {
  switch (status) {
    case "READY":
      return "Kept";
    case "ARCHIVED":
      return "Archived";
    case "FAILED":
      return "Couldn’t keep";
    default:
      return status;
  }
}

function formatClock(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatKeptAt(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function LibraryPanel({
  projectId,
  initialMovies,
  initialCanKeep,
}: {
  projectId: string;
  initialMovies: MovieView[];
  initialCanKeep: boolean;
}) {
  const [movies, setMovies] = useState(initialMovies);
  const [canKeep, setCanKeep] = useState(initialCanKeep);
  const [busy, setBusy] = useState(false);
  const [watchingId, setWatchingId] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch(
      `/api/projects/${projectId}/movies${includeArchived ? "?includeArchived=1" : ""}`,
    );
    const payload = (await response.json()) as LibraryPayload;
    if (!response.ok) {
      throw new Error(payload.error?.message || "Could not load your library.");
    }
    setMovies(payload.movies ?? []);
    setCanKeep(Boolean(payload.canKeep));
  }, [includeArchived, projectId]);

  useEffect(() => {
    const onChanged = () => {
      void refresh().catch(() => undefined);
    };
    const onKeep = (event: Event) => {
      const jobId = (event as CustomEvent<{ jobId?: string }>).detail?.jobId;
      if (!jobId) {
        onChanged();
        return;
      }
      const timer = window.setInterval(() => {
        void (async () => {
          const response = await fetch(`/api/projects/${projectId}/movies/jobs/${jobId}`);
          const payload = (await response.json()) as { status?: string; error?: string };
          if (!response.ok) {
            return;
          }
          if (payload.status === "SUCCEEDED") {
            window.clearInterval(timer);
            toast.success("Kept in your library.");
            await refresh().catch(() => undefined);
          }
          if (payload.status === "FAILED") {
            window.clearInterval(timer);
            toast.error(payload.error || "Couldn’t keep this film.");
            await refresh().catch(() => undefined);
          }
        })();
      }, 1500);
    };
    window.addEventListener("youflicks:library-changed", onChanged);
    window.addEventListener("youflicks:library-keep", onKeep);
    return () => {
      window.removeEventListener("youflicks:library-changed", onChanged);
      window.removeEventListener("youflicks:library-keep", onKeep);
    };
  }, [projectId, refresh]);

  async function unarchive(movieId: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/movies/${movieId}/unarchive`, {
        method: "POST",
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message || "Could not restore.");
      }
      toast.success("Restored to your library.");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn’t restore.");
    } finally {
      setBusy(false);
    }
  }

  async function archive(movieId: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/movies/${movieId}/archive`, {
        method: "POST",
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message || "Could not archive.");
      }
      toast.message("Archived. The file is still stored.");
      if (watchingId === movieId) {
        setWatchingId(null);
      }
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn’t archive.");
    } finally {
      setBusy(false);
    }
  }

  const visible = movies;

  return (
    <Card className="mt-10">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="font-heading text-xl">Library</CardTitle>
            <CardDescription className="mt-1.5">
              Films you kept. Watching a kept film is not sharing.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canKeep ? <Badge variant="outline">Ready to keep</Badge> : null}
            <Badge variant="secondary">
              {visible.length === 1 ? "1 film" : `${visible.length} films`}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Keep this film copies a finished render into your library. It does not publish or export.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              void refresh().catch((error: unknown) => {
                toast.error(error instanceof Error ? error.message : "Refresh failed.");
              });
            }}
          >
            <RefreshCw className="size-4" />
            Refresh
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              const next = !includeArchived;
              setIncludeArchived(next);
              void (async () => {
                const response = await fetch(
                  `/api/projects/${projectId}/movies${next ? "?includeArchived=1" : ""}`,
                );
                const payload = (await response.json()) as LibraryPayload;
                if (!response.ok) {
                  toast.error(payload.error?.message || "Could not load your library.");
                  return;
                }
                setMovies(payload.movies ?? []);
                setCanKeep(Boolean(payload.canKeep));
              })();
            }}
          >
            {includeArchived ? "Hide archived" : "Show archived"}
          </Button>
        </div>

        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No kept films yet. Keep this film from a successful render.
          </p>
        ) : (
          <ul className="space-y-3">
            {visible.map((movie) => {
              const kept = formatKeptAt(movie.keptAt ?? movie.createdAt);
              return (
                <li key={movie.id} className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-medium">{movie.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {movie.durationMs !== null ? formatClock(movie.durationMs) : "Duration unknown"}
                        {kept ? ` · Kept ${kept}` : ""}
                      </p>
                    </div>
                    <Badge variant={movie.status === "FAILED" ? "destructive" : "secondary"}>
                      {statusLabel(movie.status)}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {movie.status === "READY" ? (
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={() => setWatchingId((id) => (id === movie.id ? null : movie.id))}
                      >
                        {watchingId === movie.id ? "Hide player" : "Watch"}
                      </Button>
                    ) : null}
                    {movie.status === "READY" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void archive(movie.id)}
                      >
                        <Archive className="size-4" />
                        Archive
                      </Button>
                    ) : null}
                    {movie.status === "ARCHIVED" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void unarchive(movie.id)}
                      >
                        Restore
                      </Button>
                    ) : null}
                  </div>
                  {watchingId === movie.id && movie.status === "READY" ? (
                    <PlaybackPlayer
                      projectId={projectId}
                      finishedMovieId={movie.id}
                      fallbackDurationMs={movie.durationMs}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {busy ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Updating your library.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
