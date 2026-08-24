import "server-only";

import { AppError } from "@/lib/errors";
import { getSession } from "@/server/auth/session";

export async function requireApiUser() {
  const session = await getSession();
  if (!session?.user) {
    throw AppError.unauthorized();
  }
  return session.user;
}
