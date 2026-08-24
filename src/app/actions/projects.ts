"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireUser } from "@/server/auth/session";
import { getServices } from "@/server/services/container";

export type ActionState = {
  error?: string;
};

export async function createProjectAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const title = String(formData.get("title") ?? "");
  const logline = String(formData.get("logline") ?? "");

  try {
    const project = await getServices().projects.create(user.id, { title, logline });
    revalidatePath("/dashboard");
    revalidatePath("/projects");
    redirect(`/projects/${project.id}`);
  } catch (error) {
    if (isAppError(error)) {
      logger.error("projects.create_failed", {
        userId: user.id,
        error: error.message,
      });
      return { error: error.message };
    }
    throw error;
  }
}
