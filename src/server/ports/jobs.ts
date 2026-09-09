export type JobRecord = {
  id: string;
  type: string;
  status: string;
  projectId: string | null;
  payload: unknown;
  result: unknown;
  error: string | null;
  attempts: number;
  runAfter: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type EnqueueJobInput = {
  type: string;
  projectId?: string | null;
  payload?: unknown;
  runAfter?: Date;
};

export type FailJobInput = {
  error: string;
  retry?: boolean;
  retryAfter?: Date;
  maxAttempts?: number;
};

/**
 * Background work port.
 *
 * HTTP handlers must not run AI or video processing inline.
 * Enqueue a job and return; a worker claims it.
 */
export interface JobQueuePort {
  enqueue(input: EnqueueJobInput): Promise<JobRecord>;
  get(id: string): Promise<JobRecord | null>;
  listByProject(projectId: string): Promise<JobRecord[]>;
  claimNext(types?: string[]): Promise<JobRecord | null>;
  complete(id: string, result?: unknown): Promise<JobRecord>;
  fail(id: string, input: FailJobInput): Promise<JobRecord>;
  cancel(id: string): Promise<JobRecord>;
}
