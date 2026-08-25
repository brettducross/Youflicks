"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard, FolderKanban, LayoutDashboard, Sparkles } from "lucide-react";
import { BrandLockup } from "@/components/brand";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/taste", label: "Taste", icon: Sparkles },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 border-r border-border/70 bg-sidebar lg:flex lg:flex-col">
      <div className="flex h-16 items-center px-5">
        <BrandLockup href="/dashboard" />
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-sidebar-accent text-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border/70 p-4">
        <div className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <Clapperboard className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <p>Phase 2E. The Director is a contract, not a vendor and not a Generate button.</p>
        </div>
      </div>
    </aside>
  );
}

export function AppMobileNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 lg:hidden">
      {NAV.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              buttonVariants({ variant: active ? "secondary" : "ghost", size: "sm" }),
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
