import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresJobQueue } from "@/server/adapters/jobs/postgres";
import { prisma } from "@/server/db";
import { JobStatus } from "@/server/domain/status";

describe("PostgresJobQueue", () => {
  const queue = new PostgresJobQueue();
  const ids: string[] = [];

  afterAll(async () => {
    if (ids.length) {
      await prisma.job.deleteMany({ where: { id: { in: ids } } });
    }
  });

  beforeAll(() => {
    expect(process.env.DATABASE_URL).toBeTruthy();
  });

  it("enqueues, claims, completes, and retries", async () => {
    const created = await queue.enqueue({
      type: "TEST_QUEUE",
      payload: { assetId: "retry-test" },
    });
    ids.push(created.id);
    expect(created.status).toBe(JobStatus.PENDING);

    const claimed = await queue.claimNext(["TEST_QUEUE"]);
    expect(claimed?.id).toBe(created.id);
    expect(claimed?.status).toBe(JobStatus.RUNNING);
    expect(claimed?.attempts).toBe(1);

    const retried = await queue.fail(created.id, {
      error: "temporary",
      retry: true,
      maxAttempts: 3,
      retryAfter: new Date(),
    });
    expect(retried.status).toBe(JobStatus.PENDING);

    const claimedAgain = await queue.claimNext(["TEST_QUEUE"]);
    expect(claimedAgain?.id).toBe(created.id);
    const done = await queue.complete(created.id, { ok: true });
    expect(done.status).toBe(JobStatus.SUCCEEDED);
  });

  it("marks a job failed after retries are exhausted", async () => {
    const created = await queue.enqueue({ type: "TEST_QUEUE", payload: {} });
    ids.push(created.id);
    await queue.claimNext(["TEST_QUEUE"]);
    const failed = await queue.fail(created.id, {
      error: "permanent",
      retry: true,
      maxAttempts: 1,
    });
    expect(failed.status).toBe(JobStatus.FAILED);
  });
});
