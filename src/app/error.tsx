"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { logger } from "@/lib/logger";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error("ui.route_error", {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <main className="mx-auto flex min-h-full max-w-lg flex-col items-center justify-center px-6 py-24 text-center">
      <p className="text-xs tracking-[0.24em] text-primary uppercase">Error</p>
      <h1 className="mt-3 text-4xl">The reel jammed.</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Something unexpected happened. You can try again, or return to the studio
        floor.
      </p>
      <Button className="mt-6 h-10" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
