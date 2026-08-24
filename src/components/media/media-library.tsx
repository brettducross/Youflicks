"use client";

import { useMemo, useRef, useState } from "react";
import { Film, ImagePlus, Loader2, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import type { MediaAssetView } from "@/lib/media-types";
import {
  ACCEPT_ATTRIBUTE,
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_MAX_VIDEO_BYTES,
} from "@/lib/media-types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type QueueItem = {
  id: string;
  name: string;
  progress: number;
  error?: string;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(ms: number | null) {
  if (!ms || ms < 0) return null;
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm"]);
const PHOTO_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif"]);

function extensionOf(filename: string) {
  const parts = filename.split(".");
  if (parts.length < 2) return "";
  return parts.pop()?.toLowerCase() ?? "";
}

/** Fast client hint only. The server sniffs magic bytes and enforces limits. */
function clientGuard(file: File): string | null {
  if (file.size <= 0) {
    return "That file is empty.";
  }
  const ext = extensionOf(file.name);
  if (ext && !VIDEO_EXTENSIONS.has(ext) && !PHOTO_EXTENSIONS.has(ext)) {
    return `YouFlicks cannot ingest .${ext} files. Use JPEG, PNG, WEBP, HEIC, MP4, MOV, or WEBM.`;
  }
  if (VIDEO_EXTENSIONS.has(ext) && file.size > DEFAULT_MAX_VIDEO_BYTES) {
    return `Videos must be ${Math.round(DEFAULT_MAX_VIDEO_BYTES / (1024 * 1024))} MB or smaller.`;
  }
  if (PHOTO_EXTENSIONS.has(ext) && file.size > DEFAULT_MAX_IMAGE_BYTES) {
    return `Photos must be ${Math.round(DEFAULT_MAX_IMAGE_BYTES / (1024 * 1024))} MB or smaller.`;
  }
  if (file.size > DEFAULT_MAX_VIDEO_BYTES) {
    return `Files must be ${Math.round(DEFAULT_MAX_VIDEO_BYTES / (1024 * 1024))} MB or smaller.`;
  }
  return null;
}

function uploadOne(
  projectId: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<MediaAssetView> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file);
    xhr.open("POST", `/api/projects/${projectId}/assets`);
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      const payload = xhr.response as
        | { asset?: MediaAssetView; error?: { message?: string } }
        | null;
      if (xhr.status >= 200 && xhr.status < 300 && payload?.asset) {
        resolve(payload.asset);
        return;
      }
      reject(new Error(payload?.error?.message || "Upload failed."));
    };
    xhr.onerror = () => reject(new Error("The connection dropped before the file arrived."));
    xhr.send(form);
  });
}

export function MediaLibrary({
  projectId,
  initialAssets,
}: {
  projectId: string;
  initialAssets: MediaAssetView[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [assets, setAssets] = useState(initialAssets);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [active, setActive] = useState<MediaAssetView | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const photos = assets.filter((asset) => asset.kind === "PHOTO").length;
    const videos = assets.filter((asset) => asset.kind === "VIDEO").length;
    return { photos, videos };
  }, [assets]);

  async function ingestFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const items: QueueItem[] = files.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      progress: 0,
    }));
    setQueue((current) => [...items, ...current]);

    await Promise.all(
      files.map(async (file, index) => {
        const itemId = items[index]?.id;
        if (!itemId) return;
        const blocked = clientGuard(file);
        if (blocked) {
          setQueue((current) =>
            current.map((item) =>
              item.id === itemId ? { ...item, progress: 0, error: blocked } : item,
            ),
          );
          return;
        }
        try {
          const asset = await uploadOne(projectId, file, (progress) => {
            setQueue((current) =>
              current.map((item) => (item.id === itemId ? { ...item, progress } : item)),
            );
          });
          setAssets((current) => [asset, ...current.filter((entry) => entry.id !== asset.id)]);
          setQueue((current) => current.filter((item) => item.id !== itemId));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Upload failed.";
          setQueue((current) =>
            current.map((item) =>
              item.id === itemId ? { ...item, progress: 0, error: message } : item,
            ),
          );
        }
      }),
    );
  }

  async function removeAsset(asset: MediaAssetView) {
    setRemovingId(asset.id);
    try {
      const response = await fetch(`/api/projects/${projectId}/assets/${asset.id}`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 204) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(payload?.error?.message || "Could not remove that file.");
      }
      setAssets((current) => current.filter((entry) => entry.id !== asset.id));
      if (active?.id === asset.id) setActive(null);
      toast.success(`Removed ${asset.filename}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove that file.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section className="mt-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs tracking-[0.24em] text-primary uppercase">Camera roll</p>
          <h2 className="mt-2 text-3xl">Media</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Drop the photos and clips this film is made from. Each file is stored through
            YouFlicks storage — not a hard-coded disk path — and stays on this project.
          </p>
        </div>
        <p className="text-xs tracking-widest text-muted-foreground uppercase">
          {counts.photos} stills · {counts.videos} clips
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        multiple
        className="sr-only"
        onChange={(event) => {
          if (event.target.files) {
            void ingestFiles(event.target.files);
            event.target.value = "";
          }
        }}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          if (event.dataTransfer.files.length) {
            void ingestFiles(event.dataTransfer.files);
          }
        }}
        className={cn(
          "mt-6 flex w-full flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-12 text-center transition-colors",
          dragOver
            ? "border-primary bg-primary/10"
            : "border-border/80 bg-card/40 hover:border-primary/50 hover:bg-card/70",
        )}
      >
        <span className="flex size-12 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
          <ImagePlus className="size-5" />
        </span>
        <span className="mt-4 font-heading text-2xl">Bring the footage in</span>
        <span className="mt-2 max-w-md text-sm text-muted-foreground">
          JPEG, PNG, WEBP, HEIC, MP4, MOV, or WEBM. Drop several at once — a single failure
          will not stop the rest of the batch.
        </span>
        <span className={cn("mt-5 inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground")}>
          <Upload className="size-4" />
          Choose files
        </span>
      </button>

      {queue.length > 0 ? (
        <ul className="mt-6 grid gap-2">
          {queue.map((item) => (
            <li
              key={item.id}
              className="rounded-xl border border-border/70 bg-card/60 px-4 py-3"
            >
              <div className="flex items-center justify-between gap-3 text-sm">
                <p className="truncate">{item.name}</p>
                {item.error ? (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      setQueue((current) => current.filter((entry) => entry.id !== item.id))
                    }
                    aria-label="Dismiss"
                  >
                    <X className="size-4" />
                  </button>
                ) : (
                  <span className="tabular-nums text-muted-foreground">{item.progress}%</span>
                )}
              </div>
              {item.error ? (
                <p className="mt-1 text-xs text-destructive">{item.error}</p>
              ) : (
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {assets.length === 0 && queue.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          The roll is empty. The story starts when the first frame lands.
        </p>
      ) : (
        <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {assets.map((asset) => (
            <li key={asset.id} className="group relative">
              <button
                type="button"
                onClick={() => setActive(asset)}
                className="block w-full overflow-hidden rounded-2xl border border-border/70 bg-card text-left ring-primary/0 transition hover:ring-2 hover:ring-primary/40"
              >
                <div className="relative aspect-4/5 bg-black/40">
                  {asset.previewUrl || asset.kind === "PHOTO" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={asset.previewUrl ?? asset.originalUrl}
                      alt={asset.filename}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-primary">
                      <Film className="size-8" />
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 to-transparent p-3">
                    <p className="truncate text-sm text-white">{asset.filename}</p>
                    <p className="mt-0.5 text-[11px] tracking-wide text-white/70 uppercase">
                      {asset.kind === "VIDEO" ? "Clip" : "Still"} · {formatBytes(asset.byteSize)}
                      {formatDuration(asset.durationMs)
                        ? ` · ${formatDuration(asset.durationMs)}`
                        : ""}
                    </p>
                  </div>
                  {asset.kind === "VIDEO" ? (
                    <Badge className="absolute top-3 left-3 bg-black/70 text-white">Film</Badge>
                  ) : null}
                </div>
              </button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute top-3 right-3 bg-black/55 text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:bg-black/80"
                disabled={removingId === asset.id}
                onClick={() => void removeAsset(asset)}
                aria-label={`Remove ${asset.filename}`}
              >
                {removingId === asset.id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {active ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setActive(null)}
        >
          <div
            className="relative w-full max-w-4xl overflow-hidden rounded-2xl border border-border/60 bg-background"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
              <div>
                <p className="font-medium">{active.filename}</p>
                <p className="text-xs text-muted-foreground">
                  {active.mimeType}
                  {active.width && active.height ? ` · ${active.width}×${active.height}` : ""}
                </p>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={() => setActive(null)}>
                <X className="size-4" />
              </Button>
            </div>
            <div className="flex max-h-[70vh] items-center justify-center bg-black">
              {active.kind === "VIDEO" ? (
                <video
                  src={active.originalUrl}
                  poster={active.previewUrl ?? undefined}
                  controls
                  className="max-h-[70vh] w-full"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={active.originalUrl}
                  alt={active.filename}
                  className="max-h-[70vh] w-full object-contain"
                />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
