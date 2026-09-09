/**
 * Count and record capability usage windows. Not UsageEvent (M8.3).
 * Kind is an open string (e.g. MOVIE_GENERATION).
 */
export type RateLimitRecordInput = {
  userId: string;
  kind: string;
  projectId?: string;
  recordedAt?: Date;
};

export type RateLimitPort = {
  countInWindow(userId: string, kind: string, since: Date): Promise<number>;
  record(input: RateLimitRecordInput): Promise<void>;
};
