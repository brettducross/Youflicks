import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLockup } from "@/components/brand";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { getSession } from "@/server/auth/session";

export const metadata = {
  title: "Create account",
};

export default async function SignUpPage() {
  const session = await getSession();
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <div className="film-vignette flex min-h-full flex-col">
      <header className="px-4 py-6 sm:px-8">
        <BrandLockup />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md rounded-2xl border border-border/70 bg-card/80 p-6 shadow-[0_0_80px_-28px_oklch(0.84_0.11_82/0.4)] sm:p-8">
          <h1 className="text-3xl">Open your studio</h1>
          <p className="mt-2 mb-6 text-sm text-muted-foreground">
            Create an account to start a project. Footage, direction, and render
            come next.
          </p>
          <div className="grid gap-6">
            <SignUpForm />
            <p className="text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link
                href="/sign-in"
                className="text-primary underline-offset-4 hover:underline"
              >
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
