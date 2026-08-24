import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/server/auth/session";
import { projectStatusLabel } from "@/server/domain/status";
import { getServices } from "@/server/services/container";

export const metadata = {
  title: "Projects",
};

export default async function ProjectsPage() {
  const user = await requireUser();
  const projects = await getServices().projects.listForUser(user.id);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs tracking-[0.24em] text-primary uppercase">Library</p>
          <h1 className="mt-2 text-4xl">Projects</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Each project is one film. Media, story, timeline, and render records
            already exist in the database; those tools arrive in later phases.
          </p>
        </div>
        <CreateProjectDialog />
      </div>

      {projects.length === 0 ? (
        <Card className="mt-10">
          <CardHeader>
            <FolderKanban className="size-5 text-primary" />
            <CardTitle className="font-heading text-2xl">The slate is empty</CardTitle>
            <CardDescription>
              Create a project to hold a title and logline. You will drop footage
              into it once ingest is built.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateProjectDialog triggerLabel="New project" />
          </CardContent>
        </Card>
      ) : (
        <ul className="mt-10 grid gap-4 sm:grid-cols-2">
          {projects.map((project) => (
            <li key={project.id}>
              <Link href={`/projects/${project.id}`} className="block h-full">
                <Card className="h-full transition-colors hover:bg-muted/40">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="font-heading text-xl">{project.title}</CardTitle>
                      <Badge variant="outline">{projectStatusLabel(project.status)}</Badge>
                    </div>
                    <CardDescription className="line-clamp-3">
                      {project.logline || "No logline yet. The story still has room."}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">
                      Updated {project.updatedAt.toLocaleDateString()}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
