"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type PlaybackSession = {
  sessionId: string;
  renderJobId: string;
  durationMs: number;
  mimeType: string;
  transport: "APP_STREAM" | "NATIVE_HANDLE";
  streamPath?: string;
};

function formatClock(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function PlaybackPlayer({
  projectId,
  renderJobId,
  fallbackDurationMs,
}: {
  projectId: string;
  renderJobId: string;
  fallbackDurationMs: number | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [session, setSession] = useState<PlaybackSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(fallbackDurationMs ?? 0);
  const [error, setError] = useState<string | null>(null);

  const closeSession = useCallback(
    async (sessionId: string) => {
      await fetch(`/api/projects/${projectId}/playback/close`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      }).catch(() => undefined);
    },
    [projectId],
  );

  const openSession = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/playback/open`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ renderJobId, surface: "web" }),
      });
      const payload = (await response.json()) as {
        session?: PlaybackSession;
        error?: { message?: string };
      };
      if (!response.ok || !payload.session?.streamPath) {
        throw new Error(payload.error?.message || "Could not start watching.");
      }
      setSession(payload.session);
      setDurationMs(payload.session.durationMs || fallbackDurationMs || 0);
    } catch (openError) {
      const message = openError instanceof Error ? openError.message : "Could not start watching.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }, [fallbackDurationMs, projectId, renderJobId]);

  useEffect(() => {
    void openSession();
  }, [openSession]);

  useEffect(() => {
    return () => {
      if (session?.sessionId) {
        void closeSession(session.sessionId);
      }
    };
  }, [closeSession, session?.sessionId]);

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  }

  function onSeek(value: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = value / 1000;
    setCurrentMs(value);
  }

  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-black/40 p-3">
      <div className="relative overflow-hidden rounded-md bg-black">
        {session?.streamPath ? (
          <video
            ref={videoRef}
            className="aspect-video w-full bg-black"
            src={session.streamPath}
            preload="metadata"
            playsInline
            controls={false}
            disablePictureInPicture
            controlsList="nodownload noplaybackrate noremoteplayback"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(event) => setCurrentMs(event.currentTarget.currentTime * 1000)}
            onDurationChange={(event) => {
              const next = event.currentTarget.duration;
              if (Number.isFinite(next) && next > 0) {
                setDurationMs(next * 1000);
              }
            }}
            onError={() => setError("This render couldn’t be played.")}
          />
        ) : (
          <div className="flex aspect-video items-center justify-center text-sm text-muted-foreground">
            {busy ? <Loader2 className="size-5 animate-spin" /> : "Opening watch session…"}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" size="sm" disabled={!session || busy} onClick={togglePlay}>
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          {playing ? "Pause" : "Play"}
        </Button>
        <input
          type="range"
          aria-label="Seek"
          className="h-1.5 flex-1 accent-primary"
          min={0}
          max={Math.max(durationMs, 1)}
          value={Math.min(currentMs, durationMs)}
          disabled={!session}
          onChange={(event) => onSeek(Number(event.target.value))}
        />
        <p className="min-w-20 text-right text-xs text-muted-foreground">
          {formatClock(currentMs)} / {formatClock(durationMs)}
        </p>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <p className="text-xs text-muted-foreground">Watching this render. It is not kept in a library and is not shared.</p>
    </div>
  );
}
