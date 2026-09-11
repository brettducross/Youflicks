"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function AiConsentBanner({
  accepted,
  policyVersion,
}: {
  accepted: boolean;
  policyVersion: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (accepted) {
    return null;
  }

  async function onAccept() {
    setPending(true);
    setError(null);
    const response = await fetch("/api/me/ai-consent", { method: "POST" });
    setPending(false);
    if (!response.ok) {
      setError("Could not record consent. Try again.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="border-b border-border/70 bg-muted/40 px-4 py-3 sm:px-6">
      <p className="text-sm">
        YouFlicks beta may send photos, video frames, or transcripts to configured
        AI vendors for analysis or generation. This is a legal placeholder
        ({policyVersion}). Review your own counsel before production use.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" disabled={pending} onClick={() => void onAccept()}>
          {pending ? "Saving…" : "I consent to AI processing"}
        </Button>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
