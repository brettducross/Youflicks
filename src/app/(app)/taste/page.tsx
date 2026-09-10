import { TasteForm } from "@/components/taste/taste-form";
import { requireUser } from "@/server/auth/session";
import { getServices } from "@/server/services/container";

export const metadata = {
  title: "Taste",
};

export default async function TastePage() {
  const user = await requireUser();
  const services = getServices();
  const [profile, sponsorship, adsHonesty] = await Promise.all([
    services.taste.getForUser(user.id, user.id),
    services.taste.getSponsorshipPreferences(user.id, user.id),
    services.advertising.adsHonesty(user.id),
  ]);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <p className="text-xs tracking-[0.24em] text-primary uppercase">You</p>
      <h1 className="mt-2 text-4xl">Taste</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Tell YouFlicks what you love. This stays on your account. Capability
        adapters do not receive the full profile. A project can still override
        it when that film needs a different mood.
      </p>
      <div className="mt-8">
        <TasteForm
          initialProfile={profile}
          initialSponsorship={sponsorship}
          adsHonesty={adsHonesty}
        />
      </div>
    </main>
  );
}
