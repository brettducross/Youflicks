import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { CREATIVE_PLAN_SCHEMA_VERSION } from "@/server/director/schema";
import { prisma } from "@/server/db";
import { walkCostFieldPaths } from "@/server/sg/cost-boundary";
import { collectShotCueInput, type CueReadDb } from "@/server/sg/cue-context";
import {
  assertPersistableCues,
  DIALOGUE_INTERIM_TREATMENTS,
  extractShotCues,
  persistableShotCues,
  readAnalysisFields,
  stricterIdentityState,
  tightenIdentityForRoute,
  requiredScopesFor,
  ShotCueError,
  type ShotCueAnalysis,
  type ShotCueInput,
} from "@/server/sg/cues";
import { IdentityEvidenceError } from "@/server/sg/identity-evidence";
import { PrismaShotFulfillment } from "@/server/sg/shot-fulfillment";
import { STORY_DOCUMENT_SCHEMA_VERSION, type StoryDocument } from "@/server/story/schema";
import { ProjectService } from "@/server/services/projects";
import {
  TIMELINE_DOCUMENT_SCHEMA_VERSION,
  type TimelineDocument,
} from "@/server/timeline/schema";
import type { IdentityState } from "@/server/sg/constants";

function analysis(overrides: Partial<ShotCueAnalysis> = {}): ShotCueAnalysis {
  return {
    status: "COMPLETED",
    assetStatus: "COMPLETED",
    faceDetected: false,
    faceCount: 0,
    peopleCount: 0,
    recurringPersonCount: 0,
    cameraMovement: null,
    locations: [],
    peopleParsed: true,
    personListed: false,
    ...overrides,
  };
}

function cueInput(overrides: Partial<ShotCueInput> = {}): ShotCueInput {
  return {
    scene: {
      id: "scene-1",
      dramaticFunction: "exposition",
      purpose: "Show the harbor.",
      mediaRoles: [{ role: "establishing_visual", purpose: "Wide shot." }],
    },
    unmetRole: { role: "establishing_visual", storySceneId: "scene-1" },
    slotDurationMs: 3000,
    analysis: analysis(),
    sceneEmphasis: [],
    ...overrides,
  };
}

describe("identity truth table", () => {
  it("marks PRESENT when a COMPLETED analysis has a detected face", () => {
    const cues = extractShotCues(
      cueInput({
        analysis: analysis({ faceDetected: true, faceCount: 1, peopleCount: 1 }),
      }),
    );
    expect(cues.identityState).toBe("PRESENT");
    expect(cues.identityEvidence).toEqual({
      faceCount: 1,
      faceDetected: true,
      recurringPersonCount: 0,
      analysisCompleted: true,
    });
  });

  it("marks PRESENT when recurringPersonIds is non-empty on a COMPLETED analysis", () => {
    const cues = extractShotCues(
      cueInput({
        analysis: analysis({ recurringPersonCount: 2, peopleCount: 2 }),
      }),
    );
    expect(cues.identityState).toBe("PRESENT");
    expect(cues.identityEvidence.recurringPersonCount).toBe(2);
    expect(cues.identityEvidence.faceDetected).toBe(false);
  });

  it("marks ABSENT only when COMPLETED with people.count 0 and no face", () => {
    const cues = extractShotCues(cueInput({ analysis: analysis() }));
    expect(cues.identityState).toBe("ABSENT");
    expect(cues.scope).toBe("NON_IDENTITY");
    expect(cues.requiredScopes).toEqual(["NON_IDENTITY"]);
  });

  it("marks UNKNOWN when analysis FAILED, including a payload that claims a face and count 0", () => {
    const cues = extractShotCues(
      cueInput({
        analysis: analysis({
          status: "FAILED",
          faceDetected: true,
          faceCount: 1,
          peopleCount: 0,
          recurringPersonCount: 1,
        }),
      }),
    );
    expect(cues.identityState).toBe("UNKNOWN");
    expect(cues.identityEvidence).toEqual({
      faceCount: 0,
      faceDetected: false,
      recurringPersonCount: 0,
      analysisCompleted: false,
    });
  });

  it("marks UNKNOWN when analysis is QUEUED", () => {
    const cues = extractShotCues(
      cueInput({
        analysis: analysis({ status: "QUEUED", peopleCount: 0 }),
      }),
    );
    expect(cues.identityState).toBe("UNKNOWN");
    expect(cues.requiredScopes).toEqual(["IDENTITY"]);
  });

  it("marks UNKNOWN when analysis is PROCESSING, NOT_ANALYZED, or missing", () => {
    for (const status of ["PROCESSING", "NOT_ANALYZED", null]) {
      const cues = extractShotCues(cueInput({ analysis: analysis({ status, peopleCount: 0 }) }));
      expect(cues.identityState).toBe("UNKNOWN");
    }
    expect(extractShotCues(cueInput({ analysis: null })).identityState).toBe("UNKNOWN");
  });

  it("marks UNKNOWN when COMPLETED but people.count is missing or not zero and no face is detected", () => {
    const missingCount = extractShotCues(
      cueInput({ analysis: analysis({ peopleCount: null }) }),
    );
    const counted = extractShotCues(
      cueInput({
        analysis: analysis({ peopleCount: 2 }),
      }),
    );
    const faceWithZeroCount = extractShotCues(
      cueInput({
        analysis: analysis({ faceDetected: true, faceCount: 1, peopleCount: 0 }),
      }),
    );
    expect(faceWithZeroCount.identityState).toBe("PRESENT");
    expect(missingCount.identityState).toBe("UNKNOWN");
    expect(counted.identityState).toBe("UNKNOWN");
    expect(counted.requiredScopes).not.toContain("NON_IDENTITY");
  });

  it("reads faces and recurring ids from a MediaAnalysis payload without keeping the ids", () => {
    const fields = readAnalysisFields("COMPLETED", {
      analysisSchemaVersion: "1.0",
      people: {
        count: 1,
        faceDetected: false,
        recurringPersonIds: ["person-secret-id"],
        people: [{ anonymousPersonId: "person-secret-id", faceDetected: true, embedding: [0.12, -0.4] }],
      },
      visual: {
        locations: ["secret-harbor-lane"],
        cameraMovement: "static",
      },
      crop: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ",
      url: "https://faces.example/crop.jpg",
    }, "COMPLETED");
    expect(fields.faceDetected).toBe(true);
    expect(fields.faceCount).toBe(1);
    expect(fields.recurringPersonCount).toBe(1);
    expect(fields.peopleCount).toBe(1);
    expect(fields.peopleParsed).toBe(true);
    expect(fields.cameraMovement).toBe("static");
    expect(JSON.stringify(fields)).not.toContain("person-secret-id");
    expect(JSON.stringify(fields)).not.toContain("0.12");
    expect(JSON.stringify(fields)).not.toContain("iVBORw0KGgo");
    expect(JSON.stringify(fields)).not.toContain("faces.example");
    expect(fields.locations).toEqual(["secret-harbor-lane"]);

    const cues = extractShotCues(cueInput({ analysis: fields, unmetRole: { role: "intimate_portrait" } }));
    const stored = JSON.stringify(cues);
    expect(cues.identityState).toBe("PRESENT");
    expect(stored).not.toContain("secret-harbor-lane");
    expect(stored).not.toContain("person-secret-id");
    expect(stored).not.toContain("embedding");
    expect(stored).not.toContain("faces.example");
    expect(walkCostFieldPaths(cues)).toEqual([]);
    expect(cues.motionNeed).toBe("none");
  });
});

describe("payload identity proof", () => {
  const provenEmpty = {
    analysisSchemaVersion: "1.0",
    people: { count: 0, people: [], recurringPersonIds: [] },
  };

  function stateFor(
    payload: unknown,
    status: string | null = "COMPLETED",
    assetStatus: string | null = "COMPLETED",
  ) {
    const fields = readAnalysisFields(status, payload, assetStatus);
    return extractShotCues(cueInput({ analysis: fields }));
  }

  it("marks ABSENT when COMPLETED count is 0 and both person lists are empty", () => {
    const cues = stateFor(provenEmpty);
    expect(cues.identityState).toBe("ABSENT");
    expect(cues.scope).toBe("NON_IDENTITY");
    expect(cues.requiredScopes).toEqual(["NON_IDENTITY"]);
    expect(cues.identityEvidence.analysisCompleted).toBe(true);
  });

  it("marks ABSENT when COMPLETED count is 0 and the person array is omitted", () => {
    const cues = stateFor({ analysisSchemaVersion: "1.0", people: { count: 0 } });
    expect(cues.identityState).toBe("ABSENT");
    expect(cues.scope).toBe("NON_IDENTITY");
  });

  it("does not prove ABSENT when people owns a __proto__ key", () => {
    const payload = JSON.parse(
      '{"analysisSchemaVersion":"1.0","people":{"count":0,"people":[],"recurringPersonIds":[],"__proto__":{"admin":true}}}',
    ) as unknown;
    const cues = stateFor(payload);
    expect(cues.identityState).toBe("UNKNOWN");
    expect(cues.scope).not.toBe("NON_IDENTITY");
  });

  it("tightens ABSENT only when the start frame and root keys prove it", () => {
    const absent = stateFor(provenEmpty);
    expect(absent.identityState).toBe("ABSENT");
    const proven = tightenIdentityForRoute({
      identityState: absent.identityState,
      hero: false,
      analyzedAssetId: "asset-1",
      sentAssetId: "asset-1",
      analysisRootKeys: ["analysisSchemaVersion", "people"],
    });
    expect(proven.identityState).toBe("ABSENT");
    expect(proven.requiredScopes).toEqual(["NON_IDENTITY"]);

    const mismatch = tightenIdentityForRoute({
      identityState: "ABSENT",
      hero: false,
      analyzedAssetId: "asset-1",
      sentAssetId: "asset-2",
      analysisRootKeys: ["analysisSchemaVersion", "people"],
    });
    expect(mismatch.identityState).toBe("UNKNOWN");
    expect(mismatch.requiredScopes).toEqual(["IDENTITY"]);

    const extraRoot = tightenIdentityForRoute({
      identityState: "ABSENT",
      hero: true,
      analyzedAssetId: "asset-1",
      sentAssetId: "asset-1",
      analysisRootKeys: ["analysisSchemaVersion", "people", "notes"],
    });
    expect(extraRoot.identityState).toBe("UNKNOWN");
    expect(extraRoot.requiredScopes).toEqual(["HERO", "IDENTITY"]);

    const present = tightenIdentityForRoute({
      identityState: "PRESENT",
      hero: false,
      analyzedAssetId: "asset-1",
      sentAssetId: "asset-2",
      analysisRootKeys: ["notes"],
    });
    expect(present.identityState).toBe("PRESENT");
    expect(present.requiredScopes).toEqual(["IDENTITY"]);
  });

  it("keeps the stricter of the stored identity and the re-derived identity", () => {
    expect(stricterIdentityState("UNKNOWN", "ABSENT")).toBe("UNKNOWN");
    expect(stricterIdentityState("ABSENT", "UNKNOWN")).toBe("UNKNOWN");
    expect(stricterIdentityState("PRESENT", "ABSENT")).toBe("PRESENT");
    expect(stricterIdentityState("ABSENT", "ABSENT")).toBe("ABSENT");
  });

  it("pins v2.0 face evidence as UNKNOWN and a missing version face as PRESENT", () => {
    const versioned = stateFor({
      analysisSchemaVersion: "2.0",
      people: { count: 1, people: [{ anonymousPersonId: "p1", faceDetected: true }] },
    });
    expect(versioned.identityState).toBe("UNKNOWN");
    expect(versioned.scope).toBe("IDENTITY");
    expect(versioned.identityEvidence.analysisCompleted).toBe(false);

    const missing = stateFor({
      people: { count: 1, people: [{ anonymousPersonId: "p1", faceDetected: true }] },
    });
    expect(missing.identityState).toBe("PRESENT");
    expect(missing.scope).toBe("IDENTITY");
  });

  it("marks UNKNOWN when analysisSchemaVersion is absent and ABSENT only when it is 1.0", () => {
    const absent = stateFor({ people: { count: 0, people: [], recurringPersonIds: [] } });
    expect(absent.identityState).toBe("UNKNOWN");
    expect(absent.scope).toBe("IDENTITY");
    expect(absent.identityEvidence.analysisCompleted).toBe(false);
    expect(
      stateFor({ analysisSchemaVersion: "1.0", people: { count: 0, people: [] } }).identityState,
    ).toBe("ABSENT");
  });

  it("marks UNKNOWN when the people section has keys outside the proof set", () => {
    const extras = [
      { faceCount: 2 },
      { faces: [{}] },
      { persons: 1 },
      { notes: "a woman partly visible" },
    ];
    for (const extra of extras) {
      const cues = stateFor({
        analysisSchemaVersion: "1.0",
        people: { count: 0, people: [], recurringPersonIds: [], ...extra },
      });
      expect(cues.identityState).toBe("UNKNOWN");
      expect(cues.scope).toBe("IDENTITY");
      expect(cues.requiredScopes).toEqual(["IDENTITY"]);
      expect(cues.identityEvidence.analysisCompleted).toBe(false);
    }
  });

  it("keeps PRESENT when an extended people section still names a face or recurring id", () => {
    const faced = stateFor({
      analysisSchemaVersion: "1.0",
      people: { count: 0, people: [], recurringPersonIds: [], faceDetected: true, faceCount: 2 },
    });
    const recurring = stateFor({
      people: { count: 0, recurringPersonIds: ["p1"], notes: "a woman partly visible" },
    });
    expect(faced.identityState).toBe("PRESENT");
    expect(faced.scope).toBe("IDENTITY");
    expect(recurring.identityState).toBe("PRESENT");
  });

  it("marks PRESENT for a boolean face or a non-blank recurring id even when count is 0", () => {
    expect(stateFor({ analysisSchemaVersion: "1.0", people: { count: 0, faceDetected: true } }).identityState).toBe(
      "PRESENT",
    );
    expect(
      stateFor({
        people: {
          count: 0,
          people: [{ anonymousPersonId: "a", faceDetected: true }],
        },
      }).identityState,
    ).toBe("PRESENT");
    expect(stateFor({ people: { count: 0, recurringPersonIds: ["p1"] } }).identityState).toBe("PRESENT");
  });

  it("marks UNKNOWN when count is 0 but a person is listed", () => {
    const cues = stateFor({
      analysisSchemaVersion: "1.0",
      people: { count: 0, people: [{ anonymousPersonId: "a", faceDetected: false }] },
    });
    expect(cues.identityState).toBe("UNKNOWN");
    expect(cues.scope).toBe("IDENTITY");
    expect(cues.requiredScopes).toEqual(["IDENTITY"]);
  });

  it("marks UNKNOWN when faceDetected is the string true", () => {
    const top = stateFor({
      analysisSchemaVersion: "1.0",
      people: { count: 0, faceDetected: "true", people: [] },
    });
    const person = stateFor({
      analysisSchemaVersion: "1.0",
      people: { count: 0, people: [{ anonymousPersonId: "a", faceDetected: "true" }] },
    });
    expect(top.identityState).toBe("UNKNOWN");
    expect(person.identityState).toBe("UNKNOWN");
    expect(top.requiredScopes).not.toContain("NON_IDENTITY");
    expect(person.scope).not.toBe("NON_IDENTITY");
  });

  it("marks UNKNOWN when faceDetected is the number 1", () => {
    const top = stateFor({ analysisSchemaVersion: "1.0", people: { count: 0, faceDetected: 1, people: [] } });
    const person = stateFor({
      analysisSchemaVersion: "1.0",
      people: { count: 0, people: [{ anonymousPersonId: "a", faceDetected: 1 }] },
    });
    expect(top.identityState).toBe("UNKNOWN");
    expect(person.identityState).toBe("UNKNOWN");
    expect(top.scope).toBe("IDENTITY");
    expect(person.scope).toBe("IDENTITY");
  });

  it("marks UNKNOWN when people.people is an object", () => {
    const cues = stateFor({
      analysisSchemaVersion: "1.0",
      people: { count: 0, people: { anonymousPersonId: "a" } },
    });
    expect(cues.identityState).toBe("UNKNOWN");
    expect(cues.scope).toBe("IDENTITY");
  });

  it("marks UNKNOWN when recurringPersonIds are blank", () => {
    expect(
      stateFor({ analysisSchemaVersion: "1.0", people: { count: 0, recurringPersonIds: [""] } }).identityState,
    ).toBe("UNKNOWN");
    expect(
      stateFor({ analysisSchemaVersion: "1.0", people: { count: 0, recurringPersonIds: ["  "] } }).identityState,
    ).toBe("UNKNOWN");
    expect(
      stateFor({ analysisSchemaVersion: "1.0", people: { count: 0, recurringPersonIds: ["p1", ""] } })
        .identityState,
    ).toBe("UNKNOWN");
  });

  it("marks UNKNOWN when recurringPersonIds are numeric", () => {
    const cues = stateFor({ analysisSchemaVersion: "1.0", people: { count: 0, recurringPersonIds: [1] } });
    expect(cues.identityState).toBe("UNKNOWN");
    expect(cues.requiredScopes).toEqual(["IDENTITY"]);
  });

  it("marks UNKNOWN when recurringPersonIds is a bare string", () => {
    const cues = stateFor({ analysisSchemaVersion: "1.0", people: { count: 0, recurringPersonIds: "p1" } });
    expect(cues.identityState).toBe("UNKNOWN");
    expect(cues.scope).toBe("IDENTITY");
  });

  it("marks UNKNOWN when a COMPLETED row is stale because the asset is QUEUED or PROCESSING", () => {
    for (const assetStatus of ["QUEUED", "PROCESSING"]) {
      const cues = stateFor(provenEmpty, "COMPLETED", assetStatus);
      expect(cues.identityState).toBe("UNKNOWN");
      expect(cues.scope).toBe("IDENTITY");
      expect(cues.identityEvidence.analysisCompleted).toBe(false);
    }
  });

  it("marks UNKNOWN when analysisSchemaVersion is not 1.0", () => {
    const cues = stateFor({ analysisSchemaVersion: "9.9", people: { count: 0, people: [] } });
    expect(cues.identityState).toBe("UNKNOWN");
    expect(cues.scope).toBe("IDENTITY");
    expect(cues.identityEvidence).toEqual({
      faceCount: 0,
      faceDetected: false,
      recurringPersonCount: 0,
      analysisCompleted: false,
    });
  });

  it("marks UNKNOWN for a missing, empty, or non-object people section and for a bad count", () => {
    for (const payload of [null, {}, [], "room", { people: [] }, { people: { people: [] } }]) {
      expect(stateFor(payload).identityState).toBe("UNKNOWN");
    }
    for (const count of ["0", -1, Number.NaN, Number.POSITIVE_INFINITY, 0.5, true, 2]) {
      expect(
        stateFor({ analysisSchemaVersion: "1.0", people: { count, people: [] } }).identityState,
      ).toBe("UNKNOWN");
    }
  });
});

describe("hero detection", () => {
  it("treats climax, turning, and inciting as hero", () => {
    for (const dramaticFunction of ["climax", "turning", "inciting"]) {
      const cues = extractShotCues(
        cueInput({
          scene: {
            id: "scene-1",
            dramaticFunction,
            purpose: "The turn.",
            mediaRoles: [{ role: "establishing_visual" }],
          },
          analysis: null,
        }),
      );
      expect(cues.hero).toBe(true);
      expect(cues.shotRole).toBe("hero");
      expect(cues.scope).toBe("HERO");
      expect(cues.requiredScopes).toEqual(["HERO", "IDENTITY"]);
    }
  });

  it("does not treat exposition, development, resolution, or motif as hero", () => {
    for (const dramaticFunction of ["exposition", "development", "resolution", "motif"]) {
      const cues = extractShotCues(
        cueInput({
          scene: {
            id: "scene-1",
            dramaticFunction,
            purpose: "A beat.",
            mediaRoles: [{ role: "intimate_portrait" }],
          },
          unmetRole: { role: "intimate_portrait" },
          analysis: null,
        }),
      );
      expect(cues.hero).toBe(false);
      expect(cues.shotRole).toBe("other");
    }
  });

  it("treats a scene_emphasis decision that names the scene id as hero", () => {
    const bySubject = extractShotCues(
      cueInput({
        sceneEmphasis: [{ kind: "scene_emphasis", subject: "scene-1", detail: { summary: "usdPerSecond" } }],
        analysis: null,
      }),
    );
    const byDetail = extractShotCues(
      cueInput({
        sceneEmphasis: [{ kind: "scene_emphasis", detail: { storySceneId: "scene-1" } }],
        analysis: null,
      }),
    );
    const byList = extractShotCues(
      cueInput({
        sceneEmphasis: [{ kind: "scene_emphasis", detail: { sceneIds: ["other", "scene-1"] } }],
        analysis: null,
      }),
    );
    expect(bySubject.hero).toBe(true);
    expect(byDetail.hero).toBe(true);
    expect(byList.hero).toBe(true);
    expect(JSON.stringify(bySubject)).not.toContain("usdPerSecond");
  });

  it("ignores scene_emphasis for a different scene and non-emphasis decisions", () => {
    const otherScene = extractShotCues(
      cueInput({
        sceneEmphasis: [{ kind: "scene_emphasis", subject: "scene-9" }],
        analysis: null,
      }),
    );
    const otherKind = extractShotCues(
      cueInput({
        sceneEmphasis: [{ kind: "film_concept", subject: "scene-1" }],
        analysis: null,
      }),
    );
    const summaryOnly = extractShotCues(
      cueInput({
        sceneEmphasis: [{ kind: "scene_emphasis", subject: "Hold scene-1", detail: { note: "scene-1" } }],
        analysis: null,
      }),
    );
    expect(otherScene.hero).toBe(false);
    expect(otherKind.hero).toBe(false);
    expect(summaryOnly.hero).toBe(false);
  });
});

describe("required scopes", () => {
  const states: IdentityState[] = ["PRESENT", "ABSENT", "UNKNOWN"];

  it("gives every identity state a scope, and UNKNOWN never maps to NON_IDENTITY", () => {
    for (const identityState of states) {
      for (const hero of [false, true]) {
        const scopes = requiredScopesFor(identityState, hero);
        expect(scopes.length).toBeGreaterThan(0);
        if (identityState === "UNKNOWN" || identityState === "PRESENT") {
          expect(scopes).toContain("IDENTITY");
          expect(scopes).not.toContain("NON_IDENTITY");
        } else {
          expect(scopes).toContain("NON_IDENTITY");
          expect(scopes).not.toContain("IDENTITY");
        }
        if (hero) {
          expect(scopes).toContain("HERO");
        }
      }
    }
  });

  it("keeps HERO on a hero shot whose identity is ABSENT", () => {
    const cues = extractShotCues(
      cueInput({
        scene: {
          id: "scene-1",
          dramaticFunction: "climax",
          purpose: "The peak.",
          mediaRoles: [{ role: "establishing_visual" }],
        },
        analysis: analysis(),
      }),
    );
    expect(cues.identityState).toBe("ABSENT");
    expect(cues.scope).toBe("HERO");
    expect(cues.requiredScopes).toEqual(["HERO", "NON_IDENTITY"]);
    expect(cues.shotRole).toBe("hero");
  });
});

describe("dialogue interim", () => {
  it("records a dialogue close-up without choosing ORIGINAL, STATIC, or KEN_BURNS", () => {
    const cues = extractShotCues(
      cueInput({
        scene: {
          id: "scene-1",
          dramaticFunction: "development",
          purpose: "They talk.",
          dialogueOutline: "She asks him to stay.",
          mediaRoles: [{ role: "intimate_portrait" }],
        },
        unmetRole: { role: "intimate_portrait" },
        analysis: null,
      }),
    );
    expect(cues.identityState).toBe("UNKNOWN");
    expect(cues.dialogueInterim).toBe(true);
    expect(cues.shotRole).toBe("dialogue-closeup");
    expect(cues.interimTreatments).toEqual([...DIALOGUE_INTERIM_TREATMENTS]);
    expect(cues.interimTreatments).not.toContain("GENERATE");
    expect(cues.requiredScopes).toEqual(["IDENTITY"]);
  });

  it("keeps HERO in scope when a dialogue close-up is also a hero beat", () => {
    const cues = extractShotCues(
      cueInput({
        scene: {
          id: "scene-1",
          dramaticFunction: "climax",
          purpose: "The confession.",
          dialogueOutline: "I was there.",
          mediaRoles: [{ role: "intimate_portrait" }],
        },
        unmetRole: { role: "intimate_portrait" },
        analysis: analysis({ faceDetected: true, faceCount: 1, peopleCount: 1 }),
      }),
    );
    expect(cues.dialogueInterim).toBe(true);
    expect(cues.shotRole).toBe("dialogue-closeup");
    expect(cues.scope).toBe("HERO");
    expect(cues.requiredScopes).toEqual(["HERO", "IDENTITY"]);
  });

  it("does not apply the interim when identity is ABSENT or the outline is blank", () => {
    const absent = extractShotCues(
      cueInput({
        scene: {
          id: "scene-1",
          dramaticFunction: "development",
          purpose: "They talk.",
          dialogueOutline: "A line.",
          mediaRoles: [{ role: "establishing_visual" }],
        },
        analysis: analysis(),
      }),
    );
    const blank = extractShotCues(
      cueInput({
        scene: {
          id: "scene-1",
          dramaticFunction: "development",
          purpose: "They talk.",
          dialogueOutline: "   ",
          mediaRoles: [{ role: "intimate_portrait" }],
        },
        unmetRole: { role: "intimate_portrait" },
        analysis: null,
      }),
    );
    expect(absent.dialogueInterim).toBe(false);
    expect(absent.identityState).toBe("ABSENT");
    expect(absent.shotRole).toBe("establishing");
    expect(blank.dialogueInterim).toBe(false);
    expect(blank.shotRole).toBe("other");
  });
});

describe("shot role and motion", () => {
  it("classifies establishing, insert, transition, and other from the unmet role", () => {
    expect(extractShotCues(cueInput()).shotRole).toBe("establishing");
    expect(
      extractShotCues(cueInput({ unmetRole: { role: "detail_insert" }, analysis: null })).shotRole,
    ).toBe("insert");
    expect(
      extractShotCues(
        cueInput({
          unmetRole: { role: "transition" },
          scene: {
            id: "scene-1",
            dramaticFunction: "punctuation",
            purpose: "A cut.",
            mediaRoles: [],
          },
          analysis: null,
        }),
      ).shotRole,
    ).toBe("transition");
    expect(
      extractShotCues(
        cueInput({
          unmetRole: { role: "button" },
          scene: {
            id: "scene-1",
            dramaticFunction: "punctuation",
            purpose: "A button.",
            mediaRoles: [],
          },
          analysis: null,
        }),
      ).shotRole,
    ).toBe("transition");
  });

  it("maps only an exact cameraMovement token onto motionNeed", () => {
    expect(extractShotCues(cueInput({ analysis: analysis({ cameraMovement: "handheld" }) })).motionNeed).toBe(
      "high",
    );
    expect(extractShotCues(cueInput({ analysis: analysis({ cameraMovement: "pan" }) })).motionNeed).toBe("low");
    expect(
      extractShotCues(cueInput({ analysis: analysis({ cameraMovement: "a gentle drift over the water" }) }))
        .motionNeed,
    ).toBeNull();
    expect(extractShotCues(cueInput({ slotDurationMs: 0 })).slotDurationMs).toBeNull();
    expect(extractShotCues(cueInput({ slotDurationMs: 4500 })).slotDurationMs).toBe(4500);
    expect(extractShotCues(cueInput({ slotDurationMs: 3_000_000_000 })).slotDurationMs).toBeNull();
    expect(extractShotCues(cueInput({ slotDurationMs: 2_147_483_647 })).slotDurationMs).toBe(2_147_483_647);
  });
});

describe("cue extraction spy", () => {
  it("never writes Story, Timeline, or CreativePlan", async () => {
    const calls: string[] = [];
    const forbid = (name: string) => async () => {
      calls.push(name);
      throw new Error(`forbidden write ${name}`);
    };
    const db = {
      mediaAsset: {
        findFirst: async () => {
          calls.push("mediaAsset.findFirst");
          return { id: "media-1", analysisStatus: "COMPLETED" };
        },
        update: forbid("mediaAsset.update"),
        create: forbid("mediaAsset.create"),
        delete: forbid("mediaAsset.delete"),
      },
      mediaAnalysis: {
        findMany: async () => {
          calls.push("mediaAnalysis.findMany");
          return [
            {
              id: "analysis-1",
              status: "COMPLETED",
              createdAt: new Date("2026-09-26T00:00:00.000Z"),
              payload: {
                analysisSchemaVersion: "1.0",
                people: { count: 0, people: [], recurringPersonIds: [] },
                visual: { locations: ["secret-harbor-lane"], cameraMovement: "static" },
              },
            },
          ];
        },
        update: forbid("mediaAnalysis.update"),
        create: forbid("mediaAnalysis.create"),
        delete: forbid("mediaAnalysis.delete"),
      },
      creativePlan: {
        findFirst: async () => {
          calls.push("creativePlan.findFirst");
          return {
            plan: {
              schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
              decisions: [
                {
                  kind: "scene_emphasis",
                  subject: "scene-1",
                  summary: "Emphasize the arrival. usdPerSecond 0.10",
                  detail: {
                    storySceneId: "scene-1",
                    embedding: [0.2, 0.3],
                    crop: "https://faces.example/crop.jpg",
                  },
                },
              ],
            },
          };
        },
        update: forbid("creativePlan.update"),
        updateMany: forbid("creativePlan.updateMany"),
        create: forbid("creativePlan.create"),
        delete: forbid("creativePlan.delete"),
      },
      storyStructure: { update: forbid("storyStructure.update"), create: forbid("storyStructure.create") },
      timeline: { update: forbid("timeline.update"), updateMany: forbid("timeline.updateMany") },
    };

    const input = await collectShotCueInput(db as unknown as CueReadDb, {
      projectId: "project-1",
      story: sampleStory("plan-1"),
      timeline: sampleTimeline(),
      role: "establishing_visual",
      storySceneId: "scene-1",
      sourceMediaAssetId: "media-1",
    });
    const cues = extractShotCues(input);
    expect(calls).toEqual([
      "mediaAsset.findFirst",
      "mediaAnalysis.findMany",
      "creativePlan.findFirst",
    ]);
    expect(cues.hero).toBe(true);
    expect(cues.identityState).toBe("ABSENT");
    expect(JSON.stringify(cues)).not.toContain("secret-harbor-lane");
    expect(JSON.stringify(cues)).not.toContain("usdPerSecond");
    expect(JSON.stringify(input.sceneEmphasis)).not.toContain("embedding");
    expect(JSON.stringify(input.sceneEmphasis)).not.toContain("faces.example");
  });

  it("treats a COMPLETED empty-room row as UNKNOWN while the asset is QUEUED or PROCESSING", async () => {
    for (const analysisStatus of ["QUEUED", "PROCESSING"]) {
      const db = {
        mediaAsset: {
          findFirst: async () => ({ id: "media-1", analysisStatus }),
        },
        mediaAnalysis: {
          findMany: async () => [
            {
              id: "analysis-1",
              status: "COMPLETED",
              createdAt: new Date("2026-09-26T00:00:00.000Z"),
              payload: {
                analysisSchemaVersion: "1.0",
                people: { count: 0, people: [], recurringPersonIds: [] },
              },
            },
          ],
        },
        creativePlan: {
          findFirst: async () => {
            throw new Error("plan should not be required");
          },
        },
      };
      const input = await collectShotCueInput(db as unknown as CueReadDb, {
        projectId: "project-1",
        story: null,
        timeline: sampleTimeline(),
        role: "empty_room_clip",
        sourceMediaAssetId: "media-1",
      });
      const cues = extractShotCues(input);
      expect(cues.identityState).toBe("UNKNOWN");
      expect(cues.scope).toBe("IDENTITY");
      expect(cues.requiredScopes).toEqual(["IDENTITY"]);
    }
  });

  it("reads scene emphasis only for the plan in this project", async () => {
    let where: { id?: string; projectId?: string } | undefined;
    const db = {
      mediaAsset: { findFirst: async () => null },
      mediaAnalysis: { findFirst: async () => null },
      creativePlan: {
        findFirst: async (args: { where?: { id?: string; projectId?: string } }) => {
          where = args.where;
          if (args.where?.projectId !== "project-1" || args.where?.id !== "plan-1") {
            return {
              plan: {
                schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
                decisions: [{ kind: "scene_emphasis", subject: "scene-other", summary: "Wrong project." }],
              },
            };
          }
          return {
            plan: {
              schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
              decisions: [{ kind: "scene_emphasis", subject: "scene-1", summary: "This project." }],
            },
          };
        },
      },
    };
    const input = await collectShotCueInput(db as unknown as CueReadDb, {
      projectId: "project-1",
      story: sampleStory("plan-1"),
      timeline: sampleTimeline(),
      role: "establishing_visual",
      storySceneId: "scene-1",
    });
    expect(where).toEqual({ id: "plan-1", projectId: "project-1" });
    expect(extractShotCues(input).hero).toBe(true);
    expect(extractShotCues(input).shotRole).toBe("hero");
  });

  it("keeps a valid scene_emphasis when another decision does not parse", async () => {
    const db = {
      mediaAsset: { findFirst: async () => null },
      mediaAnalysis: { findFirst: async () => null },
      creativePlan: {
        findFirst: async () => ({
          plan: {
            schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
            decisions: [
              { kind: "scene_emphasis", subject: "scene-1" },
              { kind: "scene_emphasis", subject: "scene-1", summary: "Hold the arrival." },
              { decisions: "nope" },
            ],
          },
        }),
      },
    };
    const input = await collectShotCueInput(db as unknown as CueReadDb, {
      projectId: "project-1",
      story: sampleStory("plan-1"),
      timeline: sampleTimeline(),
      role: "establishing_visual",
      storySceneId: "scene-1",
    });
    expect(extractShotCues(input).hero).toBe(true);

    const dropped = {
      mediaAsset: { findFirst: async () => null },
      mediaAnalysis: { findFirst: async () => null },
      creativePlan: {
        findFirst: async () => ({ plan: { decisions: "nope" } }),
      },
    };
    const empty = await collectShotCueInput(dropped as unknown as CueReadDb, {
      projectId: "project-1",
      story: sampleStory("plan-1"),
      timeline: sampleTimeline(),
      role: "establishing_visual",
      storySceneId: "scene-1",
    });
    expect(extractShotCues(empty).hero).toBe(false);
  });

  it("drops every scene_emphasis when the plan schemaVersion is unknown or missing", async () => {
    const versions: Array<{ schemaVersion?: unknown; logged: string }> = [
      { schemaVersion: "2.0", logged: "2.0" },
      { logged: "missing" },
      { schemaVersion: 1, logged: "number" },
      { schemaVersion: "this is far too long to log", logged: "invalid" },
    ];
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((arg) => String(arg)).join(" "));
    };
    try {
      for (const version of versions) {
        warnings.length = 0;
        const plan: Record<string, unknown> = {
          decisions: [{ kind: "scene_emphasis", subject: "scene-1", summary: "Hold the arrival." }],
        };
        if ("schemaVersion" in version) {
          plan.schemaVersion = version.schemaVersion;
        }
        const db = {
          mediaAsset: { findFirst: async () => null },
          mediaAnalysis: { findFirst: async () => null },
          creativePlan: { findFirst: async () => ({ plan }) },
        };
        const input = await collectShotCueInput(db as unknown as CueReadDb, {
          projectId: "project-1",
          story: sampleStory("plan-1"),
          timeline: sampleTimeline(),
          role: "establishing_visual",
          storySceneId: "scene-1",
        });
        const cues = extractShotCues(input);
        expect(input.sceneEmphasis).toEqual([]);
        expect(cues.hero).toBe(false);
        expect(cues.shotRole).not.toBe("hero");
        expect(warnings).toHaveLength(1);
        const entry = JSON.parse(warnings[0]!) as { message: string; planId: string; schemaVersion: string };
        expect(entry.message).toBe("cue.plan_version_dropped");
        expect(entry.planId).toBe("plan-1");
        expect(entry.schemaVersion).toBe(version.logged);
        expect(warnings[0]).not.toContain("Hold the arrival");
      }
    } finally {
      console.warn = originalWarn;
    }

    const climax = sampleStory("plan-1");
    climax.acts[0]!.scenes[0]!.dramaticFunction = "climax";
    const stillHero = await collectShotCueInput(
      {
        mediaAsset: { findFirst: async () => null },
        mediaAnalysis: { findFirst: async () => null },
        creativePlan: {
          findFirst: async () => ({
            plan: {
              schemaVersion: "2.0",
              decisions: [{ kind: "scene_emphasis", subject: "scene-1", summary: "Hold the arrival." }],
            },
          }),
        },
      } as unknown as CueReadDb,
      {
        projectId: "project-1",
        story: climax,
        timeline: sampleTimeline(),
        role: "establishing_visual",
        storySceneId: "scene-1",
      },
    );
    expect(stillHero.sceneEmphasis).toEqual([]);
    expect(extractShotCues(stillHero).hero).toBe(true);
    expect(extractShotCues(stillHero).shotRole).toBe("hero");
  });

  it("returns UNKNOWN when two analysis rows share a createdAt", async () => {
    const createdAt = new Date("2026-09-26T00:00:00.000Z");
    let orderBy: unknown;
    const db = {
      mediaAsset: {
        findFirst: async () => ({ id: "media-1", analysisStatus: "COMPLETED" }),
      },
      mediaAnalysis: {
        findMany: async (args: { orderBy?: unknown; take?: number }) => {
          orderBy = args.orderBy;
          expect(args.take).toBe(2);
          return [
            {
              id: "row-b",
              status: "COMPLETED",
              createdAt,
              payload: {
                analysisSchemaVersion: "1.0",
                people: { count: 0, people: [], recurringPersonIds: [] },
              },
            },
            {
              id: "row-a",
              status: "FAILED",
              createdAt,
              payload: { analysisSchemaVersion: "1.0", people: { count: 1, faceDetected: true } },
            },
          ];
        },
      },
      creativePlan: { findFirst: async () => null },
    };
    const input = await collectShotCueInput(db as unknown as CueReadDb, {
      projectId: "project-1",
      story: null,
      timeline: sampleTimeline(),
      role: "empty_room_clip",
      sourceMediaAssetId: "media-1",
    });
    const cues = extractShotCues(input);
    expect(orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(cues.identityState).toBe("UNKNOWN");
    expect(cues.scope).toBe("IDENTITY");
    expect(cues.requiredScopes).toEqual(["IDENTITY"]);
  });

  it("uses the newer analysis row when createdAt values differ", async () => {
    const db = {
      mediaAsset: {
        findFirst: async () => ({ id: "media-1", analysisStatus: "COMPLETED" }),
      },
      mediaAnalysis: {
        findMany: async () => [
          {
            id: "newer",
            status: "COMPLETED",
            createdAt: new Date("2026-09-26T00:00:02.000Z"),
            payload: {
              analysisSchemaVersion: "1.0",
              people: { count: 0, people: [], recurringPersonIds: [] },
            },
          },
          {
            id: "older",
            status: "FAILED",
            createdAt: new Date("2026-09-26T00:00:01.000Z"),
            payload: { analysisSchemaVersion: "1.0", people: { count: 1, faceDetected: true } },
          },
        ],
      },
      creativePlan: { findFirst: async () => null },
    };
    const input = await collectShotCueInput(db as unknown as CueReadDb, {
      projectId: "project-1",
      story: null,
      timeline: sampleTimeline(),
      role: "empty_room_clip",
      sourceMediaAssetId: "media-1",
    });
    expect(extractShotCues(input).identityState).toBe("ABSENT");
    expect(extractShotCues(input).scope).toBe("NON_IDENTITY");
  });

  it("does not read the plan again when scene emphasis is already loaded", async () => {
    const db = {
      mediaAsset: { findFirst: async () => null },
      mediaAnalysis: { findFirst: async () => null },
      creativePlan: {
        findFirst: async () => {
          throw new Error("plan read");
        },
      },
    };
    const input = await collectShotCueInput(db as unknown as CueReadDb, {
      projectId: "project-1",
      story: sampleStory("plan-1"),
      timeline: sampleTimeline(),
      role: "establishing_visual",
      storySceneId: "scene-1",
      sceneEmphasis: [{ kind: "scene_emphasis", subject: "scene-1" }],
    });
    expect(extractShotCues(input).hero).toBe(true);
  });

  it("rejects a slot duration outside the int4 range", () => {
    expect(() =>
      assertPersistableCues({
        scope: "IDENTITY",
        requiredScopes: ["IDENTITY"],
        identityState: "UNKNOWN",
        shotRole: "other",
        motionNeed: null,
        slotDurationMs: 3_000_000_000,
        identityEvidence: {
          faceCount: 0,
          faceDetected: false,
          recurringPersonCount: 0,
          analysisCompleted: false,
        },
      }),
    ).toThrow(ShotCueError);
  });

  it("does not route and does not reference a database write", () => {
    const cueSource = readFileSync("src/server/sg/cues.ts", "utf8");
    const contextSource = readFileSync("src/server/sg/cue-context.ts", "utf8");
    expect(cueSource).not.toMatch(/\bdecide\s*\(/);
    expect(contextSource).not.toMatch(/\bdecide\s*\(/);
    expect(cueSource).not.toMatch(/prisma/);
    expect(contextSource).not.toMatch(/\.update\(|\.create\(|\.delete\(|\.updateMany\(|\.upsert\(/);
  });
});

describe("persisted cues", () => {
  const userId = `sg-pr6-${Date.now()}`;
  const projects = new ProjectService();
  const records = new PrismaShotFulfillment(prisma);
  let projectId = "";

  afterAll(async () => {
    if (projectId) {
      await prisma.project.deleteMany({ where: { id: projectId } });
    }
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("stores a scope and an identity state on every slot, and rejects UNKNOWN mapped to NON_IDENTITY", async () => {
    await prisma.user.create({
      data: { id: userId, name: "Cues", email: `${userId}@example.com`, emailVerified: true },
    });
    const project = await projects.create(userId, { title: "Cues", logline: "PR-6" });
    projectId = project.id;

    const plan = await prisma.creativePlan.create({
      data: {
        projectId,
        version: 1,
        status: "READY",
        plan: {
          schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
          decisions: [
            {
              kind: "scene_emphasis",
              subject: "scene-hero",
              summary: "Hold the arrival.",
              detail: { storySceneId: "scene-hero", embedding: [0.9, 0.1] },
            },
          ],
        } as Prisma.InputJsonValue,
        inputFingerprint: "pr6-plan",
        providerKey: "test.director",
        capability: "STORY_REASONING",
      },
    });
    const story = sampleStory(plan.id);
    story.acts[0]!.scenes.push({
      id: "scene-hero",
      order: 1,
      purpose: "The turn.",
      dramaticFunction: "exposition",
      mediaRoles: [{ role: "intimate_portrait", purpose: "A face." }],
    });
    const storyRow = await prisma.storyStructure.create({
      data: {
        projectId,
        version: 1,
        status: "READY",
        payload: story as Prisma.InputJsonValue,
        inputFingerprint: "pr6-story",
        creativePlanId: plan.id,
        creativePlanVersion: 1,
        providerKey: "test.story",
        capability: "STORY_COMPOSITION",
      },
    });
    const timeline = sampleTimeline();
    const timelineRow = await prisma.timeline.create({
      data: {
        projectId,
        version: 1,
        status: "READY",
        payload: timeline as Prisma.InputJsonValue,
        inputFingerprint: "pr6-timeline",
        storyStructureId: storyRow.id,
        storyStructureVersion: 1,
        providerKey: "test.timeline",
        capability: "TIMELINE_COMPOSITION",
      },
    });
    const media = await prisma.mediaAsset.create({
      data: {
        projectId,
        kind: "PHOTO",
        filename: "still.jpg",
        mimeType: "image/jpeg",
        byteSize: 3,
        storageKey: `pr6/${projectId}/still`,
        status: "READY",
        analysisStatus: "COMPLETED",
      },
    });
    await prisma.mediaAnalysis.create({
      data: {
        assetId: media.id,
        providerKey: "test.analysis",
        schemaVersion: "1.0",
        status: "COMPLETED",
        payload: {
          people: {
            count: 1,
            recurringPersonIds: ["person-secret-id"],
            people: [{ anonymousPersonId: "anon-face", faceDetected: true, embedding: [0.25, 0.5] }],
          },
          visual: { locations: ["secret-harbor-lane"], cameraMovement: "locked" },
        } as Prisma.InputJsonValue,
      },
    });

    const before = {
      story: await prisma.storyStructure.findUniqueOrThrow({ where: { id: storyRow.id } }),
      timeline: await prisma.timeline.findUniqueOrThrow({ where: { id: timelineRow.id } }),
      plan: await prisma.creativePlan.findUniqueOrThrow({ where: { id: plan.id } }),
    };

    const cases = [
      {
        role: "establishing_visual",
        storySceneId: "scene-1",
        sourceMediaAssetId: null as string | null,
        timelineId: "tl-unknown",
      },
      {
        role: "intimate_portrait",
        storySceneId: "scene-hero",
        sourceMediaAssetId: media.id,
        timelineId: "tl-present",
      },
    ];
    for (const item of cases) {
      const input = await collectShotCueInput(prisma, {
        projectId,
        story,
        timeline,
        role: item.role,
        storySceneId: item.storySceneId,
        sourceMediaAssetId: item.sourceMediaAssetId,
      });
      const extracted = extractShotCues(input);
      const slot = await records.ensureSlot({
        projectId,
        timelineId: item.timelineId,
        timelineVersion: 1,
        role: item.role,
        storySceneId: item.storySceneId,
        sourceMediaAssetId: item.sourceMediaAssetId,
        cues: persistableShotCues(extracted),
      });
      expect(slot.scope.length).toBeGreaterThan(0);
      expect(["PRESENT", "ABSENT", "UNKNOWN"]).toContain(slot.identityState);
      expect(slot.requiredScopes.length).toBeGreaterThan(0);
      if (slot.identityState === "UNKNOWN" || slot.identityState === "PRESENT") {
        expect(slot.requiredScopes).not.toContain("NON_IDENTITY");
        expect(slot.scope).not.toBe("NON_IDENTITY");
      }
      expect(slot.treatment).toBe("GENERATE");
      expect(JSON.stringify(slot.identityEvidence)).not.toContain("person-secret-id");
      expect(JSON.stringify(slot.identityEvidence)).not.toContain("anon-face");
      expect(JSON.stringify(slot.identityEvidence)).not.toContain("secret-harbor-lane");
      expect(JSON.stringify(slot.identityEvidence)).not.toContain("embedding");
      expect(walkCostFieldPaths(slot.identityEvidence)).toEqual([]);
    }

    const unknownSlot = await prisma.shotFulfillment.findFirstOrThrow({
      where: { projectId, timelineId: "tl-unknown" },
    });
    expect(unknownSlot.identityState).toBe("UNKNOWN");
    expect(unknownSlot.scope).toBe("IDENTITY");
    expect(unknownSlot.requiredScopes).toEqual(["IDENTITY"]);
    expect(unknownSlot.shotRole).toBe("establishing");

    const heroSlot = await prisma.shotFulfillment.findFirstOrThrow({
      where: { projectId, timelineId: "tl-present" },
    });
    expect(heroSlot.identityState).toBe("PRESENT");
    expect(heroSlot.scope).toBe("HERO");
    expect(heroSlot.requiredScopes).toEqual(["HERO", "IDENTITY"]);
    expect(heroSlot.shotRole).toBe("hero");
    expect(heroSlot.motionNeed).toBe("none");
    expect(heroSlot.identityEvidence).toEqual({
      faceCount: 1,
      faceDetected: true,
      recurringPersonCount: 1,
      analysisCompleted: true,
    });

    const absentInput = extractShotCues(
      cueInput({
        analysis: analysis(),
        scene: {
          id: "scene-empty",
          dramaticFunction: "exposition",
          purpose: "Empty room.",
          mediaRoles: [{ role: "establishing_visual" }],
        },
      }),
    );
    const absentSlot = await records.ensureSlot({
      projectId,
      timelineId: "tl-absent",
      timelineVersion: 1,
      role: "establishing_visual",
      storySceneId: "scene-empty",
      cues: persistableShotCues(absentInput),
    });
    expect(absentSlot.identityState).toBe("ABSENT");
    expect(absentSlot.scope).toBe("NON_IDENTITY");
    expect(absentSlot.requiredScopes).toEqual(["NON_IDENTITY"]);

    const slots = await prisma.shotFulfillment.findMany({ where: { projectId } });
    expect(slots.length).toBeGreaterThanOrEqual(3);
    for (const slot of slots) {
      expect(slot.scope.length).toBeGreaterThan(0);
      expect(slot.identityState.length).toBeGreaterThan(0);
      if (slot.identityState === "UNKNOWN") {
        expect(slot.requiredScopes).not.toContain("NON_IDENTITY");
        expect(slot.scope).not.toBe("NON_IDENTITY");
      }
    }

    const again = await records.ensureSlot({
      projectId,
      timelineId: "tl-unknown",
      timelineVersion: 1,
      role: "establishing_visual",
      storySceneId: "scene-1",
      cues: persistableShotCues(
        extractShotCues(
          cueInput({
            scene: {
              id: "scene-1",
              dramaticFunction: "climax",
              purpose: "Changed.",
              mediaRoles: [],
            },
            analysis: analysis({ faceDetected: true, faceCount: 1 }),
          }),
        ),
      ),
    });
    expect(again.id).toBe(unknownSlot.id);
    expect(again.identityState).toBe("UNKNOWN");
    expect(again.scope).toBe("IDENTITY");

    await expect(
      records.ensureSlot({
        projectId,
        timelineId: "tl-reject",
        timelineVersion: 1,
        role: "intimate_portrait",
        storySceneId: "scene-reject",
        cues: {
          scope: "NON_IDENTITY",
          requiredScopes: ["NON_IDENTITY"],
          identityState: "UNKNOWN",
          shotRole: "other",
          motionNeed: null,
          slotDurationMs: null,
          identityEvidence: { faceDetected: false, faceCount: 0, recurringPersonCount: 0, analysisCompleted: false },
        },
      }),
    ).rejects.toBeInstanceOf(ShotCueError);
    expect(await prisma.shotFulfillment.count({ where: { projectId, timelineId: "tl-reject" } })).toBe(0);

    await expect(
      records.ensureSlot({
        projectId,
        timelineId: "tl-embed",
        timelineVersion: 1,
        role: "intimate_portrait",
        storySceneId: "scene-embed",
        cues: {
          scope: "IDENTITY",
          requiredScopes: ["IDENTITY"],
          identityState: "UNKNOWN",
          shotRole: "other",
          motionNeed: null,
          slotDurationMs: null,
          identityEvidence: { embedding: [0.12, -0.4, 1.5] },
        },
      }),
    ).rejects.toBeInstanceOf(IdentityEvidenceError);
    expect(await prisma.shotFulfillment.count({ where: { projectId, timelineId: "tl-embed" } })).toBe(0);

    const after = {
      story: await prisma.storyStructure.findUniqueOrThrow({ where: { id: storyRow.id } }),
      timeline: await prisma.timeline.findUniqueOrThrow({ where: { id: timelineRow.id } }),
      plan: await prisma.creativePlan.findUniqueOrThrow({ where: { id: plan.id } }),
    };
    expect(after.story.updatedAt).toEqual(before.story.updatedAt);
    expect(after.story.payload).toEqual(before.story.payload);
    expect(after.timeline.updatedAt).toEqual(before.timeline.updatedAt);
    expect(after.timeline.payload).toEqual(before.timeline.payload);
    expect(after.plan.updatedAt).toEqual(before.plan.updatedAt);
    expect(after.plan.plan).toEqual(before.plan.plan);
  });
});

function sampleStory(creativePlanId: string): StoryDocument {
  return {
    schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
    title: "Harbor",
    logline: "A day at the water.",
    spine: {
      opening: "Arrive.",
      development: "Stay.",
      resolution: "Leave.",
    },
    acts: [
      {
        id: "act-1",
        order: 0,
        purpose: "Establish place.",
        scenes: [
          {
            id: "scene-1",
            order: 0,
            purpose: "Show the harbor. usdPerSecond must not be stored.",
            dramaticFunction: "exposition",
            mediaRoles: [{ role: "establishing_visual", purpose: "Wide shot." }],
          },
        ],
      },
    ],
    source: { creativePlanId, creativePlanVersion: 1 },
  };
}

function sampleTimeline(): TimelineDocument {
  return {
    schemaVersion: TIMELINE_DOCUMENT_SCHEMA_VERSION,
    title: "Harbor cut",
    totalDurationMs: 3000,
    tracks: [
      { trackKey: "video.primary", kind: "VIDEO" },
      { trackKey: "audio.voice", kind: "AUDIO" },
      { trackKey: "audio.music", kind: "AUDIO" },
      { trackKey: "caption.main", kind: "CAPTION" },
    ],
    clips: [
      {
        id: "clip-1",
        trackKey: "video.primary",
        order: 0,
        sourceKind: "MEDIA_ASSET",
        assetId: "media-placed",
        storySceneId: "scene-1",
        mediaRole: "establishing_visual",
        timelineStartMs: 0,
        timelineEndMs: 3000,
      },
    ],
    unmetMediaRoles: [
      { role: "intimate_portrait", storySceneId: "scene-hero", reason: "No still." },
    ],
    source: { storyStructureId: "story-1", storyStructureVersion: 1 },
  };
}
