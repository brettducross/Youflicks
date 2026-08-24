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
  createdAt: Date;
  updatedAt: Date;
};

export type EnqueueJobInput = {
  type: string;
  projectId?: string | null;
  payload?: unknown;
  runAfter?: Date;
};

/**
 * Background work port.
 *
 * HTTP handlers must not run AI or video processing inline.
 * Enqueue a job and return; a worker (Phase 2+) will claim it.
 */
export interface JobQueuePort {
  enqueue(input: EnqueueJobInput): Promise<JobRecord>;
  get(id: string): Promise<JobRecord | null>;
  listByProject(projectId: string): Promise<JobRecord[]>;
}
