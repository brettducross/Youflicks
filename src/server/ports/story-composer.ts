/**
 * Story composer port — provider-neutral narrative composition.
 *
 * Do not extend or overload AiDirectorPort. This port returns only
 * StoryDocument. Attribution is adapter metadata outside the return.
 */
import type { StoryComposerInput } from "@/server/story/input";
import type { StoryDocument } from "@/server/story/schema";

export interface StoryComposerPort {
  composeStory(input: StoryComposerInput): Promise<StoryDocument>;
}
