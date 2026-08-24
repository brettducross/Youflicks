import Link from "next/link";
import { BrandLockup } from "@/components/brand";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <BrandLockup />
        <nav className="flex items-center gap-2">
          {signedIn ? (
            <Link href="/dashboard" className={cn(buttonVariants({ size: "sm" }))}>
              Open studio
            </Link>
          ) : (
            <>
              <Link
                href="/sign-in"
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              >
                Sign in
              </Link>
              <Link href="/sign-up" className={cn(buttonVariants({ size: "sm" }))}>
                Start a film
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
