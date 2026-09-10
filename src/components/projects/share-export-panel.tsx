"use client";

import { useCallback, useState } from "react";
import { Check, Copy, Download, Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type PublicationView = {
  id: string;
  destinationKey: string;
  status: string;
  payload: { expiresAt?: string; revokedAt?: string } | null;
  createdAt: string;
};

type PublicationsPayload = {
  publications?: PublicationView[];
  canExport?: boolean;
  canShareLink?: boolean;
  watermarkRequired?: boolean;
  adsEnabled?: boolean;
  error?: { message?: string };
};

function statusLabel(status: string) {
  switch (status) {
    case "PENDING":
      return "Working";
    case "PUBLISHED":
      return "Ready";
    case "FAILED":
      return "Couldn’t share";
    case "REVOKED":
      return "Revoked";
    default:
      return status;
  }
}

function destinationLabel(key: string) {
  if (key === "DOWNLOAD") return "Export";
  if (key === "SHARE_LINK") return "Share link";
  return "Share";
}

function filenameFromDisposition(header: string | null) {
  if (!header) return "film.mp4";
  const match = /filename="([^"]+)"/.exec(header);
  return match?.[1] || "film.mp4";
}

export function ShareExportPanel({
  projectId,
  movieId,
}: {
  projectId: string;
  movieId: string;
}) {
  const [publications, setPublications] = useState<PublicationView[]>([]);
  const [canExport, setCanExport] = useState(true);
  const [canShareLink, setCanShareLink] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [latestShareUrl, setLatestShareUrl] = useState<string | null>(null);
  const [watermarkRequired, setWatermarkRequired] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}/movies/${movieId}/publications`);
    const payload = (await response.json()) as PublicationsPayload;
    if (!response.ok) {
      throw new Error(payload.error?.message || "Could not load shares.");
    }
    setPublications(payload.publications ?? []);
    setCanExport(Boolean(payload.canExport));
    setCanShareLink(Boolean(payload.canShareLink));
    setWatermarkRequired(Boolean(payload.watermarkRequired));
  }, [movieId, projectId]);

  async function exportFilm() {
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/movies/${movieId}/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (response.status === 202) {
        toast.message("Export started. Refresh in a moment.");
        await refresh();
        return;
      }
      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message?: string } };
        throw new Error(payload.error?.message || "Could not export.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filenameFromDisposition(response.headers.get("content-disposition"));
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success("Download started.");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn’t export.");
    } finally {
      setBusy(false);
    }
  }

  async function createShareLink() {
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/movies/${movieId}/share-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json()) as {
        shareUrl?: string;
        error?: { message?: string };
      };
      if (!response.ok || !payload.shareUrl) {
        throw new Error(payload.error?.message || "Could not create a share link.");
      }
      setLatestShareUrl(payload.shareUrl);
      await navigator.clipboard.writeText(payload.shareUrl).catch(() => undefined);
      toast.success("Share link created and copied.");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn’t create a share link.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(publicationId: string) {
    setBusy(true);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/publications/${publicationId}/revoke`,
        { method: "POST" },
      );
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message || "Could not revoke.");
      }
      toast.message("Share link revoked.");
      if (latestShareUrl) {
        setLatestShareUrl(null);
      }
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn’t revoke.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string, id: string) {
    await navigator.clipboard.writeText(url);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 1500);
    toast.success("Copied.");
  }

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-background/40 p-3">
      <div>
        <p className="text-sm font-medium">Share or export</p>
        <p className="text-xs text-muted-foreground">
          Export downloads the film. A share link lets someone watch only — it expires and you can
          revoke it. This is not automatic when you keep or watch.
          {watermarkRequired
            ? " Free-plan films show a YouFlicks watermark on the player. Download files are not visually branded yet."
            : ""}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={busy || !canExport} onClick={() => void exportFilm()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          Export
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !canShareLink}
          onClick={() => void createShareLink()}
        >
          <Link2 className="size-4" />
          Create share link
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            void refresh().catch((error: unknown) => {
              toast.error(error instanceof Error ? error.message : "Could not load shares.");
            });
          }}
        >
          Refresh
        </Button>
      </div>
      {latestShareUrl ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5">
          <p className="min-w-0 flex-1 truncate text-xs">{latestShareUrl}</p>
          <Button type="button" size="sm" variant="ghost" onClick={() => void copy(latestShareUrl, "latest")}>
            {copiedId === "latest" ? <Check className="size-4" /> : <Copy className="size-4" />}
            Copy
          </Button>
        </div>
      ) : null}
      {publications.length > 0 ? (
        <ul className="space-y-2">
          {publications.map((item) => (
            <li key={item.id} className="flex flex-col gap-2 rounded-md border border-border/50 px-2 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-medium">{destinationLabel(item.destinationKey)}</p>
                <p className="text-xs text-muted-foreground">
                  {item.payload?.expiresAt
                    ? `Expires ${new Date(item.payload.expiresAt).toLocaleString()}`
                    : new Date(item.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={item.status === "FAILED" ? "destructive" : "secondary"}>
                  {statusLabel(item.status)}
                </Badge>
                {item.destinationKey === "SHARE_LINK" && item.status === "PUBLISHED" ? (
                  <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void revoke(item.id)}>
                    Revoke
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No shares or exports yet.</p>
      )}
    </div>
  );
}
