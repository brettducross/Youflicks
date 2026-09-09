import type { AssetGeneratorInput } from "@/server/assets/input";
import type { GeneratedAssetDocument } from "@/server/assets/schema";

/**
 * Provider-neutral generated/processed asset port.
 * One asset per call. Attribution lives outside this return type.
 * Do not overload AiDirectorPort, StoryComposerPort, or TimelineComposerPort.
 */
export interface AssetGeneratorPort {
  generate(input: AssetGeneratorInput): Promise<GeneratedAssetDocument>;
}
