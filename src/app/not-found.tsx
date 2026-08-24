import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-full max-w-lg flex-col items-center justify-center px-6 py-24 text-center">
      <p className="text-xs tracking-[0.24em] text-primary uppercase">404</p>
      <h1 className="mt-3 text-4xl">This scene was never shot.</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        The page you asked for is not in the cut.
      </p>
      <Link href="/" className={cn(buttonVariants(), "mt-6 h-10 px-5")}>
        Back to YouFlicks
      </Link>
    </main>
  );
}
