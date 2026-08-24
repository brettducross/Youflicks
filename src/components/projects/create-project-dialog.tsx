"use client";

import { useActionState } from "react";
import { Plus } from "lucide-react";
import { createProjectAction, type ActionState } from "@/app/actions/projects";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function CreateProjectDialog({
  triggerLabel = "New project",
}: {
  triggerLabel?: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    createProjectAction,
    {},
  );

  return (
    <Dialog>
      <DialogTrigger render={<Button className="h-9 gap-1.5" />}>
        <Plus className="size-4" />
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={action} className="grid gap-4">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl">Open a new film</DialogTitle>
            <DialogDescription>
              A project is one movie. You will add footage, a story, and a timeline
              here in later phases.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              name="title"
              required
              maxLength={120}
              placeholder="Sunday at the harbour"
              className="h-10"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="logline">Logline</Label>
            <Textarea
              id="logline"
              name="logline"
              maxLength={500}
              placeholder="A family afternoon that keeps folding back to the water."
            />
          </div>
          {state.error ? (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={pending} className="h-9">
              {pending ? "Creating…" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
