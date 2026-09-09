/**
 * Timeline composer port — provider-neutral cut composition.
 *
 * Do not extend or overload AiDirectorPort or StoryComposerPort.
 * This port returns only TimelineDocument. Attribution is adapter
 * metadata outside the return.
 */
import type { TimelineComposerInput } from "@/server/timeline/input";
import type { TimelineDocument } from "@/server/timeline/schema";

export interface TimelineComposerPort {
  composeTimeline(input: TimelineComposerInput): Promise<TimelineDocument>;
}
