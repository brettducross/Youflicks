import Link from "next/link";
import { Clapperboard, FolderKanban } from "lucide-react";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { PIPELINE_STAGES, projectStatusLabel } from "@/server/domain/status";
import { getServices } from "@/server/services/container";

export const metadata = {
  title: "Dashboard",
};

export default async function DashboardPage() {
  const user = await requireUser();
  const services = getServices();
  const [projects, count] = await Promise.all([
    services.projects.listForUser(user.id),
    services.projects.countForUser(user.id),
  ]);
  const recent = projects.slice(0, 4);
  const firstName = user.name.split(" ")[0] ?? user.name;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs tracking-[0.24em] text-primary uppercase">Studio</p>
          <h1 className="mt-2 text-4xl">Good to see you, {firstName}.</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            This is the YouFlicks studio floor. Create a project now. Media ingest,
            the AI Director, and rendering are wired as ports — not mocked.
          </p>
        </div>
        <CreateProjectDialog />
      </div>

      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        <StatCard label="Projects" value={String(count)} hint="Films in your studio" />
        <StatCard label="Phase" value="1" hint="Foundation only" />
        <StatCard label="Pipeline stages" value="10" hint="Modeled in the database" />
      </section>

      <section className="mt-10 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader className="flex-row items-start justify-between">
            <div>
              <CardTitle className="font-heading text-xl">Recent projects</CardTitle>
              <CardDescription>The films you have opened so far.</CardDescription>
            </div>
            <Link
              href="/projects"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              View all
            </Link>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border/80 px-4 py-8">
                <FolderKanban className="size-5 text-primary" />
                <div>
                  <p className="font-medium">No films yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Open a project to reserve a place on the timeline. Footage
                    upload arrives in Phase 2.
                  </p>
                </div>
                <CreateProjectDialog triggerLabel="Create the first one" />
              </div>
            ) : (
              <ul className="grid gap-2">
                {recent.map((project) => (
                  <li key={project.id}>
                    <Link
                      href={`/projects/${project.id}`}
                      className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-muted/60"
                    >
                      <div>
                        <p className="font-medium">{project.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {project.logline || "No logline yet"}
                        </p>
                      </div>
                      <Badge variant="outline">{projectStatusLabel(project.status)}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-xl">What ships next</CardTitle>
            <CardDescription>Honest status of the filmmaking line.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {PIPELINE_STAGES.map((stage) => (
              <div
                key={stage.id}
                className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2"
              >
                <span className="text-sm">{stage.label}</span>
                <Badge variant={stage.available ? "default" : "outline"}>
                  {stage.available ? "Live" : "Later"}
                </Badge>
              </div>
            ))}
            <p className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
              <Clapperboard className="mt-0.5 size-3.5 shrink-0 text-primary" />
              No stage is faked. If a button is not here, the work is not here.
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="font-heading text-3xl">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
