import { describe, expect, it } from "vitest";
import { FULFILLMENT_STATUSES, SG_MESSAGE_KEYS, TREATMENTS, type SgMessageKey } from "@/server/sg/constants";
import { SG_COPY } from "@/server/sg/messages";
import {
  PRESENTER_ROLE_KINDS,
  SLOT_MESSAGE_VIEW_KEYS,
  presentSlotMessages,
  visibleSlotCopy,
  type AppliedSlotState,
  type PresenterRoleKind,
} from "@/server/sg/presenter";

const PHOTO = /your photo|your original/i;
const CLIP = /\bclips?\b/i;
const CLIP_KINDS = new Set<PresenterRoleKind>(["VIDEO_CLIP", "ENHANCEMENT"]);

function slot(overrides: Partial<AppliedSlotState> = {}): AppliedSlotState {
  return {
    role: "establishing_visual",
    storySceneId: "scene-arrive",
    roleKind: "VIDEO_CLIP",
    routingMode: "ENFORCED",
    treatment: "DEFER",
    status: "DEFERRED",
    userMessageKey: SG_MESSAGE_KEYS.WAITING,
    generatedAssetId: null,
    sourceMediaAssetId: null,
    latestAttemptOutcome: null,
    assetStatus: null,
    assetSourceMediaAssetId: null,
    assetInProject: false,
    clipInTimeline: false,
    ...overrides,
  };
}

function verified(overrides: Partial<AppliedSlotState> = {}): AppliedSlotState {
  return slot({
    status: "FALLBACK",
    treatment: "KEN_BURNS",
    userMessageKey: SG_MESSAGE_KEYS.NO_QUALIFIED_LANE,
    generatedAssetId: "gen-1",
    sourceMediaAssetId: "still-1",
    assetStatus: "READY",
    assetSourceMediaAssetId: "still-1",
    assetInProject: true,
    clipInTimeline: false,
    ...overrides,
  });
}

function texts(state: AppliedSlotState): string[] {
  return visibleSlotCopy(presentSlotMessages(state));
}

describe("SG.6 presenter", () => {
  it("shows the stored direct keys and the waiting string for a defer with no still", () => {
    for (const mode of ["LEGACY", "ENFORCED"] as const) {
      expect(texts(slot({ routingMode: mode, userMessageKey: SG_MESSAGE_KEYS.WAITING }))).toEqual([
        SG_COPY.SG_WAITING,
      ]);
      expect(texts(slot({ routingMode: mode, userMessageKey: SG_MESSAGE_KEYS.CAP_REACHED }))).toEqual([
        SG_COPY.SG_CAP_REACHED,
      ]);
      expect(texts(slot({ routingMode: mode, userMessageKey: SG_MESSAGE_KEYS.FAILED_HONEST }))).toEqual([
        SG_COPY.SG_FAILED_HONEST,
      ]);
      expect(
        texts(
          slot({
            routingMode: mode,
            userMessageKey: SG_MESSAGE_KEYS.NO_QUALIFIED_LANE,
          }),
        ),
      ).toEqual([SG_COPY.SG_WAITING]);
      expect(
        texts(
          slot({
            routingMode: mode,
            userMessageKey: SG_MESSAGE_KEYS.CEILING_REACHED,
          }),
        ),
      ).toEqual([SG_COPY.SG_WAITING]);
    }
  });

  it("shows original copy only for FALLBACK plus ORIGINAL", () => {
    expect(texts(slot({ status: "FALLBACK", treatment: "ORIGINAL", userMessageKey: SG_MESSAGE_KEYS.FALLBACK_ORIGINAL }))).toEqual([
      SG_COPY.SG_FALLBACK_ORIGINAL,
    ]);
    expect(texts(slot({ status: "DEFERRED", treatment: "ORIGINAL", userMessageKey: SG_MESSAGE_KEYS.FALLBACK_ORIGINAL }))).toEqual([]);
  });

  it("shows a video fallback line once, plus the treatment line and the rebuild hint", () => {
    const views = presentSlotMessages(verified({ roleKind: "VIDEO_CLIP" }));
    expect(texts(verified({ roleKind: "VIDEO_CLIP" }))).toEqual([
      SG_COPY.SG_NO_QUALIFIED_LANE,
      SG_COPY.SG_REBUILD_HINT,
      SG_COPY.SG_FALLBACK_KEN_BURNS,
    ]);
    expect(views[0]?.rebuildHint).toBe(SG_COPY.SG_REBUILD_HINT);
    expect(views[1]?.rebuildHint).toBeNull();
    expect(texts(verified({ roleKind: "VIDEO_CLIP", clipInTimeline: true }))).toEqual([
      SG_COPY.SG_NO_QUALIFIED_LANE,
      SG_COPY.SG_FALLBACK_KEN_BURNS,
    ]);
  });

  it("prints the enhancement treatment line once", () => {
    const shown = texts(
      verified({
        roleKind: "ENHANCEMENT",
        userMessageKey: SG_MESSAGE_KEYS.FALLBACK_KEN_BURNS,
      }),
    );
    expect(shown.filter((line) => line === SG_COPY.SG_FALLBACK_KEN_BURNS)).toHaveLength(1);
    expect(shown).toContain(SG_COPY.SG_REBUILD_HINT);
    const held = texts(
      verified({
        roleKind: "ENHANCEMENT",
        treatment: "STATIC",
        userMessageKey: SG_MESSAGE_KEYS.FALLBACK_STATIC,
      }),
    );
    expect(held.filter((line) => line === SG_COPY.SG_FALLBACK_STATIC)).toHaveLength(1);
  });

  it("hides photo copy unless the source photo fallback is verified", () => {
    const negatives: AppliedSlotState[] = [
      verified({ sourceMediaAssetId: null }),
      verified({ assetSourceMediaAssetId: null }),
      verified({ sourceMediaAssetId: "still-1", assetSourceMediaAssetId: "still-2" }),
      verified({ assetStatus: "SUPERSEDED" }),
      verified({ assetStatus: "FAILED" }),
      verified({ assetInProject: false, assetStatus: null, assetSourceMediaAssetId: null }),
      verified({ generatedAssetId: null, assetInProject: false, assetStatus: null, assetSourceMediaAssetId: null }),
      slot({ status: "DEFERRED", userMessageKey: SG_MESSAGE_KEYS.NO_QUALIFIED_LANE }),
      slot({ status: "FAILED", treatment: "DEFER", userMessageKey: SG_MESSAGE_KEYS.NO_QUALIFIED_LANE, latestAttemptOutcome: "FAILED" }),
    ];
    for (const state of negatives) {
      expect(texts(state).join(" ")).not.toMatch(/your photo/i);
    }
  });

  it("uses the FAILED rule and never the stored photo key", () => {
    expect(
      texts(
        slot({
          status: "FAILED",
          treatment: "DEFER",
          userMessageKey: SG_MESSAGE_KEYS.NO_QUALIFIED_LANE,
          latestAttemptOutcome: "CAP_DENIED",
        }),
      ),
    ).toEqual([SG_COPY.SG_CAP_REACHED]);
    expect(
      texts(
        slot({
          status: "FAILED",
          treatment: "GENERATE",
          userMessageKey: null,
          latestAttemptOutcome: "CAP_DENIED",
        }),
      ),
    ).toEqual([SG_COPY.SG_CAP_REACHED]);
    expect(
      texts(
        slot({
          status: "FAILED",
          treatment: "FAIL_HONEST",
          userMessageKey: SG_MESSAGE_KEYS.FAILED_HONEST,
          latestAttemptOutcome: "FAILED",
        }),
      ),
    ).toEqual([SG_COPY.SG_FAILED_HONEST]);
    expect(
      texts(
        slot({
          status: "FAILED",
          treatment: "DEFER",
          userMessageKey: SG_MESSAGE_KEYS.NO_QUALIFIED_LANE,
          latestAttemptOutcome: "FAILED",
        }),
      ),
    ).toEqual([SG_COPY.SG_FAILED_HONEST]);
    expect(
      texts(
        slot({
          status: "FAILED",
          userMessageKey: null,
          latestAttemptOutcome: null,
        }),
      ),
    ).toEqual([SG_COPY.SG_FAILED_HONEST]);
  });

  it("reads the applied key, not a shadow decision", () => {
    const state = {
      ...slot({ userMessageKey: SG_MESSAGE_KEYS.WAITING, status: "DEFERRED", treatment: "DEFER" }),
      shadowDecision: { messageKey: SG_MESSAGE_KEYS.FAILED_HONEST, treatment: "FAIL_HONEST" },
    };
    expect(texts(state)).toEqual([SG_COPY.SG_WAITING]);
    expect(texts(state).join(" ")).not.toContain(SG_COPY.SG_FAILED_HONEST);
    expect(texts(state).join(" ")).not.toMatch(/your photo/i);
  });

  it("returns only the allowlisted view keys", () => {
    for (const view of presentSlotMessages(verified())) {
      expect(Object.keys(view).sort()).toEqual([...SLOT_MESSAGE_VIEW_KEYS].sort());
      expect(view).not.toHaveProperty("decisionReason");
      expect(view).not.toHaveProperty("shadowDecision");
    }
  });

  it("never shows clip wording for a non-video role or without a verified photo", () => {
    for (const kind of ["IMAGE", "VOICE_OVER", "MUSIC", "SFX"] as const) {
      for (const status of FULFILLMENT_STATUSES) {
        for (const treatment of TREATMENTS) {
          for (const key of [...Object.values(SG_MESSAGE_KEYS), null]) {
            const shown = texts(
              verified({
                roleKind: kind,
                status,
                treatment,
                userMessageKey: key,
                assetStatus: status === "FALLBACK" ? "READY" : "FAILED",
              }),
            ).join(" ");
            expect(shown, `${kind} ${status} ${treatment} ${key}`).not.toMatch(CLIP);
          }
        }
      }
    }
  });

  it("covers every status, treatment, stored key, ready clip, kind, and mode", () => {
    const keys: Array<SgMessageKey | null> = [...Object.values(SG_MESSAGE_KEYS), null];
    for (const status of FULFILLMENT_STATUSES) {
      for (const treatment of TREATMENTS) {
        for (const key of keys) {
          for (const ready of [false, true]) {
            for (const placed of [false, true]) {
              for (const roleKind of PRESENTER_ROLE_KINDS) {
                const base = {
                  status,
                  treatment,
                  userMessageKey: key,
                  roleKind,
                  generatedAssetId: ready ? "gen-1" : null,
                  sourceMediaAssetId: ready ? "still-1" : null,
                  assetStatus: ready ? "READY" : null,
                  assetSourceMediaAssetId: ready ? "still-1" : null,
                  assetInProject: ready,
                  clipInTimeline: ready && placed,
                  latestAttemptOutcome: status === "FAILED" ? "FAILED" : null,
                } satisfies Partial<AppliedSlotState>;
                const legacy = texts(slot({ ...base, routingMode: "LEGACY" }));
                const enforced = texts(slot({ ...base, routingMode: "ENFORCED" }));
                expect(legacy).toEqual(enforced);
                const joined = enforced.join(" ");
                const photoVerified =
                  status === "FALLBACK" &&
                  (treatment === "KEN_BURNS" || treatment === "STATIC") &&
                  ready;
                if (PHOTO.test(joined)) {
                  const original = status === "FALLBACK" && treatment === "ORIGINAL";
                  expect(original || photoVerified, joined).toBe(true);
                }
                if (CLIP.test(joined)) {
                  expect(photoVerified && CLIP_KINDS.has(roleKind)).toBe(true);
                }
                const hintShown = joined.includes(SG_COPY.SG_REBUILD_HINT);
                if (hintShown) {
                  expect(photoVerified && !(ready && placed)).toBe(true);
                }
                if (photoVerified && !(ready && placed) && (roleKind === "VIDEO_CLIP" || roleKind === "ENHANCEMENT")) {
                  expect(hintShown).toBe(true);
                }
                if (status === "FULFILLED" || status === "PLANNED" || status === "IN_PROGRESS") {
                  expect(enforced).toEqual([]);
                }
                if (
                  status === "DEFERRED" &&
                  (key === SG_MESSAGE_KEYS.NO_QUALIFIED_LANE || key === SG_MESSAGE_KEYS.CEILING_REACHED)
                ) {
                  expect(enforced).toEqual([SG_COPY.SG_WAITING]);
                }
                if (status === "FAILED") {
                  for (const line of enforced) {
                    expect([SG_COPY.SG_CAP_REACHED, SG_COPY.SG_FAILED_HONEST]).toContain(line);
                  }
                  expect(joined).not.toMatch(/your photo/i);
                }
              }
            }
          }
        }
      }
    }
  });
});
