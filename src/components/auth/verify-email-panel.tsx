"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function VerifyEmailPanel({
  email,
  verified,
}: {
  email: string;
  verified: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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

  if (verified) {
    return (
      <div className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          {email} is confirmed. You can start a movie when you are ready.
        </p>
        <Link href="/dashboard" className={cn(buttonVariants(), "h-10")}>
          Open studio
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        We sent a confirmation link to <span className="text-foreground">{email}</span>.
        You can browse the studio, but movie generation stays locked until this
        address is verified.
      </p>
      {message ? <p className="text-sm text-foreground">{message}</p> : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending} className="h-10" onClick={() => void resend()}>
          {pending ? "Sending…" : "Resend confirmation"}
        </Button>
        <Link href="/dashboard" className={cn(buttonVariants({ variant: "outline" }), "h-10")}>
          Continue to studio
        </Link>
      </div>
    </div>
  );
}
