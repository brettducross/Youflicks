import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { MediaLibrary } from "@/components/media/media-library";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { projectStatusLabel } from "@/server/domain/status";
import { getServices } from "@/server/services/container";

export const metadata = {
  title: "Project",
};

const LATER_SECTIONS = [
  {
    title: "Story",
    body: "AI Director output will land in StoryStructure. No director adapter is configured yet.",
  },
  {
    title: "Timeline",
    body: "Editorial order for the render. Schema and TimelineClip exist; the editor does not.",
  },
  {
    title: "Render",
    body: "RendererPort will produce a FinishedMovie. Nothing is queued until a renderer exists.",
  },
] as const;

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

      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {LATER_SECTIONS.map((section) => (
          <Card key={section.title}>
            <CardHeader>
              <CardTitle className="font-heading text-xl">{section.title}</CardTitle>
              <CardDescription>{section.body}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-xs tracking-widest text-muted-foreground uppercase">
                Later phase
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
