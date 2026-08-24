import Link from "next/link";
import { cn } from "@/lib/utils";

export function BrandMark({
  className,
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = {
    sm: "h-7 w-7 text-[11px]",
    md: "h-8 w-8 text-xs",
    lg: "h-11 w-11 text-sm",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-sm border border-primary/40 bg-primary/10 font-heading tracking-[0.18em] text-primary",
        sizes[size],
        className,
      )}
      aria-hidden
    >
      YF
    </span>
  );
}

export function BrandLockup({
  href = "/",
  className,
}: {
  href?: string;
  className?: string;
}) {
  return (
    <Link href={href} className={cn("flex items-center gap-2.5", className)}>
      <BrandMark />
      <span className="font-heading text-lg tracking-tight text-foreground">
        YouFlicks
      </span>
    </Link>
  );
}
