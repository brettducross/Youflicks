/**
 * AI Director port — YouFlicks-owned creative intelligence.
 *
 * Models and providers are replaceable capabilities used by the Director,
 * not the Director itself. This port has no providerKey.
 *
 * Phase 2E ships the contract only. Phase 2F executes it through adapters
 * behind this port without amending the return type.
 * Do not implement story generation, timelines, or rendering here.
 */
import type { DirectorInput } from "@/server/director/input";
import type { CreativePlan } from "@/server/director/schema";

export interface AiDirectorPort {
  composePlan(input: DirectorInput): Promise<CreativePlan>;
}
