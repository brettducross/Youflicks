import Link from "next/link";
import { ArrowRight, Clapperboard, Film, Images, Sparkles } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { getSession } from "@/server/auth/session";
import { PIPELINE_STAGES } from "@/server/domain/status";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function LandingPage() {
  const session = await getSession();
  const signedIn = Boolean(session?.user);

  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader signedIn={signedIn} />
      <main className="flex-1">
        <section className="film-vignette relative overflow-hidden border-b border-border/60">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:py-24">
            <div className="flex flex-col justify-center">
              <p className="mb-4 text-xs font-medium tracking-[0.28em] text-primary uppercase">
                YouFlicks
              </p>
              <h1 className="max-w-xl text-5xl leading-[1.05] text-balance sm:text-6xl">
                Your footage. Your story. Your film.
              </h1>
              <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground sm:text-lg">
                Bring the photos, clips, and memories you already have. YouFlicks
                finds the story in them and cuts a finished movie — without handing
                your life over to a stock template.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href={signedIn ? "/dashboard" : "/sign-up"}
                  className={cn(buttonVariants({ size: "lg" }), "h-11 px-5")}
                >
                  {signedIn ? "Open studio" : "Start a film"}
                  <ArrowRight className="size-4" />
                </Link>
                <Link
                  href="#how-it-works"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "lg" }),
                    "h-11 px-5",
                  )}
                >
                  How it works
                </Link>
              </div>
            </div>
            <HeroFrame />
          </div>
        </section>

        <section id="how-it-works" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <p className="text-xs font-medium tracking-[0.24em] text-primary uppercase">
            The loop
          </p>
          <h2 className="mt-3 max-w-xl text-3xl text-balance sm:text-4xl">
            From a pile of files to something you can actually watch.
          </h2>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            <StepCard
              icon={Images}
              title="Bring your footage"
              body="Photos, videos, voice notes, and stills live in a project. Nothing is generated in place of what you captured."
            />
            <StepCard
              icon={Sparkles}
              title="Direct the story"
              body="The AI Director — when it ships — reads the archive and proposes a structure. You remain the author."
            />
            <StepCard
              icon={Film}
              title="Take home a film"
              body="A timeline becomes a render, then a finished movie you can keep or publish. That work sits behind the same ports as everything else."
            />
          </div>
        </section>

        <section className="border-y border-border/60 bg-card/40">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <p className="text-xs font-medium tracking-[0.24em] text-primary uppercase">
              Pipeline
            </p>
            <h2 className="mt-3 text-3xl sm:text-4xl">Built as a studio, not a prompt box.</h2>
            <p className="mt-3 max-w-2xl text-muted-foreground">
              Phase 1 opens the studio: accounts, projects, and the data model for
              the rest of the line. Later phases fill each stage without rewriting
              the foundation.
            </p>
            <ol className="mt-10 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {PIPELINE_STAGES.map((stage, index) => (
                <li
                  key={stage.id}
                  className="rounded-xl border border-border/70 bg-background/60 px-4 py-4"
                >
                  <p className="text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
                    {String(index + 1).padStart(2, "0")}
                  </p>
                  <p className="mt-2 font-medium">{stage.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {stage.available ? "Live in Phase 1" : "Schema ready"}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>
      <footer className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-8 text-sm text-muted-foreground sm:px-6">
        <p>YouFlicks · Your footage. Your story. Your film.</p>
        <p className="hidden sm:block">Phase 1 foundation</p>
      </footer>
    </div>
  );
}

function HeroFrame() {
  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none">
      <div className="aspect-4/5 rounded-2xl border border-primary/25 bg-card/80 p-4 shadow-[0_0_80px_-20px_oklch(0.84_0.11_82/0.45)]">
        <div className="flex h-full flex-col rounded-xl border border-border/80 bg-background/80 p-5">
          <div className="flex items-center justify-between text-[11px] tracking-[0.22em] text-muted-foreground uppercase">
            <span>Reel 01</span>
            <span>24 fps</span>
          </div>
          <div className="mt-6 flex flex-1 flex-col justify-end">
            <Clapperboard className="mb-4 size-8 text-primary" />
            <p className="font-heading text-3xl leading-tight">Sunday at the harbour</p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              A family afternoon that keeps folding back to the water. Draft
              project — waiting on footage.
            </p>
            <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full w-1/5 rounded-full bg-primary" />
            </div>
            <p className="mt-2 text-[11px] tracking-widest text-muted-foreground uppercase">
              Status · Draft
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepCard({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Images;
  title: string;
  body: string;
}) {
  return (
    <article className="rounded-2xl border border-border/70 bg-card/50 p-6">
      <Icon className="size-5 text-primary" />
      <h3 className="mt-4 text-xl">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
    </article>
  );
}
