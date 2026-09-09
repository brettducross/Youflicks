import type { RenderComposerInput } from "@/server/render/input";
import type { RenderResultDocument } from "@/server/render/schema";

/**
 * Provider-neutral renderer port.
 *
 * Adapters assemble an already-decided cut into StoragePort bytes.
 * Attribution lives outside this return type. This port does not
 * create FinishedMovie, Publication, or playback surfaces.
 */
export interface RendererPort {
  render(input: RenderComposerInput): Promise<RenderResultDocument>;
}
