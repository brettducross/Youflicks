"use client";

import { useEffect } from "react";
import { allowlistedHttpsLinkUrl } from "@/server/advertising/link-url";

export type AdSurfaceView = {
  key: string;
  placement: string;
  kind: "STUB" | "FIRST_PARTY";
  copy: string;
  displayName?: string;
  linkUrl?: string | null;
};

function record(surface: string, kind: "impression" | "click", destinationUrl?: string) {
  void fetch("/api/me/advertising", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      surface,
      kind,
      ...(destinationUrl ? { destinationUrl } : {}),
    }),
  }).catch(() => undefined);
}

export function AdSurface({
  surface,
  compact = false,
}: {
  surface: AdSurfaceView;
  compact?: boolean;
}) {
  const href = allowlistedHttpsLinkUrl(surface.linkUrl);
  const title =
    surface.kind === "FIRST_PARTY" && surface.displayName
      ? surface.displayName
      : "Ad-supported free plan";

  useEffect(() => {
    record(surface.key, "impression");
  }, [surface.key]);

  return (
    <aside
      data-testid={`ad-surface-${surface.key}`}
      className={
        compact
          ? "rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
          : "border-b border-border/70 bg-muted/25 px-4 py-2.5 text-xs text-muted-foreground sm:px-6"
      }
    >
      <p className="font-medium text-foreground">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`ad-surface-link-${surface.key}`}
            className="underline-offset-2 hover:underline"
            onClick={() => record(surface.key, "click", href)}
          >
            {title}
          </a>
        ) : (
          title
        )}
      </p>
      <p className="mt-0.5">{surface.copy}</p>
    </aside>
  );
}

export function PostFilmAd({ surface }: { surface: AdSurfaceView | null }) {
  if (!surface) {
    return null;
  }
  return (
    <div className="mt-3" data-testid="post-film-ad">
      <AdSurface surface={surface} compact />
    </div>
  );
}
