import Link from "next/link";
import { BrandLockup } from "@/components/brand";
import { VerifyEmailPanel } from "@/components/auth/verify-email-panel";
import { getSession } from "@/server/auth/session";
import { getServices } from "@/server/services/container";

export const metadata = {
  title: "Verify email",
};

export default async function VerifyEmailPage() {
  const session = await getSession();
  const gate = session?.user
    ? await getServices().accountLifecycle.getAccountGate(session.user.id)
    : null;

  return (
    <div className="film-vignette flex min-h-full flex-col">
      <header className="px-4 py-6 sm:px-8">
        <BrandLockup />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md rounded-2xl border border-border/70 bg-card/80 p-6 shadow-[0_0_80px_-28px_oklch(0.84_0.11_82/0.4)] sm:p-8">
          <h1 className="text-3xl">Confirm your email</h1>
          <p className="mt-2 mb-6 text-sm text-muted-foreground">
            A valid email is required before YouFlicks will start a movie.
          </p>
          {session?.user ? (
            <VerifyEmailPanel email={session.user.email} verified={gate?.emailVerified === true} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Sign in to resend a confirmation link.{" "}
              <Link href="/sign-in" className="text-primary underline-offset-4 hover:underline">
                Sign in
              </Link>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
