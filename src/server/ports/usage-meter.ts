import type {
  RecordJobUsageInput,
  RecordUsageInput,
  UsageEventView,
  UsageQuery,
} from "@/server/usage/types";

/**
 * Record and query ops usage + engine cost attribution.
 * Never writes CreativePlan / Story / Timeline. Not BillingPort.
 */
export type UsageMeterPort = {
  record(input: RecordUsageInput): Promise<UsageEventView>;
  recordJobUsage(input: RecordJobUsageInput): Promise<UsageEventView | null>;
  listForUser(userId: string, query?: UsageQuery): Promise<UsageEventView[]>;
  listForJob(jobId: string): Promise<UsageEventView[]>;
};
