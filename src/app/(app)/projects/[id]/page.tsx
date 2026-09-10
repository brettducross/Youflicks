import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { MediaLibrary } from "@/components/media/media-library";
import { CreativeIntentForm } from "@/components/projects/creative-intent-form";
import { CreativePlanPanel } from "@/components/projects/creative-plan-panel";
import { StoryPanel } from "@/components/projects/story-panel";
import { MissingPiecesPanel } from "@/components/projects/missing-pieces-panel";
import { TimelinePanel } from "@/components/projects/timeline-panel";
import { RenderPanel } from "@/components/projects/render-panel";
import { LibraryPanel } from "@/components/projects/library-panel";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { projectStatusLabel } from "@/server/domain/status";
import { withGenerationHonesty } from "@/server/services/account-lifecycle";
import { getServices } from "@/server/services/container";

export const metadata = {
  title: "Project",
};

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const services = getServices();
  const project = await services.projects.findForUser(user.id, id);

  if (!project) {
    notFound();
  }

  const assets = await services.media.listForProject(user.id, id);
  const brief = await services.intent.resolveBrief(user.id, id);
  const plan = await services.directorService.getLatestReady(user.id, id);
  const gate = await services.accountLifecycle.getAccountGate(user.id);
  const availability = withGenerationHonesty(services.directorService.getAvailability(), gate);
  const story = await services.storyService.getLatestReady(user.id, id);
  const stories = await services.storyService.listStories(user.id, id);
  const storyAvailability = services.storyService.getAvailability();
  const timeline = await services.timelineService.getLatestReady(user.id, id);
  const timelines = await services.timelineService.listTimelines(user.id, id);
  const timelineAvailability = services.timelineService.getAvailability();
  const generatedAssets = await services.assetService.listAssets(user.id, id);
  const assetAvailability = services.assetService.getAvailability();
  const unmetRoles = timeline?.document.unmetMediaRoles ?? [];
  const latestRender = await services.renderService.getLatestSuccessful(user.id, id);
  const renderAvailability = services.renderService.getAvailability();
  const movies = await services.movieService.list(user.id, id);
  const movieAvailability = await services.movieService.getAvailability(user.id, id);
  const presentation = await services.presentation.forUser(user.id, id);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <Link
        href="/projects"
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mb-4 -ml-2")}
      >
        <ArrowLeft className="size-4" />
        Projects
      </Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs tracking-[0.24em] text-primary uppercase">Project</p>
          <h1 className="mt-2 text-4xl">{project.title}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {project.logline || "Add a logline later. This film is still a draft."}
          </p>
        </div>
        <Badge variant="outline">{projectStatusLabel(project.status)}</Badge>
      </div>

      <MediaLibrary projectId={project.id} initialAssets={assets} />

      <Card className="mt-10">
        <CardHeader>
          <CardTitle className="font-heading text-xl">Creative intent</CardTitle>
          <CardDescription>
            How this film should feel. It overrides your usual taste for this project only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreativeIntentForm
            projectId={project.id}
            initialIntent={brief.intent}
            initialEffective={brief.effective}
          />
        </CardContent>
      </Card>

      <CreativePlanPanel
        projectId={project.id}
        initialPlan={plan}
        initialAvailability={availability}
      />

      <StoryPanel
        projectId={project.id}
        initialStory={story}
        initialStories={stories}
        initialAvailability={storyAvailability}
        directionReady={Boolean(plan)}
      />

      <TimelinePanel
        projectId={project.id}
        initialTimeline={timeline}
        initialTimelines={timelines}
        initialAvailability={timelineAvailability}
        storyReady={Boolean(story)}
      />

      <MissingPiecesPanel
        projectId={project.id}
        initialAssets={generatedAssets}
        initialAvailability={assetAvailability}
        initialUnmetRoles={unmetRoles}
        timelineReady={Boolean(timeline)}
      />

      <RenderPanel
        projectId={project.id}
        initialRender={latestRender}
        initialAvailability={renderAvailability}
        timelineReady={Boolean(timeline)}
        unmetRoleCount={unmetRoles.length}
      />

      <LibraryPanel
        projectId={project.id}
        initialMovies={movies}
        initialCanKeep={movieAvailability.canKeep}
        initialWatermarkRequired={presentation.watermarkRequired}
        initialAds={presentation.ads.filter((surface) => surface.key === "LIBRARY_BANNER")}
      />
    </main>
  );
}
