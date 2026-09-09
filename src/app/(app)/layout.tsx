import type { ReactNode } from "react";
import { EmailVerificationBanner } from "@/components/account/email-verification-banner";
import { EntitlementHonesty } from "@/components/account/entitlement-honesty";
import { AdSurface } from "@/components/commercial/ad-surface";
import { AppMobileNav, AppSidebar } from "@/components/layout/app-nav";
import { UserMenu } from "@/components/layout/user-menu";
import { BrandLockup } from "@/components/brand";
import { CommercialSurface } from "@/server/advertising/types";
import { requireUser } from "@/server/auth/session";
import { getServices } from "@/server/services/container";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const services = getServices();
  const [gate, presentation] = await Promise.all([
    services.accountLifecycle.getAccountGate(user.id),
    services.presentation.forUser(user.id),
  ]);
  const shellAd = presentation.ads.find((surface) => surface.key === CommercialSurface.UI_SHELL);

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
          <div className="flex min-w-0 items-center gap-3">
            {gate.emailVerified ? (
              <div className="hidden min-w-0 sm:block">
                <EntitlementHonesty summary={presentation.entitlementSummary} />
              </div>
            ) : null}
            <UserMenu
              name={user.name}
              email={user.email}
              emailVerified={gate.emailVerified}
              adsEnabled={presentation.adsEnabled}
              watermarkRequired={presentation.watermarkRequired}
            />
          </div>
        </header>
        <EmailVerificationBanner email={user.email} verified={gate.emailVerified} />
        {shellAd ? <AdSurface surface={shellAd} /> : null}
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}
