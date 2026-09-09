import { BrandLockup } from "@/components/brand";
import { SharePlaybackPlayer } from "@/components/projects/share-playback-player";
import { getServices } from "@/server/services/container";
import type { ShareWatchGrant } from "@/server/publication/schema";

export const metadata = {
  title: "Watch",
  robots: { index: false, follow: false },
};

export default async function ShareWatchPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token: raw } = await params;
  const token = decodeURIComponent(raw);
  const grant = await loadGrant(token);

  if (!grant) {
    return <InvalidShareLink />;
  }

  const preview = getServices().publicationService.previewShare(grant);
  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-10 sm:px-6">
      <BrandLockup href="/" />
      <p className="mt-8 text-xs tracking-[0.24em] text-primary uppercase">Shared film</p>
      <h1 className="mt-2 text-3xl">{preview.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Watch only. This is not a library keep and it is not a public file.
      </p>
      <div className="mt-8">
        <SharePlaybackPlayer
          token={token}
          title={preview.title}
          fallbackDurationMs={preview.durationMs}
        />
      </div>
    </main>
  );
}

function InvalidShareLink() {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-xl flex-col px-4 py-16 sm:px-6">
      <BrandLockup href="/" />
      <h1 className="mt-10 text-3xl">This link is no longer valid</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        The share link may have expired or been revoked. Ask the owner for a new one.
      </p>
    </main>
  );
}

async function loadGrant(token: string): Promise<ShareWatchGrant | null> {
  try {
    return await getServices().publicationService.verifyShareToken(token);
  } catch {
    return null;
  }
}
