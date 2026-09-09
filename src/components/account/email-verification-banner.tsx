"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function EmailVerificationBanner({
  email,
  verified,
}: {
  email: string;
  verified: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (verified) {
    return null;
  }

  async function resend() {
    setError(null);
    setMessage(null);
    setPending(true);
    try {
      const response = await fetch("/api/me/account", { method: "POST" });
      const payload = (await response.json()) as {
        sent?: boolean;
        alreadyVerified?: boolean;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message || "Could not resend that email.");
      }
      if (payload.alreadyVerified) {
        setMessage("This email is already verified.");
        return;
      }
      setMessage("A new confirmation link is on its way.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not resend that email.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="border-b border-border/70 bg-muted/30 px-4 py-3 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          <p className="font-medium">Verify {email} to start a movie.</p>
          <p className="mt-1 text-muted-foreground">
            Generation stays locked until this address is confirmed.
            {message ? ` ${message}` : null}
          </p>
          {error ? (
            <p className="mt-1 text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={pending} onClick={() => void resend()}>
            {pending ? "Sending…" : "Resend"}
          </Button>
          <Link
            href="/verify-email"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            Details
          </Link>
        </div>
      </div>
    </div>
  );
}
