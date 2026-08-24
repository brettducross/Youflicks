import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLockup } from "@/components/brand";
import { SignInForm } from "@/components/auth/sign-in-form";
import { getSession } from "@/server/auth/session";

export const metadata = {
  title: "Sign in",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const session = await getSession();
  if (session?.user) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const nextValue = params.next;
  const nextPath =
    typeof nextValue === "string" && nextValue.startsWith("/")
      ? nextValue
      : "/dashboard";

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to open your studio and pick up a film."
    >
      <SignInForm nextPath={nextPath} />
      <p className="text-sm text-muted-foreground">
        New here?{" "}
        <Link href="/sign-up" className="text-primary underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}

function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="film-vignette flex min-h-full flex-col">
      <header className="px-4 py-6 sm:px-8">
        <BrandLockup />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md rounded-2xl border border-border/70 bg-card/80 p-6 shadow-[0_0_80px_-28px_oklch(0.84_0.11_82/0.4)] sm:p-8">
          <h1 className="text-3xl">{title}</h1>
          <p className="mt-2 mb-6 text-sm text-muted-foreground">{subtitle}</p>
          <div className="grid gap-6">{children}</div>
        </div>
      </main>
    </div>
  );
}
