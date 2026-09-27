import { SG_MESSAGE_KEYS, type SgMessageKey } from "@/server/sg/constants";
import { SG_COPY } from "@/server/sg/messages";

/** Kinds that can render a processor moving clip. Other kinds never show the word "clip". */
const CLIP_WORD_KINDS = new Set<PresenterRoleKind>(["VIDEO_CLIP", "ENHANCEMENT"]);

export const PRESENTER_ROLE_KINDS = [
  "IMAGE",
  "VIDEO_CLIP",
  "ENHANCEMENT",
  "VOICE_OVER",
  "MUSIC",
  "SFX",
] as const;

export type PresenterRoleKind = (typeof PRESENTER_ROLE_KINDS)[number];

/**
 * Applied slot state only. Shadow decisions are not a field: the Missing pieces
 * panel must not show what ENFORCED would have done while LEGACY generated.
 */
export type AppliedSlotState = {
  role: string;
  storySceneId: string | null;
  roleKind: PresenterRoleKind;
  routingMode: "LEGACY" | "ENFORCED";
  treatment: string;
  status: string;
  userMessageKey: string | null;
  generatedAssetId: string | null;
  sourceMediaAssetId: string | null;
  latestAttemptOutcome: string | null;
  assetStatus: string | null;
  assetSourceMediaAssetId: string | null;
  /** True when generatedAssetId resolved to a GeneratedAsset in this project. */
  assetInProject: boolean;
  /** True when that GeneratedAsset is a clip in the current timeline document. */
  clipInTimeline: boolean;
};

/** Client-safe view. These five keys are the entire response object. */
export type SlotMessageView = {
  role: string;
  storySceneId: string | null;
  messageKey: SgMessageKey;
  message: string;
  rebuildHint: string | null;
};

export const SLOT_MESSAGE_VIEW_KEYS = [
  "role",
  "storySceneId",
  "messageKey",
  "message",
  "rebuildHint",
] as const;

const CLIP_WORD = /\bclips?\b/i;

export function isVerifiedPhotoFallback(slot: AppliedSlotState): boolean {
  if (slot.status !== "FALLBACK") {
    return false;
  }
  if (slot.treatment !== "KEN_BURNS" && slot.treatment !== "STATIC") {
    return false;
  }
  if (!slot.generatedAssetId || !slot.assetInProject) {
    return false;
  }
  if (slot.assetStatus !== "READY") {
    return false;
  }
  if (!slot.sourceMediaAssetId || !slot.assetSourceMediaAssetId) {
    return false;
  }
  return slot.sourceMediaAssetId === slot.assetSourceMediaAssetId;
}

function lineAllowed(roleKind: PresenterRoleKind, text: string): boolean {
  if (!CLIP_WORD_KINDS.has(roleKind) && CLIP_WORD.test(text)) {
    return false;
  }
  return true;
}

function line(key: SgMessageKey): { key: SgMessageKey; text: string } {
  return { key, text: SG_COPY[key] };
}

function isMessageKey(value: string | null): value is SgMessageKey {
  return value !== null && Object.values(SG_MESSAGE_KEYS).some((key) => key === value);
}

function appliedKey(slot: AppliedSlotState): string | null {
  return slot.userMessageKey;
}

function failedKey(slot: AppliedSlotState): SgMessageKey {
  if (slot.latestAttemptOutcome === "CAP_DENIED") {
    return SG_MESSAGE_KEYS.CAP_REACHED;
  }
  if (appliedKey(slot) === SG_MESSAGE_KEYS.CAP_REACHED) {
    return SG_MESSAGE_KEYS.CAP_REACHED;
  }
  return SG_MESSAGE_KEYS.FAILED_HONEST;
}

function chooseLines(slot: AppliedSlotState): { key: SgMessageKey; text: string }[] {
  if (slot.status === "FULFILLED" || slot.status === "PLANNED" || slot.status === "IN_PROGRESS") {
    return [];
  }
  if (slot.status === "FAILED") {
    const chosen = line(failedKey(slot));
    return lineAllowed(slot.roleKind, chosen.text) ? [chosen] : [];
  }
  if (slot.status === "FALLBACK" && slot.treatment === "ORIGINAL") {
    const chosen = line(SG_MESSAGE_KEYS.FALLBACK_ORIGINAL);
    return lineAllowed(slot.roleKind, chosen.text) ? [chosen] : [];
  }
  if (
    slot.status === "FALLBACK" &&
    (slot.treatment === "KEN_BURNS" || slot.treatment === "STATIC") &&
    isVerifiedPhotoFallback(slot)
  ) {
    const lines: { key: SgMessageKey; text: string }[] = [];
    const stored = appliedKey(slot);
    if (isMessageKey(stored) && stored !== SG_MESSAGE_KEYS.REBUILD_HINT) {
      const storedLine = line(stored);
      if (lineAllowed(slot.roleKind, storedLine.text)) {
        lines.push(storedLine);
      }
    }
    const treatmentKey =
      slot.treatment === "KEN_BURNS"
        ? SG_MESSAGE_KEYS.FALLBACK_KEN_BURNS
        : SG_MESSAGE_KEYS.FALLBACK_STATIC;
    const treatmentLine = line(treatmentKey);
    if (
      lineAllowed(slot.roleKind, treatmentLine.text) &&
      !lines.some((item) => item.key === treatmentLine.key)
    ) {
      lines.push(treatmentLine);
    }
    return lines;
  }
  if (slot.status === "DEFERRED") {
    const stored = appliedKey(slot);
    if (
      stored === SG_MESSAGE_KEYS.WAITING ||
      stored === SG_MESSAGE_KEYS.CAP_REACHED ||
      stored === SG_MESSAGE_KEYS.FAILED_HONEST
    ) {
      const chosen = line(stored);
      return lineAllowed(slot.roleKind, chosen.text) ? [chosen] : [];
    }
    if (
      stored === SG_MESSAGE_KEYS.NO_QUALIFIED_LANE ||
      stored === SG_MESSAGE_KEYS.CEILING_REACHED
    ) {
      const waiting = line(SG_MESSAGE_KEYS.WAITING);
      return lineAllowed(slot.roleKind, waiting.text) ? [waiting] : [];
    }
  }
  return [];
}

function rebuildHint(slot: AppliedSlotState): string | null {
  if (!isVerifiedPhotoFallback(slot) || slot.clipInTimeline) {
    return null;
  }
  return SG_COPY[SG_MESSAGE_KEYS.REBUILD_HINT];
}

/** Pure presenter. Same rules in LEGACY and ENFORCED. Returns no row when nothing honest can be said. */
export function presentSlotMessages(slot: AppliedSlotState): SlotMessageView[] {
  if (slot.routingMode !== "LEGACY" && slot.routingMode !== "ENFORCED") {
    return [];
  }
  const lines = chooseLines(slot);
  const hint = rebuildHint(slot);
  if (lines.length === 0) {
    if (!hint) {
      return [];
    }
    return [
      {
        role: slot.role,
        storySceneId: slot.storySceneId,
        messageKey: SG_MESSAGE_KEYS.REBUILD_HINT,
        message: hint,
        rebuildHint: null,
      },
    ];
  }
  return lines.map((item, index) => ({
    role: slot.role,
    storySceneId: slot.storySceneId,
    messageKey: item.key,
    message: item.text,
    rebuildHint: index === 0 ? hint : null,
  }));
}

export function visibleSlotCopy(views: readonly SlotMessageView[]): string[] {
  const lines: string[] = [];
  for (const view of views) {
    lines.push(view.message);
    if (view.rebuildHint) {
      lines.push(view.rebuildHint);
    }
  }
  return lines;
}
