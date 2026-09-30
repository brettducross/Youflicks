import { SG_CAP_REACHED_SENTENCE } from "@/lib/sg-cap-sentence";
import { SG_MESSAGE_KEYS, type SgMessageKey } from "@/server/sg/constants";

/**
 * SG.6 user-facing copy (PR-10). One string per lock key.
 * P-8 (2026-09-26) changes only the waiting, cap, and failure sentences.
 * The other six strings are the lock r3 draft, character for character.
 */
export const SG_COPY: Record<SgMessageKey, string> = {
  [SG_MESSAGE_KEYS.FALLBACK_ORIGINAL]: "We used your original photo or video for this moment.",
  [SG_MESSAGE_KEYS.FALLBACK_KEN_BURNS]:
    "This moment uses your photo with gentle camera movement instead of a generated clip.",
  [SG_MESSAGE_KEYS.FALLBACK_STATIC]: "This moment shows your photo as a still.",
  [SG_MESSAGE_KEYS.NO_QUALIFIED_LANE]:
    "We can't make a moving clip for this moment at our quality bar yet, so we used your photo instead.",
  [SG_MESSAGE_KEYS.CEILING_REACHED]:
    "We tried a few versions of this moment and none met our quality bar, so we used your photo instead.",
  [SG_MESSAGE_KEYS.WAITING]:
    "This moment is waiting for this piece. Your movie can still be built without it.",
  [SG_MESSAGE_KEYS.CAP_REACHED]: SG_CAP_REACHED_SENTENCE,
  [SG_MESSAGE_KEYS.FAILED_HONEST]:
    "We couldn't make this piece for this moment. Nothing in your story was changed.",
  [SG_MESSAGE_KEYS.REBUILD_HINT]: "Rebuild your cut to include the updated moments.",
};

export function copyForKey(key: SgMessageKey): string {
  return SG_COPY[key];
}
