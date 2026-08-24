import type { ReactNode } from "react";
import { AppMobileNav, AppSidebar } from "@/components/layout/app-nav";
import { UserMenu } from "@/components/layout/user-menu";
import { BrandLockup } from "@/components/brand";
import { requireUser } from "@/server/auth/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-full">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between gap-3 border-b border-border/70 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="lg:hidden">
              <BrandLockup href="/dashboard" />
            </div>
            <AppMobileNav />
          </div>
          <UserMenu name={user.name} email={user.email} />
        </header>
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}
