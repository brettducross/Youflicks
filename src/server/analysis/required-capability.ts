import { AppError } from "@/lib/errors";
import { AnalysisCapability, type AnalysisCapabilityValue } from "@/server/ports/capabilities";
import { MediaKind } from "@/server/media/constants";

export function capabilityForKind(kind: string): AnalysisCapabilityValue {
  if (kind === MediaKind.PHOTO) {
    return AnalysisCapability.IMAGE_ANALYSIS;
  }
  if (kind === MediaKind.VIDEO) {
    return AnalysisCapability.VIDEO_ANALYSIS;
  }
  if (kind === MediaKind.AUDIO) {
    return AnalysisCapability.AUDIO_ANALYSIS;
  }
  throw AppError.unsupportedMedia("YouFlicks can only analyze photos and videos in this phase.");
}
